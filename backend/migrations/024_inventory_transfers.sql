-- Controlled inter-warehouse transfers; stock remains in the same lot and valuation basis.
CREATE TABLE IF NOT EXISTS inventory_transfers (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
 transfer_no VARCHAR(40) NOT NULL UNIQUE,
 source_warehouse_id UUID NOT NULL REFERENCES warehouses(id) ON DELETE RESTRICT,
 destination_warehouse_id UUID NOT NULL REFERENCES warehouses(id) ON DELETE RESTRICT,
 status VARCHAR(16) NOT NULL DEFAULT 'DRAFT' CHECK(status IN ('DRAFT','POSTED','CANCELLED')),
 reason TEXT NOT NULL DEFAULT '',
 created_by UUID REFERENCES users(id) ON DELETE RESTRICT,
 approved_by UUID REFERENCES users(id) ON DELETE RESTRICT,
 approved_at TIMESTAMPTZ,
 created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 CHECK(source_warehouse_id <> destination_warehouse_id),
 CHECK((status='POSTED' AND approved_by IS NOT NULL AND approved_at IS NOT NULL) OR status<>'POSTED')
);
CREATE TABLE IF NOT EXISTS inventory_transfer_lines (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
 transfer_id UUID NOT NULL REFERENCES inventory_transfers(id) ON DELETE RESTRICT,
 item_id UUID NOT NULL REFERENCES items(id) ON DELETE RESTRICT,
 lot_no VARCHAR(80) NOT NULL DEFAULT '',
 quantity NUMERIC(18,6) NOT NULL CHECK(quantity>0),
 UNIQUE(transfer_id,item_id,lot_no)
);
CREATE INDEX IF NOT EXISTS idx_inventory_transfers_created ON inventory_transfers(created_at DESC);
ALTER TABLE stock_movements DROP CONSTRAINT IF EXISTS stock_movements_movement_type_check;
ALTER TABLE stock_movements ADD CONSTRAINT stock_movements_movement_type_check
 CHECK(movement_type IN ('PURCHASE_RECEIPT','PRODUCTION_ISSUE','PRODUCTION_OUTPUT','ADJUSTMENT_IN','ADJUSTMENT_OUT','PRODUCTION_LOSS','TRANSFER_IN','TRANSFER_OUT'));
INSERT INTO permissions(code,name_ar,module_code,description) VALUES
 ('INVENTORY.TRANSFER','إنشاء تحويلات المخزون بين المخازن','INVENTORY','إنشاء مسودة تحويل مخزون'),
 ('INVENTORY.TRANSFER.APPROVE','اعتماد وترحيل تحويلات المخزون','INVENTORY','ترحيل التحويل بين المخازن مع الحفاظ على التشغيلة ومتوسط التكلفة')
ON CONFLICT(code) DO UPDATE SET name_ar=EXCLUDED.name_ar,module_code=EXCLUDED.module_code,description=EXCLUDED.description;
INSERT INTO role_permissions(role_id,permission_id)
SELECT r.id,p.id FROM roles r CROSS JOIN permissions p
WHERE r.code='SYSTEM_ADMIN' AND p.code IN ('INVENTORY.TRANSFER','INVENTORY.TRANSFER.APPROVE')
ON CONFLICT(role_id,permission_id) DO NOTHING;
