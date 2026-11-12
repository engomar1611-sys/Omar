ALTER TABLE purchase_returns DROP CONSTRAINT IF EXISTS purchase_returns_status_check;
ALTER TABLE purchase_returns ADD CONSTRAINT purchase_returns_status_check
 CHECK(status IN ('DRAFT','PENDING_WAREHOUSE','PENDING_ACCOUNTING','POSTED','CANCELLED','REJECTED'));
ALTER TABLE purchase_returns
 ADD COLUMN IF NOT EXISTS warehouse_approved_by UUID REFERENCES users(id) ON DELETE RESTRICT,
 ADD COLUMN IF NOT EXISTS warehouse_approved_at TIMESTAMPTZ,
 ADD COLUMN IF NOT EXISTS accounting_approved_by UUID REFERENCES users(id) ON DELETE RESTRICT,
 ADD COLUMN IF NOT EXISTS accounting_approved_at TIMESTAMPTZ;
INSERT INTO permissions(code,name_ar,module_code) VALUES
 ('PURCHASE_RETURNS.WAREHOUSE_APPROVE','اعتماد مرتجع المشتريات مخزنياً','INVENTORY'),
 ('PURCHASE_RETURNS.ACCOUNTING_APPROVE','اعتماد مرتجع المشتريات محاسبياً','ACCOUNTING')
ON CONFLICT(code) DO NOTHING;
