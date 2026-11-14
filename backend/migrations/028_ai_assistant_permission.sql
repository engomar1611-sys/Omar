-- Permission for the read-only OpenAI assistant endpoint.
INSERT INTO permissions(code, name_ar, module_code, description)
VALUES (
  'AI.ASSISTANT.USE',
  'استخدام المساعد الذكي',
  'AI',
  'إرسال الأسئلة إلى مساعد NEW FEED الذكي؛ لا يمنح صلاحية تعديل بيانات ERP'
)
ON CONFLICT (code) DO NOTHING;
