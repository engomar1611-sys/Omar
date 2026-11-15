-- 050: allow warehouse and finance roles to access return workflow without full sales access.
INSERT INTO permissions(code,description)
VALUES ('returns.view','عرض ومتابعة طلبات المرتجعات')
ON CONFLICT(code) DO NOTHING;

INSERT INTO role_permissions(role_id,permission_id)
SELECT DISTINCT ur.role_id,p.id
FROM user_roles ur
JOIN role_permissions existing ON existing.role_id=ur.role_id
JOIN permissions capability ON capability.id=existing.permission_id
JOIN permissions p ON p.code='returns.view'
WHERE capability.code IN ('returns.inspect','returns.approve','sales.manage')
ON CONFLICT DO NOTHING;

INSERT INTO role_permissions(role_id,permission_id)
SELECT r.id,p.id FROM roles r CROSS JOIN permissions p
WHERE r.code='SUPER_ADMIN' AND p.code='returns.view'
ON CONFLICT DO NOTHING;
