/* إضافات واجهة المالية: مراكز التكلفة، قائمة الدخل، المركز المالي، تصدير Excel وطباعة PDF.
   تُحمَّل بعد الواجهة الرئيسية وتعتمد على دوالها العامة (api, apiPost, can, go, escapeHtml, headers). */
(function () {
  'use strict';
  if (typeof modules === 'undefined' || typeof go !== 'function') return;

  const money = (v) => Number(v || 0).toLocaleString('ar-EG', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const EXTRA_REPORTS = [
    ['income-statement', 'قائمة الدخل'],
    ['balance-sheet', 'قائمة المركز المالي (الميزانية)'],
    ['cost-center-summary', 'ملخص مراكز التكلفة']
  ];

  // ---- شاشة مراكز التكلفة ----
  if (!modules.some((m) => m[0] === 'costCenters')) {
    const at = modules.findIndex((m) => m[0] === 'reports');
    modules.splice(at < 0 ? modules.length : at, 0, ['costCenters', 'مراكز التكلفة', '◎', '/api/v1/accounting/cost-centers']);
  }

  async function costCentersScreen() {
    const c = document.querySelector('#content');
    let rows;
    try { rows = await api('/api/v1/accounting/cost-centers'); } catch (e) { c.innerHTML = '<div class="notice">' + escapeHtml(e.message) + '</div>'; return; }
    const manage = can('COST_CENTERS.MANAGE');
    c.innerHTML = (manage ? '<div class="panel"><h2>إضافة مركز تكلفة</h2><form id="ccForm"><div class="form-grid">' +
      '<div class="field"><label>الكود (حروف إنجليزية/أرقام)</label><input name="code" required maxlength="30" pattern="[A-Za-z0-9][A-Za-z0-9._\-]*"></div>' +
      '<div class="field"><label>الاسم</label><input name="nameAr" required maxlength="160"></div>' +
      '<div class="field"><label>المركز الأب (اختياري)</label><select name="parentId"><option value="">بدون</option>' +
      rows.filter((x) => x.is_active).map((x) => '<option value="' + x.id + '">' + escapeHtml(x.code + ' - ' + x.name_ar) + '</option>').join('') +
      '</select></div></div><div class="form-actions"><button class="btn">حفظ</button></div><p id="ccError" class="error"></p></form></div>' : '') +
      '<div class="panel"><h2>مراكز التكلفة</h2><div id="ccList"></div></div>';
    const list = c.querySelector('#ccList');
    if (!rows.length) list.innerHTML = '<div class="empty">لا توجد مراكز تكلفة.</div>';
    rows.forEach((x) => {
      const d = document.createElement('div');
      d.className = 'notice';
      d.innerHTML = '<b>' + escapeHtml(x.code) + ' — ' + escapeHtml(x.name_ar) + '</b><div>' +
        (x.parent_code ? 'تابع لـ ' + escapeHtml(x.parent_code) + ' | ' : '') + (x.is_active ? 'نشط' : 'موقوف') + '</div><div class="actions"></div>';
      if (manage) {
        const b = document.createElement('button');
        b.className = 'btn secondary';
        b.textContent = x.is_active ? 'إيقاف' : 'تفعيل';
        b.onclick = async () => {
          try {
            const r = await fetch('/api/v1/accounting/cost-centers/' + x.id, { method: 'PATCH', headers: headers(), body: JSON.stringify({ isActive: !x.is_active }) });
            if (!r.ok) throw Error((await r.json().catch(() => ({}))).message || 'تعذر التحديث');
            await costCentersScreen();
          } catch (e) { alert(e.message); }
        };
        d.querySelector('.actions').append(b);
      }
      list.append(d);
    });
    const f = c.querySelector('#ccForm');
    if (f) f.onsubmit = async (ev) => {
      ev.preventDefault();
      const fd = Object.fromEntries(new FormData(f));
      try { await apiPost('/api/v1/accounting/cost-centers', { code: fd.code, nameAr: fd.nameAr, parentId: fd.parentId || undefined }); await costCentersScreen(); }
      catch (e) { c.querySelector('#ccError').textContent = e.message; }
    };
  }

  // ---- تقارير: خيارات جديدة + تصدير + طباعة ----
  function section(title, items) {
    return '<tr class="sec"><th colspan="3">' + escapeHtml(title) + '</th></tr>' +
      items.map((x) => '<tr><td>' + escapeHtml(x.code || '') + '</td><td>' + escapeHtml(x.name_ar) + '</td><td>' + money(x.amount) + '</td></tr>').join('');
  }
  function renderStatement(type, data) {
    if (type === 'income-statement') {
      return '<div class="cards"><div class="card"><small>الإيرادات</small><div class="metric">' + money(data.totalRevenue) + '</div></div>' +
        '<div class="card"><small>المصروفات</small><div class="metric">' + money(data.totalExpenses) + '</div></div>' +
        '<div class="card"><small>' + (data.netIncome >= 0 ? 'صافي الربح' : 'صافي الخسارة') + '</small><div class="metric">' + money(data.netIncome) + '</div></div></div>' +
        '<div class="table-wrap"><table><thead><tr><th>الكود</th><th>الحساب</th><th>المبلغ</th></tr></thead><tbody>' +
        section('الإيرادات', data.revenues) + section('المصروفات', data.expenses) + '</tbody></table></div>';
    }
    return '<div class="notice">' + (data.balanced ? 'الميزانية متوازنة' : 'تحذير: الميزانية غير متوازنة') + ' — حتى تاريخ ' + escapeHtml(data.asOf) + '</div>' +
      '<div class="table-wrap"><table><thead><tr><th>الكود</th><th>الحساب</th><th>المبلغ</th></tr></thead><tbody>' +
      section('الأصول (' + money(data.totalAssets) + ')', data.assets) + section('الالتزامات (' + money(data.totalLiabilities) + ')', data.liabilities) +
      section('حقوق الملكية (' + money(data.totalEquity) + ')', data.equity) + '</tbody></table></div>';
  }
  function reportQuery(type) {
    const q = new URLSearchParams();
    const v = (id) => (document.querySelector(id) || {}).value || '';
    const from = v('#reportFrom'), to = v('#reportTo'), acc = v('#ledgerAccountId').trim(), party = v('#customerCode').trim(), po = v('#productionOrderId').trim();
    if (['trial-balance', 'sales-summary', 'production-losses', 'general-ledger', 'customer-statement', 'supplier-statement', 'production-material-variance', 'production-yield', 'income-statement', 'cost-center-summary'].includes(type)) {
      if (from) q.set('from', from);
      if (to) q.set('to', to);
    }
    if (type === 'balance-sheet' && to) q.set('asOf', to);
    if (type === 'general-ledger' && acc) q.set('accountId', acc);
    if (['production-material-variance', 'production-yield'].includes(type) && po) q.set('productionOrderId', po);
    if (['customer-statement', 'customer-aging'].includes(type) && party) q.set('customerCode', party);
    if (['supplier-statement', 'supplier-aging'].includes(type) && party) q.set('supplierCode', party);
    if (['customer-aging', 'supplier-aging'].includes(type)) q.set('asOf', to || new Date().toISOString().slice(0, 10));
    return q;
  }
  async function downloadExport(type, format) {
    const q = reportQuery(type);
    q.set('format', format);
    const r = await fetch('/api/v1/export/' + type + '?' + q, { headers: { Authorization: headers().Authorization } });
    if (!r.ok) throw Error((await r.json().catch(() => ({}))).message || 'تعذر التصدير (HTTP ' + r.status + ')');
    const blob = await r.blob();
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'newfeed-' + type + '-' + new Date().toISOString().slice(0, 10) + '.' + format;
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  }
  function printReport(title) {
    const host = document.querySelector('#reportData');
    const win = window.open('', '_blank');
    if (!win) { alert('يرجى السماح بالنوافذ المنبثقة للطباعة'); return; }
    win.document.open();
    win.document.write('<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><title>' + escapeHtml(title) +
      '</title><style>body{font-family:Tahoma,Arial,sans-serif;margin:16mm;color:#111}h1{font-size:20px}table{width:100%;border-collapse:collapse;margin:12px 0;font-size:12px}' +
      'th,td{border:1px solid #666;padding:6px;text-align:right}th,.sec th{background:#eee}.cards{display:flex;gap:12px;margin:12px 0}.card{border:1px solid #666;padding:8px;flex:1}' +
      '.metric{font-weight:bold;font-size:16px}small{color:#444}@page{size:A4;margin:12mm}</style></head><body><h1>NEW FEED ERP — ' + escapeHtml(title) +
      '</h1><small>' + new Date().toLocaleString('ar-EG') + '</small>' + host.innerHTML + '</body></html>');
    win.document.close();
    win.focus();
    setTimeout(() => win.print(), 300);
  }

  const baseReports = reportsScreen;
  reportsScreen = async function () {
    await baseReports.apply(this, arguments);
    const sel = document.querySelector('#reportType'), btn = document.querySelector('#loadReport');
    if (!sel || !btn || sel.dataset.fx) return;
    sel.dataset.fx = '1';
    EXTRA_REPORTS.forEach(([v, t]) => { const o = document.createElement('option'); o.value = v; o.textContent = t; sel.prepend(o); });
    sel.value = 'trial-balance';
    const original = btn.onclick;
    btn.onclick = async () => {
      const type = sel.value;
      if (!EXTRA_REPORTS.some((x) => x[0] === type)) return original.apply(btn, arguments);
      const err = document.querySelector('#reportError'), out = document.querySelector('#reportData');
      err.textContent = '';
      out.innerHTML = '<div class="empty">جارٍ تحميل التقرير...</div>';
      try {
        const q = reportQuery(type).toString();
        const data = await api('/api/v1/reports/' + type + (q ? '?' + q : ''));
        if (type === 'cost-center-summary') {
          out.innerHTML = '<div class="table-wrap"><table><thead><tr><th>الكود</th><th>مركز التكلفة</th><th>الإيرادات</th><th>المصروفات</th><th>الصافي</th></tr></thead><tbody>' +
            data.map((x) => '<tr><td>' + escapeHtml(x.cost_center_code) + '</td><td>' + escapeHtml(x.cost_center_name) + '</td><td>' + money(x.revenue_total) + '</td><td>' + money(x.expense_total) + '</td><td>' + money(x.net) + '</td></tr>').join('') +
            '</tbody></table></div>' + (data.length ? '' : '<div class="empty">لا توجد حركات.</div>');
        } else out.innerHTML = renderStatement(type, data);
      } catch (e) { err.textContent = e.message; out.innerHTML = '<div class="empty">تعذر تحميل التقرير.</div>'; }
    };
    const bar = document.createElement('div');
    bar.className = 'form-actions';
    const mk = (text, fn) => { const b = document.createElement('button'); b.type = 'button'; b.className = 'btn secondary'; b.textContent = text; b.onclick = fn; bar.append(b); };
    const guard = (fn) => async () => { try { document.querySelector('#reportError').textContent = ''; await fn(); } catch (e) { document.querySelector('#reportError').textContent = e.message; } };
    mk('تصدير Excel', guard(() => downloadExport(sel.value, 'xlsx')));
    mk('تصدير CSV', guard(() => downloadExport(sel.value, 'csv')));
    mk('طباعة / حفظ PDF', () => printReport(sel.options[sel.selectedIndex].textContent));
    btn.parentElement.append(bar);
  };

  const baseGo = go;
  go = async function (id) {
    if (id === 'costCenters') {
      activate(id);
      document.querySelector('#pageTitle').textContent = 'مراكز التكلفة';
      document.querySelector('#content').innerHTML = '<div class="panel">جارٍ تحميل البيانات...</div>';
      return costCentersScreen();
    }
    return baseGo.apply(this, arguments);
  };
  if (typeof renderNav === 'function' && typeof currentUser !== 'undefined' && currentUser) renderNav();
})();
