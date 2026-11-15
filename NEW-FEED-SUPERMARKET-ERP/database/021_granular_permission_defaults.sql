-- 021: ensure POS and operational users retain read access under granular catalogue permissions.
INSERT INTO role_permissions(role_id,permission_id)
SELECT r.id,p.id FROM roles r CROSS JOIN permissions p
WHERE r.code IN ('SUPER_ADMIN','BRANCH_MANAGER','PURCHASING','STOCK_KEEPER','CASHIER','ACCOUNTANT')
  AND p.code='catalog.view'
ON CONFLICT DO NOTHING;

INSERT INTO role_permissions(role_id,permission_id)
SELECT r.id,p.id FROM roles r CROSS JOIN permissions p
WHERE r.code IN ('SUPER_ADMIN','BRANCH_MANAGER','ACCOUNTANT')
  AND p.code IN ('delivery.report','reports.export')
ON CONFLICT DO NOTHING;
