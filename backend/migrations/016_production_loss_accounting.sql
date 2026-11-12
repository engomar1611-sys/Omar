ALTER TABLE production_losses
 ADD COLUMN IF NOT EXISTS journal_entry_id UUID REFERENCES journal_entries(id) ON DELETE RESTRICT;
INSERT INTO gl_accounts(code,name_ar,account_type) VALUES
 ('5420','خسائر هالك الإنتاج','EXPENSE')
ON CONFLICT(code) DO NOTHING;
INSERT INTO permissions(code,name_ar,module_code,description) VALUES
 ('PRODUCTION.LOSSES.MANAGE','تسجيل هالك الإنتاج','PRODUCTION','إنشاء طلب هالك إنتاج بانتظار الاعتماد'),
 ('PRODUCTION.LOSSES.APPROVE','اعتماد وترحيل هالك الإنتاج','PRODUCTION','اعتماد خصم الهالك من مخزون المنتج النهائي وترحيل قيد الخسائر')
ON CONFLICT(code) DO UPDATE SET name_ar=EXCLUDED.name_ar,module_code=EXCLUDED.module_code,description=EXCLUDED.description;
INSERT INTO role_permissions(role_id,permission_id)
SELECT r.id,p.id FROM roles r JOIN permissions p ON p.code IN ('PRODUCTION.LOSSES.MANAGE','PRODUCTION.LOSSES.APPROVE')
WHERE r.code='SYSTEM_ADMIN'
ON CONFLICT(role_id,permission_id) DO NOTHING;
