-- 017: restrict discount policy administration to authorized administrators.
INSERT INTO permissions(code,description) VALUES ('sales.discount.manage','إدارة قواعد خصومات الطلبات والتوصيل') ON CONFLICT(code) DO NOTHING;
INSERT INTO role_permissions(role_id,permission_id) SELECT r.id,p.id FROM roles r CROSS JOIN permissions p WHERE r.code='SUPER_ADMIN' AND p.code='sales.discount.manage' ON CONFLICT DO NOTHING;
