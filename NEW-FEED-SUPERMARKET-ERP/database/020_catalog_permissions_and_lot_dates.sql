-- 020: granular catalogue/report permissions and lot provenance.
ALTER TABLE stock_lots ADD COLUMN IF NOT EXISTS production_date DATE;
ALTER TABLE stock_lots ADD COLUMN IF NOT EXISTS purchase_date DATE;
ALTER TABLE stock_lots ADD COLUMN IF NOT EXISTS supplier_id UUID REFERENCES suppliers(id);
CREATE INDEX IF NOT EXISTS ix_stock_lots_supplier_purchase ON stock_lots(supplier_id,purchase_date);

INSERT INTO permissions(code,description) VALUES
 ('catalog.view','عرض كتالوج الأصناف'),
 ('catalog.create','إضافة صنف جديد'),
 ('catalog.edit','تعديل بيانات الصنف'),
 ('catalog.import','استيراد أصناف من ملفات Excel/CSV'),
 ('catalog.import.approve','اعتماد دفعات استيراد الأصناف'),
 ('catalog.export','تصدير كتالوج الأصناف'),
 ('delivery.report','عرض تقرير مبيعات الدليفري'),
 ('reports.export','تصدير التقارير إلى Excel/CSV')
ON CONFLICT(code) DO NOTHING;

-- Keep existing broad permissions intact while adding granular defaults.
INSERT INTO role_permissions(role_id,permission_id)
SELECT r.id,p.id FROM roles r CROSS JOIN permissions p
WHERE r.code='SUPER_ADMIN'
  AND p.code IN ('catalog.view','catalog.create','catalog.edit','catalog.import','catalog.import.approve','catalog.export','delivery.report','reports.export')
ON CONFLICT DO NOTHING;

INSERT INTO role_permissions(role_id,permission_id)
SELECT r.id,p.id FROM roles r CROSS JOIN permissions p
WHERE r.code IN ('BRANCH_MANAGER','PURCHASING')
  AND p.code IN ('catalog.view','catalog.create','catalog.edit','catalog.import','catalog.import.approve','catalog.export')
ON CONFLICT DO NOTHING;

INSERT INTO role_permissions(role_id,permission_id)
SELECT r.id,p.id FROM roles r CROSS JOIN permissions p
WHERE r.code IN ('BRANCH_MANAGER','ACCOUNTANT')
  AND p.code IN ('delivery.report','reports.export')
ON CONFLICT DO NOTHING;

INSERT INTO role_permissions(role_id,permission_id)
SELECT r.id,p.id FROM roles r CROSS JOIN permissions p
WHERE r.code IN ('STOCK_KEEPER')
  AND p.code IN ('catalog.view','catalog.export')
ON CONFLICT DO NOTHING;
