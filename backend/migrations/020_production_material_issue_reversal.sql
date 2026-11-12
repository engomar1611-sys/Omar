ALTER TABLE production_material_issues DROP CONSTRAINT IF EXISTS production_material_issues_status_check;
ALTER TABLE production_material_issues ADD CONSTRAINT production_material_issues_status_check CHECK(status IN ('POSTED','REVERSED'));
ALTER TABLE production_material_issues ADD COLUMN IF NOT EXISTS reversed_by UUID REFERENCES users(id) ON DELETE RESTRICT;
ALTER TABLE production_material_issues ADD COLUMN IF NOT EXISTS reversed_at TIMESTAMPTZ;
ALTER TABLE production_material_issues ADD COLUMN IF NOT EXISTS reversal_reason TEXT;
ALTER TABLE production_material_issues ADD CONSTRAINT production_material_issues_reversal_state_check
 CHECK((status='POSTED' AND reversed_by IS NULL AND reversed_at IS NULL AND reversal_reason IS NULL) OR
       (status='REVERSED' AND reversed_by IS NOT NULL AND reversed_at IS NOT NULL AND LENGTH(TRIM(reversal_reason))>0));
INSERT INTO permissions(code,name_ar,module_code,description) VALUES('PRODUCTION.MATERIALS.REVERSE','عكس أذون صرف خامات الإنتاج','PRODUCTION','عكس إذن الصرف قبل إتمام أمر الإنتاج مع التحقق من عدم وجود حركات لاحقة')
ON CONFLICT(code) DO UPDATE SET name_ar=EXCLUDED.name_ar,module_code=EXCLUDED.module_code,description=EXCLUDED.description;
INSERT INTO role_permissions(role_id,permission_id) SELECT r.id,p.id FROM roles r JOIN permissions p ON p.code='PRODUCTION.MATERIALS.REVERSE' WHERE r.code='SYSTEM_ADMIN' ON CONFLICT(role_id,permission_id) DO NOTHING;
