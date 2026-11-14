const MAX_MESSAGE_LENGTH = 4000;
const MAX_CONTEXT_ROWS = 50;

function auth(app) {
  return { preHandler: [app.authenticate, app.requirePermission('AI.ASSISTANT.USE')] };
}

function extractText(payload) {
  if (typeof payload?.output_text === 'string' && payload.output_text.trim()) return payload.output_text.trim();
  const parts = [];
  for (const item of payload?.output ?? []) {
    if (item.type !== 'message' || !Array.isArray(item.content)) continue;
    for (const content of item.content) {
      if (content.type === 'output_text' && typeof content.text === 'string') parts.push(content.text);
    }
  }
  return parts.join('\n').trim();
}

export function detectDataIntent(message) {
  const value = message.toLowerCase();
  if (/انتهاء الصلاحية|تاريخ الصلاحية|منتهية الصلاحية|قرب انتهاء|تشغيلات.*انتهاء|expiry|expired|expiring/.test(value)) return 'inventory';
  if (/مخزون|رصيد|أرصدة|خامات|اصناف|أصناف|inventory|stock|items/.test(value)) return 'inventory';
  if (/إنتاج|انتاج|تشغيلات|أوامر الإنتاج|امر انتاج|production|manufacturing/.test(value)) return 'production';
  if (/مستحقات العملاء|أعمار الديون للعملاء|مديونية العملاء|ذمم العملاء|receivables|customer aging/.test(value)) return 'receivables';
  if (/مستحقات الموردين|أعمار الديون للموردين|مديونية الموردين|ذمم الموردين|payables|supplier aging/.test(value)) return 'payables';
  if (/مبيعات|فواتير بيع|عملاء|sales|invoices/.test(value)) return 'sales';
  if (/ميزان مراجعة|ميزان|قيود محاسبية|الحسابات|حسابات|دفتر الأستاذ|trial balance|general ledger|accounting/.test(value)) return 'accounting';
  if (/مشتريات|أوامر شراء|موردين|purchase|suppliers/.test(value)) return 'purchases';
  return null;
}

const permissionByIntent = {
  inventory: ['INVENTORY.READ'],
  production: ['PRODUCTION.READ'],
  sales: ['SALES.READ'],
  purchases: ['PURCHASES.READ'],
  accounting: ['ACCOUNTING.READ', 'REPORTS.READ'],
  receivables: ['REPORTS.READ'],
  payables: ['REPORTS.READ']
};

async function readErpContext(db, request, intent) {
  if (!intent) return null;
  const permissions = permissionByIntent[intent];
  const allowed = await db.query(
    `SELECT COUNT(DISTINCT p.code)::int granted
       FROM user_roles ur
       JOIN role_permissions rp ON rp.role_id=ur.role_id
       JOIN permissions p ON p.id=rp.permission_id
       JOIN roles r ON r.id=ur.role_id
       WHERE ur.user_id=$1 AND p.code=ANY($2::text[])
         AND p.is_active=TRUE AND r.is_active=TRUE`,
    [request.authUser.user_id, permissions]
  );
  if (Number(allowed.rows[0]?.granted ?? 0) !== permissions.length) {
    return { denied: true, message: 'المستخدم لا يملك صلاحية قراءة بيانات هذا القسم.' };
  }

  // Fixed read-only SQL only; user text is never interpolated into a query.
  const statements = {
    inventory: `SELECT i.code item_code,i.name_ar item_name,w.code warehouse_code,b.quality_status,
       b.expiry_date,
       CASE WHEN b.expiry_date IS NULL THEN NULL
            WHEN b.expiry_date<CURRENT_DATE THEN 'EXPIRED'
            WHEN b.expiry_date<=CURRENT_DATE+30 THEN 'EXPIRING_SOON'
            ELSE 'VALID' END expiry_status,
       CASE WHEN b.expiry_date IS NULL THEN NULL ELSE (b.expiry_date-CURRENT_DATE)::int END days_to_expiry,
       SUM(b.quantity)::numeric quantity,
       CASE WHEN SUM(b.quantity)>0
         THEN SUM(b.quantity*b.average_unit_cost)/SUM(b.quantity) ELSE 0 END::numeric average_unit_cost,
       COUNT(DISTINCT b.lot_no)::int lot_count
       FROM inventory_balances b JOIN items i ON i.id=b.item_id
       JOIN warehouses w ON w.id=b.warehouse_id
       WHERE b.quantity<>0
       GROUP BY i.code,i.name_ar,w.code,b.quality_status,b.expiry_date ORDER BY i.code,w.code,b.expiry_date,b.quality_status LIMIT ${MAX_CONTEXT_ROWS}`,
    production: `SELECT p.order_no,p.status,fp.code product_code,fp.name_ar product_name,
       p.planned_qty,p.actual_qty,p.total_material_cost,p.unit_production_cost,p.created_at
       FROM production_orders p JOIN feed_products fp ON fp.id=p.feed_product_id
       ORDER BY p.created_at DESC LIMIT ${MAX_CONTEXT_ROWS}`,
    sales: `SELECT i.invoice_no,i.invoice_date,i.status,c.code customer_code,c.name_ar customer_name,
       i.subtotal,i.discount_amount,i.total_amount
       FROM sales_invoices i JOIN customers c ON c.id=i.customer_id
       WHERE i.invoice_date>=CURRENT_DATE-INTERVAL '30 days'
       ORDER BY i.invoice_date DESC,i.invoice_no DESC LIMIT ${MAX_CONTEXT_ROWS}`,
    purchases: `SELECT p.order_no,p.order_date,p.status,s.code supplier_code,s.name_ar supplier_name,
       COALESCE(SUM(l.ordered_qty*l.unit_cost),0)::numeric order_value,
       COALESCE(SUM(l.ordered_qty),0)::numeric ordered_quantity
       FROM purchase_orders p JOIN suppliers s ON s.id=p.supplier_id
       LEFT JOIN purchase_order_lines l ON l.purchase_order_id=p.id
       WHERE p.order_date>=CURRENT_DATE-INTERVAL '30 days'
       GROUP BY p.id,s.code,s.name_ar ORDER BY p.order_date DESC,p.order_no DESC LIMIT ${MAX_CONTEXT_ROWS}`,
    accounting: `SELECT a.code account_code,a.name_ar account_name,a.account_type,
       COALESCE(SUM(CASE WHEN j.id IS NOT NULL THEN l.debit ELSE 0 END),0)::numeric total_debit,
       COALESCE(SUM(CASE WHEN j.id IS NOT NULL THEN l.credit ELSE 0 END),0)::numeric total_credit,
       COALESCE(SUM(CASE WHEN j.id IS NOT NULL THEN l.debit-l.credit ELSE 0 END),0)::numeric balance
       FROM gl_accounts a LEFT JOIN journal_lines l ON l.account_id=a.id
       LEFT JOIN journal_entries j ON j.id=l.journal_entry_id
       GROUP BY a.id ORDER BY a.code LIMIT ${MAX_CONTEXT_ROWS}`,
    receivables: `WITH paid AS (
       SELECT a.sales_invoice_id,SUM(a.amount)::numeric paid_amount
       FROM receipt_allocations a JOIN cash_receipts r ON r.id=a.receipt_id
       WHERE r.status='POSTED' GROUP BY a.sales_invoice_id
     ), returned AS (
       SELECT sr.sales_invoice_id,SUM(rl.quantity*rl.unit_price)::numeric returned_amount
       FROM sales_returns sr JOIN sales_return_lines rl ON rl.sales_return_id=sr.id
       WHERE sr.status='APPROVED' GROUP BY sr.sales_invoice_id
     ), balances AS (
       SELECT c.code customer_code,c.name_ar customer_name,
         GREATEST(0::numeric,i.total_amount-COALESCE(p.paid_amount,0)-COALESCE(x.returned_amount,0)) outstanding,
         (CURRENT_DATE-COALESCE(i.due_date,i.invoice_date))::int age_days
       FROM sales_invoices i JOIN customers c ON c.id=i.customer_id
       LEFT JOIN paid p ON p.sales_invoice_id=i.id LEFT JOIN returned x ON x.sales_invoice_id=i.id
       WHERE i.status IN ('POSTED','PARTIALLY_PAID','PAID') AND i.invoice_date<=CURRENT_DATE
     )
     SELECT customer_code,customer_name,COUNT(*)::int open_invoice_count,SUM(outstanding)::numeric outstanding,
       SUM(CASE WHEN age_days<0 THEN outstanding ELSE 0 END)::numeric not_due,
       SUM(CASE WHEN age_days BETWEEN 0 AND 30 THEN outstanding ELSE 0 END)::numeric bucket_0_30,
       SUM(CASE WHEN age_days BETWEEN 31 AND 60 THEN outstanding ELSE 0 END)::numeric bucket_31_60,
       SUM(CASE WHEN age_days BETWEEN 61 AND 90 THEN outstanding ELSE 0 END)::numeric bucket_61_90,
       SUM(CASE WHEN age_days>90 THEN outstanding ELSE 0 END)::numeric bucket_over_90
     FROM balances WHERE outstanding>0.000001 GROUP BY customer_code,customer_name
     ORDER BY outstanding DESC LIMIT ${MAX_CONTEXT_ROWS}`,
    payables: `WITH received AS (
       SELECT po.id purchase_order_id,po.supplier_id,
         COALESCE(po.payment_due_date,MIN(gr.received_at::date)) aging_date,
         SUM(gl.accepted_qty*gl.unit_cost)::numeric received_amount
       FROM purchase_orders po JOIN goods_receipts gr ON gr.purchase_order_id=po.id
       JOIN goods_receipt_lines gl ON gl.goods_receipt_id=gr.id
       WHERE gr.status IN ('ACCEPTED','PARTIAL') AND gr.received_at::date<=CURRENT_DATE
       GROUP BY po.id,po.supplier_id,po.payment_due_date
     ), paid AS (
       SELECT a.purchase_order_id,SUM(a.amount)::numeric paid_amount
       FROM supplier_payment_allocations a JOIN supplier_payments p ON p.id=a.supplier_payment_id
       WHERE p.status='POSTED' AND p.payment_date<=CURRENT_DATE GROUP BY a.purchase_order_id
     ), returned AS (
       SELECT r.purchase_order_id,SUM(l.quantity*l.unit_cost)::numeric returned_amount
       FROM purchase_returns r JOIN purchase_return_lines l ON l.purchase_return_id=r.id
       WHERE r.status='POSTED' AND r.accounting_approved_at::date<=CURRENT_DATE AND r.purchase_order_id IS NOT NULL
       GROUP BY r.purchase_order_id
     ), balances AS (
       SELECT s.code supplier_code,s.name_ar supplier_name,
         GREATEST(0::numeric,r.received_amount-COALESCE(p.paid_amount,0)-COALESCE(x.returned_amount,0)) outstanding,
         (CURRENT_DATE-r.aging_date)::int age_days
       FROM received r JOIN suppliers s ON s.id=r.supplier_id
       LEFT JOIN paid p ON p.purchase_order_id=r.purchase_order_id
       LEFT JOIN returned x ON x.purchase_order_id=r.purchase_order_id
     )
     SELECT supplier_code,supplier_name,COUNT(*)::int open_order_count,SUM(outstanding)::numeric outstanding,
       SUM(CASE WHEN age_days<0 THEN outstanding ELSE 0 END)::numeric not_due,
       SUM(CASE WHEN age_days BETWEEN 0 AND 30 THEN outstanding ELSE 0 END)::numeric bucket_0_30,
       SUM(CASE WHEN age_days BETWEEN 31 AND 60 THEN outstanding ELSE 0 END)::numeric bucket_31_60,
       SUM(CASE WHEN age_days BETWEEN 61 AND 90 THEN outstanding ELSE 0 END)::numeric bucket_61_90,
       SUM(CASE WHEN age_days>90 THEN outstanding ELSE 0 END)::numeric bucket_over_90
     FROM balances WHERE outstanding>0.000001 GROUP BY supplier_code,supplier_name
     ORDER BY outstanding DESC LIMIT ${MAX_CONTEXT_ROWS}`
  };

  await db.query(
    `INSERT INTO audit_logs(actor_user_id,action,entity_type,entity_id,details)
     VALUES($1,'AI_READ_ONLY_DATA_ACCESS',$2,NULL,$3::jsonb)`,
    [request.authUser.user_id, intent.toUpperCase(), JSON.stringify({ permissions, rowLimit: MAX_CONTEXT_ROWS })]
  );

  const client = await db.connect();
  try {
    await client.query('BEGIN READ ONLY');
    await client.query("SET LOCAL statement_timeout = '5s'");
    const result = await client.query(statements[intent]);
    await client.query('COMMIT');
    return { section: intent, rowCount: result.rowCount, rows: result.rows };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

export async function aiAssistantRoutes(app, { db }) {
  app.get('/api/v1/ai/status', { ...auth(app) }, async () => ({
    enabled: Boolean(process.env.OPENAI_API_KEY),
    provider: 'OpenAI',
    mode: 'read-only-erp-context',
    configuredModel: process.env.OPENAI_MODEL || 'gpt-6-astra'
  }));

  app.post('/api/v1/ai/chat', {
    ...auth(app),
    schema: {
      body: {
        type: 'object',
        additionalProperties: false,
        required: ['message'],
        properties: { message: { type: 'string', minLength: 1, maxLength: MAX_MESSAGE_LENGTH } }
      }
    }
  }, async (request, reply) => {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      return reply.code(503).send({
        error: 'AI_NOT_CONFIGURED',
        message: 'خدمة المساعد الذكي غير مفعّلة؛ يرجى مراجعة مسؤول النظام'
      });
    }

    const message = request.body.message.trim();
    if (!message) return reply.code(400).send({ error: 'EMPTY_MESSAGE', message: 'اكتب سؤالك أولاً' });

    let erpContext = null;
    try {
      erpContext = await readErpContext(db, request, detectDataIntent(message));
    } catch (error) {
      request.log.error({ code: error.code }, 'Read-only ERP context query failed');
      return reply.code(503).send({
        error: 'ERP_CONTEXT_UNAVAILABLE',
        message: 'تعذر قراءة بيانات القسم المطلوب حالياً؛ لم يتم تنفيذ أي تعديل على بيانات النظام'
      });
    }

    let upstream;
    try {
      upstream = await fetch('https://api.openai.com/v1/responses', {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: process.env.OPENAI_MODEL || 'gpt-6-astra',
          instructions: [
            'أنت مساعد NEW FEED ERP لمصنع أعلاف في مصر.',
            'أجب باللغة العربية الواضحة وباختصار عملي.',
            'لا تدّعِ أنك اطلعت على بيانات النظام إلا عندما تكون بيانات ERP الفعلية مرفقة في السياق المصرح به؛ استخدم البيانات المرفقة فقط كما هي ولا تخترع أرقاماً أو سجلات.',
            'إذا لم تصلك بيانات، وضّح أن الإجابة لا تستند إلى قراءة مباشرة.',
            'البيانات للقراءة فقط. لا تنفذ ولا توصي باعتماد أو تعديل حركات مالية أو مخزنية نيابة عن المستخدم.',
            'اذكر أن المبيعات والمشتريات في السياق تخص آخر 30 يوماً عندما ينطبق ذلك.',
            'في بيانات المخزون، وضّح حالة الجودة وتاريخ الصلاحية وعدد الأيام المتبقية؛ EXPIRED منتهي، EXPIRING_SOON خلال 30 يوماً، وVALID أبعد من ذلك. لا تعتبر PENDING_QC أو QUARANTINED صالحاً للبيع.',
            'ملخص الحسابات يعرض القيود المرحلة فقط ويجب عدم اعتباره ميزان مراجعة معتمداً دون مراجعة محاسب النظام.',
            'إذا كانت نتيجة الاستعلام فارغة فقل ذلك بوضوح.'
          ].join(' '),
          input: erpContext
            ? `سؤال المستخدم: ${message}\nبيانات ERP المسموح بها (JSON): ${JSON.stringify(erpContext)}`
            : message,
          max_output_tokens: 900,
          store: false
        }),
        signal: AbortSignal.timeout(30000)
      });
    } catch {
      request.log.error('OpenAI request failed before receiving a response');
      return reply.code(502).send({ error: 'AI_PROVIDER_UNAVAILABLE', message: 'تعذر الاتصال بخدمة الذكاء الاصطناعي حالياً' });
    }

    if (!upstream.ok) {
      const status = upstream.status;
      request.log.warn({ status }, 'OpenAI API returned an error');
      return reply.code(status === 429 ? 503 : 502).send({
        error: status === 429 ? 'AI_RATE_LIMITED' : 'AI_PROVIDER_ERROR',
        message: status === 429 ? 'الخدمة مشغولة حالياً؛ حاول بعد قليل' : 'حدث خطأ في خدمة الذكاء الاصطناعي'
      });
    }

    const payload = await upstream.json();
    const answer = extractText(payload);
    if (!answer) {
      request.log.warn({ responseId: payload?.id }, 'OpenAI response contained no text');
      return reply.code(502).send({ error: 'AI_EMPTY_RESPONSE', message: 'لم تصل إجابة نصية من الخدمة' });
    }
    return { answer, model: process.env.OPENAI_MODEL || 'gpt-6-astra', dataAccess: erpContext?.section ?? 'none' };
  });
}
