-- 053: ensure the super administrator receives every permission added by later modules.
INSERT INTO role_permissions(role_id,permission_id)
SELECT r.id,p.id FROM roles r CROSS JOIN permissions p
WHERE r.code='SUPER_ADMIN'
ON CONFLICT DO NOTHING;
