const MAX_MESSAGE_LENGTH = 4000;

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

export async function aiAssistantRoutes(app) {
  app.get('/api/v1/ai/status', { ...auth(app) }, async () => ({
    enabled: Boolean(process.env.OPENAI_API_KEY),
    provider: 'OpenAI',
    mode: 'read-only-chat',
    configuredModel: process.env.OPENAI_MODEL || 'gpt-6-astra'
  }));

  app.post('/api/v1/ai/chat', {
    ...auth(app),
    schema: {
      body: {
        type: 'object',
        additionalProperties: false,
        required: ['message'],
        properties: {
          message: { type: 'string', minLength: 1, maxLength: MAX_MESSAGE_LENGTH }
        }
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

    let upstream;
    try {
      upstream = await fetch('https://api.openai.com/v1/responses', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          model: process.env.OPENAI_MODEL || 'gpt-6-astra',
          instructions: [
            'أنت مساعد NEW FEED ERP لمصنع أعلاف في مصر.',
            'أجب باللغة العربية الواضحة وباختصار عملي.',
            'لا تدّعِ أنك اطلعت على بيانات النظام أو قاعدة بياناته؛ لا توجد لك حالياً أدوات قراءة بيانات ERP.',
            'لا تنفذ ولا تقترح اعتماد حركات مالية أو مخزنية نيابة عن المستخدم.',
            'إذا كان السؤال يتطلب أرقاماً أو بيانات تشغيلية غير مرفقة، اطلب تقريراً أو بيانات محددة بدلاً من التخمين.'
          ].join(' '),
          input: message,
          max_output_tokens: 700,
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

    return { answer, model: process.env.OPENAI_MODEL || 'gpt-6-astra' };
  });
}
