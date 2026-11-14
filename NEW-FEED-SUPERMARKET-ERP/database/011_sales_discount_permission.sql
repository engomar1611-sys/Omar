-- 011: explicit authorization for invoice-level/line-level sales discounts.
INSERT INTO permissions(code,description)
VALUES ('sales.discount','السماح بتطبيق خصم على فاتورة البيع')
ON CONFLICT(code) DO NOTHING;
INSERT INTO role_permissions(role_id,permission_id)
SELECT r.id,p.id FROM roles r CROSS JOIN permissions p
WHERE r.code='SUPER_ADMIN' AND p.code='sales.discount'
ON CONFLICT DO NOTHING;
