-- 031: define HR manager role and cashier cash-session access.
INSERT INTO roles(code,name) VALUES ('HR_MANAGER','مدير الموارد البشرية')
ON CONFLICT(code) DO NOTHING;
INSERT INTO role_permissions(role_id,permission_id)
SELECT r.id,p.id FROM roles r CROSS JOIN permissions p
WHERE r.code='HR_MANAGER' AND p.code IN ('hr.manage','hr.attendance','hr.payroll')
ON CONFLICT DO NOTHING;
INSERT INTO role_permissions(role_id,permission_id)
SELECT r.id,p.id FROM roles r CROSS JOIN permissions p
WHERE r.code='CASHIER' AND p.code IN ('cash.manage','loyalty.manage')
ON CONFLICT DO NOTHING;
