-- 054: seed report export and specialist report permissions used by API routes.
INSERT INTO permissions(code,description) VALUES
 ('reports.export','تصدير التقارير'),
 ('bank.report','عرض تقارير البنوك'),
 ('delivery.report','عرض تقارير التوصيل')
ON CONFLICT(code) DO NOTHING;

INSERT INTO role_permissions(role_id,permission_id)
SELECT r.id,p.id FROM roles r CROSS JOIN permissions p
WHERE (r.code='ACCOUNTANT' AND p.code IN ('reports.export','bank.report'))
   OR (r.code='BRANCH_MANAGER' AND p.code IN ('reports.export','bank.report','delivery.report'))
   OR (r.code='SUPER_ADMIN' AND p.code IN ('reports.export','bank.report','delivery.report'))
ON CONFLICT DO NOTHING;
