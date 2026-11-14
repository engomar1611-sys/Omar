-- Permission for the read-only OpenAI assistant endpoint.
INSERT INTO permissions(code, name_ar, module_code, description)
VALUES (
  'AI.ASSISTANT.USE',
  'استخدام المساعد الذكي',
  'AI',
  'إرسال الأسئلة إلى مساعد NEW FEED الذكي؛ لا يمنح صلاحية تعديل بيانات ERP'
)
ON CONFLICT (code) DO NOTHING;

-- Make the assistant available to the system administrator role by default.
INSERT INTO role_permissions(role_id, permission_id)
SELECT r.id, p.id
  FROM roles r
  JOIN permissions p ON p.code = 'AI.ASSISTANT.USE'
 WHERE r.code = 'SYSTEM_ADMIN'
ON CONFLICT (role_id, permission_id) DO NOTHING;
