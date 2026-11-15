-- 051: provide warehouse and finance teams the least-privilege return workflow roles.
INSERT INTO role_permissions(role_id,permission_id)
SELECT r.id,p.id FROM roles r CROSS JOIN permissions p
WHERE (r.code='STOCK_KEEPER' AND p.code IN ('returns.inspect','returns.view'))
   OR (r.code='ACCOUNTANT' AND p.code IN ('returns.approve','returns.view'))
   OR (r.code='BRANCH_MANAGER' AND p.code IN ('returns.inspect','returns.approve','returns.view'))
   OR (r.code='SUPER_ADMIN' AND p.code IN ('returns.inspect','returns.approve','returns.view'))
ON CONFLICT DO NOTHING;
