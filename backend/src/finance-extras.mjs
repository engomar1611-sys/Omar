import ExcelJS from 'exceljs';

// مراكز التكلفة، القوائم المالية (قائمة الدخل والميزانية)، وتصدير التقارير Excel/CSV.

const auth = (app, p) => ({ preHandler: [app.authenticate, app.requirePermission(p)] });
const bad = (reply, message = 'البيانات غير صحيحة') => reply.code(400).send({ error: 'VALIDATION_ERROR', message });
const fail = (reply, e) => {
  if (e.code === '23505') return reply.code(409).send({ error: 'DUPLICATE', message: 'الكود مستخدم مسبقاً' });
  if (e.code === '23503') return reply.code(409).send({ error: 'REFERENCED' });
  if (['23514', '22P02'].includes(e.code)) return reply.code(400).send({ error: 'INVALID_DATA' });
  if (e.code === 'P0001') return reply.code(409).send({ error: 'BUSINESS_RULE', message: e.message });
  throw e;
};
const txt = (v, n) => typeof v === 'string' && v.trim().length > 0 && v.trim().length <= n;
const isDate = (v) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v));
const isUuid = (v) => typeof v === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;

// التقارير المسموح بتصديرها؛ الصلاحية تُفحص داخل مسار التقرير نفسه.
export const EXPORTABLE_REPORTS = {
  'trial-balance': 'ميزان المراجعة',
  'general-ledger': 'دفتر الأستاذ العام',
  'income-statement': 'قائمة الدخل',
  'balance-sheet': 'قائمة المركز المالي',
  'cost-center-summary': 'ملخص مراكز التكلفة',
  'inventory-valuation': 'تقييم المخزون',
  'expiry-alerts': 'تنبيهات الصلاحية',
  'production-costs': 'تكاليف الإنتاج',
  'production-losses': 'هالك الإنتاج',
  'production-material-variance': 'انحراف استهلاك الخامات',
  'production-yield': 'مردود الإنتاج',
  'sales-summary': 'ملخص المبيعات',
  'customer-statement': 'كشف حساب عميل',
  'customer-aging': 'أعمار مديونيات العملاء',
  'supplier-statement': 'كشف حساب مورد',
  'supplier-aging': 'أعمار الدائنين'
};

const HEADERS_AR = {
  code: 'الكود', account_code: 'كود الحساب', name_ar: 'الاسم', account_name: 'اسم الحساب', account_type: 'نوع الحساب',
  total_debit: 'إجمالي المدين', total_credit: 'إجمالي الدائن', balance: 'الرصيد', debit: 'مدين', credit: 'دائن',
  entry_no: 'رقم القيد', entry_date: 'التاريخ', description: 'البيان', source_type: 'نوع المصدر',
  opening_balance: 'رصيد افتتاحي', running_balance: 'الرصيد الجاري', section: 'القسم', label: 'البند', amount: 'المبلغ',
  cost_center_code: 'كود مركز التكلفة', cost_center_name: 'مركز التكلفة', revenue_total: 'الإيرادات', expense_total: 'المصروفات',
  net: 'الصافي', item_code: 'كود الصنف', item_name: 'الصنف', warehouse_code: 'المخزن', lot_no: 'التشغيلة',
  expiry_date: 'تاريخ الصلاحية', quantity: 'الكمية', average_unit_cost: 'متوسط التكلفة', stock_value: 'قيمة المخزون',
  quality_status: 'حالة الجودة', order_no: 'رقم الأمر', invoice_no: 'رقم الفاتورة', customer_name: 'العميل', supplier_name: 'المورد'
};

const NUMERIC_RE = /^-?\d+(\.\d+)?$/;
const KEEP_AS_TEXT_RE = /(code|_no$|^no$|_id$|^id$|lot)/i;

// يحوّل نتيجة تقرير JSON إلى صفوف مسطحة.
export function toRows(data) {
  if (Array.isArray(data)) return data;
  if (data && Array.isArray(data.rows)) return data.rows;
  if (data && Array.isArray(data.lines)) return data.lines;
  if (data && typeof data === 'object') {
    return Object.entries(data)
      .filter(([, v]) => v === null || ['string', 'number', 'boolean'].includes(typeof v))
      .map(([k, v]) => ({ label: k, amount: v }));
  }
  return [];
}

function cellValue(key, v) {
  if (v === null || v === undefined) return '';
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === 'object') return JSON.stringify(v);
  if (typeof v === 'string' && NUMERIC_RE.test(v) && !KEEP_AS_TEXT_RE.test(key)) return Number(v);
  return v;
}

function columnsOf(rows) {
  const keys = [];
  for (const r of rows) for (const k of Object.keys(r)) if (!keys.includes(k)) keys.push(k);
  return keys;
}

function csvEscape(v) {
  let s = String(v);
  // منع حقن المعادلات عند فتح الملف في Excel (للنصوص فقط وليس الأرقام).
  if (typeof v === 'string' && /^[=+\-@\t\r]/.test(s) && !NUMERIC_RE.test(s)) s = "'" + s;
  return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

export function buildCsv(rows) {
  const cols = columnsOf(rows);
  const lines = [cols.map((c) => csvEscape(HEADERS_AR[c] || c)).join(',')];
  for (const r of rows) lines.push(cols.map((c) => csvEscape(cellValue(c, r[c]))).join(','));
  return '﻿' + lines.join('\r\n') + '\r\n';
}

export async function buildXlsx(title, rows) {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'NEW FEED ERP';
  wb.created = new Date();
  const ws = wb.addWorksheet(String(title).slice(0, 31).replace(/[\\/?*[\]:]/g, ' '), { views: [{ rightToLeft: true, state: 'frozen', ySplit: 1 }] });
  const cols = columnsOf(rows);
  ws.columns = cols.map((c) => ({ header: HEADERS_AR[c] || c, key: c, width: Math.max(14, Math.min(40, (HEADERS_AR[c] || c).length + 6)) }));
  for (const r of rows) ws.addRow(Object.fromEntries(cols.map((c) => [c, cellValue(c, r[c])])));
  const head = ws.getRow(1);
  head.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  head.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F4E79' } };
  head.alignment = { horizontal: 'center' };
  ws.columns.forEach((col) => {
    col.eachCell({ includeEmpty: false }, (cell, rowNumber) => {
      if (rowNumber > 1 && typeof cell.value === 'number') cell.numFmt = '#,##0.00';
    });
  });
  return Buffer.from(await wb.xlsx.writeBuffer());
}

export async function financeExtrasRoutes(app, { db }) {
  // ---------- مراكز التكلفة ----------
  app.get('/api/v1/accounting/cost-centers', auth(app, 'ACCOUNTING.READ'), async (_req, rep) => {
    try {
      return (await db.query(`SELECT c.id,c.code,c.name_ar,c.is_active,c.parent_id,p.code parent_code,p.name_ar parent_name
        FROM cost_centers c LEFT JOIN cost_centers p ON p.id=c.parent_id ORDER BY c.code`)).rows;
    } catch (e) { return fail(rep, e); }
  });

  app.post('/api/v1/accounting/cost-centers', auth(app, 'COST_CENTERS.MANAGE'), async (req, rep) => {
    const b = req.body ?? {};
    const code = typeof b.code === 'string' ? b.code.trim().toUpperCase() : '';
    if (!/^[A-Z0-9][A-Z0-9._-]{0,29}$/.test(code) || !txt(b.nameAr, 160) || (b.parentId != null && !isUuid(b.parentId))) return bad(rep);
    try {
      const r = await db.query('INSERT INTO cost_centers(code,name_ar,parent_id,created_by) VALUES($1,$2,$3,$4) RETURNING *',
        [code, b.nameAr.trim(), b.parentId ?? null, req.authUser.user_id]);
      return rep.code(201).send(r.rows[0]);
    } catch (e) { return fail(rep, e); }
  });

  app.patch('/api/v1/accounting/cost-centers/:id', auth(app, 'COST_CENTERS.MANAGE'), async (req, rep) => {
    const b = req.body ?? {};
    if (!isUuid(req.params.id)) return bad(rep);
    if ((b.nameAr != null && !txt(b.nameAr, 160)) || (b.isActive != null && typeof b.isActive !== 'boolean')
      || (b.parentId != null && !isUuid(b.parentId))) return bad(rep);
    try {
      if (b.parentId) {
        // منع الحلقات: لا يجوز أن يكون الأب هو المركز نفسه أو أحد فروعه.
        const cycle = await db.query(`WITH RECURSIVE up AS (
            SELECT id,parent_id FROM cost_centers WHERE id=$2
            UNION ALL SELECT c.id,c.parent_id FROM cost_centers c JOIN up ON c.id=up.parent_id)
          SELECT 1 FROM up WHERE id=$1`, [req.params.id, b.parentId]);
        if (cycle.rowCount) return rep.code(409).send({ error: 'BUSINESS_RULE', message: 'لا يمكن جعل المركز تابعاً لنفسه أو لأحد فروعه' });
      }
      const r = await db.query(`UPDATE cost_centers SET name_ar=COALESCE($2,name_ar),is_active=COALESCE($3,is_active),
          parent_id=CASE WHEN $4::boolean THEN $5::uuid ELSE parent_id END WHERE id=$1 RETURNING *`,
        [req.params.id, b.nameAr?.trim() ?? null, b.isActive ?? null, Object.prototype.hasOwnProperty.call(b, 'parentId'), b.parentId ?? null]);
      return r.rowCount ? r.rows[0] : rep.code(404).send({ error: 'NOT_FOUND' });
    } catch (e) { return fail(rep, e); }
  });

  // ---------- قائمة الدخل ----------
  app.get('/api/v1/reports/income-statement', auth(app, 'REPORTS.READ'), async (req, rep) => {
    const from = req.query?.from ?? null, to = req.query?.to ?? null, cc = req.query?.costCenterId ?? null;
    if ((from && !isDate(from)) || (to && !isDate(to)) || (cc && !isUuid(cc))) return bad(rep);
    if (from && to && from > to) return bad(rep, 'تاريخ البداية يجب ألا يتجاوز تاريخ النهاية');
    try {
      const rows = (await db.query(`SELECT a.code,a.name_ar,a.account_type,
          COALESCE(SUM(l.debit),0) debit,COALESCE(SUM(l.credit),0) credit
        FROM gl_accounts a
        JOIN journal_lines l ON l.account_id=a.id
        JOIN journal_entries j ON j.id=l.journal_entry_id
         AND ($1::date IS NULL OR j.entry_date>=$1) AND ($2::date IS NULL OR j.entry_date<=$2)
        WHERE a.account_type IN ('REVENUE','EXPENSE') AND ($3::uuid IS NULL OR l.cost_center_id=$3)
        GROUP BY a.id ORDER BY a.code`, [from, to, cc])).rows;
      const revenues = rows.filter((x) => x.account_type === 'REVENUE')
        .map((x) => ({ code: x.code, name_ar: x.name_ar, amount: round2(Number(x.credit) - Number(x.debit)) }));
      const expenses = rows.filter((x) => x.account_type === 'EXPENSE')
        .map((x) => ({ code: x.code, name_ar: x.name_ar, amount: round2(Number(x.debit) - Number(x.credit)) }));
      const totalRevenue = round2(revenues.reduce((s, x) => s + x.amount, 0));
      const totalExpenses = round2(expenses.reduce((s, x) => s + x.amount, 0));
      const netIncome = round2(totalRevenue - totalExpenses);
      return {
        from, to, costCenterId: cc, revenues, expenses, totalRevenue, totalExpenses, netIncome,
        rows: [
          ...revenues.map((x) => ({ section: 'الإيرادات', code: x.code, label: x.name_ar, amount: x.amount })),
          { section: 'الإيرادات', code: '', label: 'إجمالي الإيرادات', amount: totalRevenue },
          ...expenses.map((x) => ({ section: 'المصروفات', code: x.code, label: x.name_ar, amount: x.amount })),
          { section: 'المصروفات', code: '', label: 'إجمالي المصروفات', amount: totalExpenses },
          { section: 'النتيجة', code: '', label: netIncome >= 0 ? 'صافي الربح' : 'صافي الخسارة', amount: netIncome }
        ]
      };
    } catch (e) { return fail(rep, e); }
  });

  // ---------- قائمة المركز المالي ----------
  app.get('/api/v1/reports/balance-sheet', auth(app, 'REPORTS.READ'), async (req, rep) => {
    const asOf = req.query?.asOf ?? new Date().toISOString().slice(0, 10);
    if (!isDate(asOf)) return bad(rep);
    try {
      const rows = (await db.query(`SELECT a.code,a.name_ar,a.account_type,
          COALESCE(SUM(l.debit),0) debit,COALESCE(SUM(l.credit),0) credit
        FROM gl_accounts a
        JOIN journal_lines l ON l.account_id=a.id
        JOIN journal_entries j ON j.id=l.journal_entry_id AND j.entry_date<=$1::date
        GROUP BY a.id ORDER BY a.code`, [asOf])).rows;
      const pick = (type, sign) => rows.filter((x) => x.account_type === type)
        .map((x) => ({ code: x.code, name_ar: x.name_ar, amount: round2(sign * (Number(x.debit) - Number(x.credit))) }))
        .filter((x) => x.amount !== 0);
      const assets = pick('ASSET', 1);
      const liabilities = pick('LIABILITY', -1);
      const equity = pick('EQUITY', -1);
      const revenue = rows.filter((x) => x.account_type === 'REVENUE').reduce((s, x) => s + Number(x.credit) - Number(x.debit), 0);
      const expense = rows.filter((x) => x.account_type === 'EXPENSE').reduce((s, x) => s + Number(x.debit) - Number(x.credit), 0);
      const currentEarnings = round2(revenue - expense);
      const equityWithEarnings = currentEarnings !== 0
        ? [...equity, { code: '', name_ar: 'أرباح/خسائر الفترة غير المقفلة', amount: currentEarnings }] : equity;
      const sum = (xs) => round2(xs.reduce((s, x) => s + x.amount, 0));
      const totalAssets = sum(assets), totalLiabilities = sum(liabilities), totalEquity = sum(equityWithEarnings);
      return {
        asOf, assets, liabilities, equity: equityWithEarnings, totalAssets, totalLiabilities, totalEquity,
        balanced: Math.abs(totalAssets - totalLiabilities - totalEquity) < 0.01,
        rows: [
          ...assets.map((x) => ({ section: 'الأصول', code: x.code, label: x.name_ar, amount: x.amount })),
          { section: 'الأصول', code: '', label: 'إجمالي الأصول', amount: totalAssets },
          ...liabilities.map((x) => ({ section: 'الالتزامات', code: x.code, label: x.name_ar, amount: x.amount })),
          { section: 'الالتزامات', code: '', label: 'إجمالي الالتزامات', amount: totalLiabilities },
          ...equityWithEarnings.map((x) => ({ section: 'حقوق الملكية', code: x.code, label: x.name_ar, amount: x.amount })),
          { section: 'حقوق الملكية', code: '', label: 'إجمالي حقوق الملكية', amount: totalEquity }
        ]
      };
    } catch (e) { return fail(rep, e); }
  });

  // ---------- ملخص مراكز التكلفة ----------
  app.get('/api/v1/reports/cost-center-summary', auth(app, 'REPORTS.READ'), async (req, rep) => {
    const from = req.query?.from ?? null, to = req.query?.to ?? null;
    if ((from && !isDate(from)) || (to && !isDate(to))) return bad(rep);
    if (from && to && from > to) return bad(rep, 'تاريخ البداية يجب ألا يتجاوز تاريخ النهاية');
    try {
      return (await db.query(`SELECT COALESCE(c.code,'-') cost_center_code,COALESCE(c.name_ar,'بدون مركز تكلفة') cost_center_name,
          COALESCE(SUM(CASE WHEN a.account_type='REVENUE' THEN l.credit-l.debit ELSE 0 END),0) revenue_total,
          COALESCE(SUM(CASE WHEN a.account_type='EXPENSE' THEN l.debit-l.credit ELSE 0 END),0) expense_total,
          COALESCE(SUM(CASE WHEN a.account_type='REVENUE' THEN l.credit-l.debit ELSE 0 END),0)
            -COALESCE(SUM(CASE WHEN a.account_type='EXPENSE' THEN l.debit-l.credit ELSE 0 END),0) net
        FROM journal_lines l
        JOIN gl_accounts a ON a.id=l.account_id AND a.account_type IN ('REVENUE','EXPENSE')
        JOIN journal_entries j ON j.id=l.journal_entry_id
         AND ($1::date IS NULL OR j.entry_date>=$1) AND ($2::date IS NULL OR j.entry_date<=$2)
        LEFT JOIN cost_centers c ON c.id=l.cost_center_id
        GROUP BY c.id ORDER BY cost_center_code`, [from, to])).rows;
    } catch (e) { return fail(rep, e); }
  });

  // ---------- تصدير التقارير ----------
  app.get('/api/v1/export/:report', { preHandler: [app.authenticate] }, async (req, rep) => {
    const key = req.params.report;
    if (!Object.hasOwn(EXPORTABLE_REPORTS, key)) return rep.code(404).send({ error: 'NOT_FOUND', message: 'تقرير غير قابل للتصدير' });
    const format = String(req.query?.format ?? 'xlsx').toLowerCase();
    if (!['xlsx', 'csv'].includes(format)) return bad(rep, 'الصيغة المتاحة: xlsx أو csv');
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(req.query ?? {})) if (k !== 'format' && typeof v === 'string') qs.set(k, v);
    // نمرّر الطلب إلى مسار التقرير نفسه كي تُطبَّق صلاحياته وتحققاته كما هي.
    const inner = await app.inject({
      method: 'GET', url: `/api/v1/reports/${key}${qs.toString() ? '?' + qs : ''}`,
      headers: { authorization: req.headers.authorization }
    });
    if (inner.statusCode !== 200) return rep.code(inner.statusCode).type('application/json').send(inner.body);
    const rows = toRows(inner.json());
    const stamp = new Date().toISOString().slice(0, 10);
    const filename = `newfeed-${key}-${stamp}.${format}`;
    rep.header('Content-Disposition', `attachment; filename="${filename}"`).header('Cache-Control', 'no-store');
    if (format === 'csv') return rep.type('text/csv; charset=utf-8').send(buildCsv(rows));
    return rep.type('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
      .send(await buildXlsx(EXPORTABLE_REPORTS[key], rows));
  });
}
