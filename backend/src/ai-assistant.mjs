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
  if (/مخزون|رصيد|أرصدة|خامات|اصناف|أصناف|inventory|stock|items/.test(value)) return 'inventory';
  if (/إنتاج|انتاج|تشغيلات|أوامر الإنتاج|امر انتاج|production|manufacturing/.test(value)) return 'production';
  if (/مبيعات|فواتير بيع|عملاء|sales|invoices/.test(value)) return 'sales';
  if (/مشتريات|أوامر شراء|موردين|purchase|suppliers/.test(value)) return 'purchases';
  return null;
}

const permissionByIntent = {
  inventory: 'INVENTORY.READ',
  production: 'PRODUCTION.READ',
  sales: 'SALES.READ',
  purchases: 'PURCHASES.READ'
};

async function readErpContext(db, request, intent) {
  if (!intent) return null;
  const permission = permissionByIntent[intent];
  const allowed = await db.query(
    `SELECT EXISTS (
       SELECT 1 FROM user_roles ur
       JOIN role_permissions rp ON rp.role_id=ur.role_id
       JOIN permissions p ON p.id=rp.permission_id
       JOIN roles r ON r.id=ur.role_id
       WHERE ur.user_id=$1 AND p.code=$2 AND p.is_active=TRUE AND r.is_active=TRUE
     ) AS allowed`,
    [request.authUser.user_id, permission]
  );
  if (!allowed.rows[0]?.allowed) {
    return { denied: true, message: 'المستخدم لا يملك صلاحية قراءة بيانات هذا القسم.' };
  }

  // Fixed read-only SQL only; user text is never interpolated into a query.
  const statements = {
    inventory: `SELECT i.code item_code,i.name_ar item_name,w.code warehouse_code,
       SUM(b.quantity)::numeric quantity,
       CASE WHEN SUM(b.quantity)>0
         THEN SUM(b.quantity*b.average_unit_cost)/SUM(b.quantity) ELSE 0 END::numeric average_unit_cost,
       COUNT(DISTINCT b.lot_no)::int lot_count
       FROM inventory_balances b JOIN items i ON i.id=b.item_id
       JOIN warehouses w ON w.id=b.warehouse_id
       WHERE b.quantity<>0
       GROUP BY i.code,i.name_ar,w.code ORDER BY i.code,w.code LIMIT ${MAX_CONTEXT_ROWS}`,
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
       GROUP BY p.id,s.code,s.name_ar ORDER BY p.order_date DESC,p.order_no DESC LIMIT ${MAX_CONTEXT_ROWS}`
  };

  await db.query(
    `INSERT INTO audit_logs(actor_user_id,action,entity_type,entity_id,details)
     VALUES($1,'AI_READ_ONLY_DATA_ACCESS',$2,NULL,$3::jsonb)`,
    [request.authUser.user_id, intent.toUpperCase(), JSON.stringify({ permission, rowLimit: MAX_CONTEXT_ROWS })]
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
