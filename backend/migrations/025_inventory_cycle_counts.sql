-- Cycle count snapshots and approval controls.
CREATE TABLE IF NOT EXISTS inventory_counts (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
 count_no VARCHAR(40) NOT NULL UNIQUE,
 warehouse_id UUID NOT NULL REFERENCES warehouses(id) ON DELETE RESTRICT,
 status VARCHAR(16) NOT NULL DEFAULT 'DRAFT' CHECK(status IN ('DRAFT','COUNTED','POSTED','CANCELLED')),
 count_date DATE NOT NULL DEFAULT CURRENT_DATE,
 reason TEXT NOT NULL DEFAULT '',
 created_by UUID REFERENCES users(id) ON DELETE RESTRICT,
 submitted_by UUID REFERENCES users(id) ON DELETE RESTRICT,
 submitted_at TIMESTAMPTZ,
 approved_by UUID REFERENCES users(id) ON DELETE RESTRICT,
 approved_at TIMESTAMPTZ,
 created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 CHECK((status IN ('COUNTED','POSTED') AND submitted_by IS NOT NULL AND submitted_at IS NOT NULL) OR status IN ('DRAFT','CANCELLED')),
 CHECK((status='POSTED' AND approved_by IS NOT NULL AND approved_at IS NOT NULL) OR status<>'POSTED')
);
CREATE TABLE IF NOT EXISTS inventory_count_lines (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
 count_id UUID NOT NULL REFERENCES inventory_counts(id) ON DELETE RESTRICT,
 item_id UUID NOT NULL REFERENCES items(id) ON DELETE RESTRICT,
 lot_no VARCHAR(80) NOT NULL DEFAULT '',
 expected_qty NUMERIC(18,6) NOT NULL CHECK(expected_qty>=0),
 counted_qty NUMERIC(18,6) CHECK(counted_qty>=0),
 unit_cost NUMERIC(18,6) NOT NULL CHECK(unit_cost>=0),
 UNIQUE(count_id,item_id,lot_no)
);
CREATE INDEX IF NOT EXISTS idx_inventory_counts_created ON inventory_counts(created_at DESC);
INSERT INTO permissions(code,name_ar,module_code,description) VALUES
 ('INVENTORY.COUNT','إنشاء وإدارة جرد المخزون','INVENTORY','إنشاء جرد دوري أو مفاجئ وتسجيل الكميات الفعلية'),
 ('INVENTORY.COUNT.APPROVE','اعتماد وترحيل نتائج الجرد','INVENTORY','اعتماد فروق الجرد وترحيل الأثر المخزني والمحاسبي')
ON CONFLICT(code) DO UPDATE SET name_ar=EXCLUDED.name_ar,module_code=EXCLUDED.module_code,description=EXCLUDED.description;
INSERT INTO role_permissions(role_id,permission_id)
SELECT r.id,p.id FROM roles r CROSS JOIN permissions p
WHERE r.code='SYSTEM_ADMIN' AND p.code IN ('INVENTORY.COUNT','INVENTORY.COUNT.APPROVE')
ON CONFLICT(role_id,permission_id) DO NOTHING;
