CREATE TABLE IF NOT EXISTS production_process_losses (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
 production_order_id UUID NOT NULL REFERENCES production_orders(id) ON DELETE RESTRICT,
 item_id UUID NOT NULL REFERENCES items(id) ON DELETE RESTRICT,
 lot_no VARCHAR(80) NOT NULL,
 quantity NUMERIC(18,6) NOT NULL CHECK(quantity>0),
 reason TEXT NOT NULL CHECK(length(trim(reason))>0),
 status VARCHAR(20) NOT NULL DEFAULT 'PENDING_APPROVAL' CHECK(status IN ('PENDING_APPROVAL','APPROVED')),
 created_by UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
 created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 approved_by UUID REFERENCES users(id) ON DELETE RESTRICT,
 approved_at TIMESTAMPTZ,
 CHECK((status='PENDING_APPROVAL' AND approved_by IS NULL AND approved_at IS NULL) OR (status='APPROVED' AND approved_by IS NOT NULL AND approved_at IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS idx_production_process_losses_order ON production_process_losses(production_order_id,item_id,lot_no);
INSERT INTO permissions(code,name_ar,module_code,description) VALUES
 ('PRODUCTION.PROCESS_LOSSES.MANAGE','تسجيل هالك خامات التشغيل','PRODUCTION','تسجيل هالك خامة مصروفة أثناء أمر تشغيل مفتوح'),
 ('PRODUCTION.PROCESS_LOSSES.APPROVE','اعتماد هالك خامات التشغيل','PRODUCTION','اعتماد تصنيف الهالك أثناء التشغيل دون خصم مخزني إضافي')
ON CONFLICT(code) DO UPDATE SET name_ar=EXCLUDED.name_ar,module_code=EXCLUDED.module_code,description=EXCLUDED.description;
INSERT INTO role_permissions(role_id,permission_id) SELECT r.id,p.id FROM roles r JOIN permissions p ON p.code IN ('PRODUCTION.PROCESS_LOSSES.MANAGE','PRODUCTION.PROCESS_LOSSES.APPROVE') WHERE r.code='SYSTEM_ADMIN' ON CONFLICT(role_id,permission_id) DO NOTHING;
