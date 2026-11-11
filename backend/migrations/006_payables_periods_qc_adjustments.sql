ALTER TABLE inventory_balances
 ADD COLUMN IF NOT EXISTS quality_status VARCHAR(16) NOT NULL DEFAULT 'RELEASED'
 CHECK(quality_status IN ('PENDING_QC','RELEASED','QUARANTINED'));
-- Payables, supplier returns, period controls, finished-goods QC, production loss and inventory adjustments.
CREATE TABLE IF NOT EXISTS accounting_periods (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(), period_code VARCHAR(20) NOT NULL UNIQUE,
 start_date DATE NOT NULL, end_date DATE NOT NULL, status VARCHAR(12) NOT NULL DEFAULT 'OPEN' CHECK(status IN ('OPEN','CLOSED','LOCKED')),
 closed_by UUID REFERENCES users(id) ON DELETE RESTRICT, closed_at TIMESTAMPTZ,
 CHECK(end_date>=start_date), CHECK((status='OPEN') OR (closed_by IS NOT NULL AND closed_at IS NOT NULL))
);
CREATE TABLE IF NOT EXISTS supplier_payments (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(), payment_no VARCHAR(40) NOT NULL UNIQUE,
 supplier_id UUID NOT NULL REFERENCES suppliers(id) ON DELETE RESTRICT,
 payment_date DATE NOT NULL DEFAULT CURRENT_DATE, amount NUMERIC(18,6) NOT NULL CHECK(amount>0),
 payment_method VARCHAR(20) NOT NULL CHECK(payment_method IN ('CASH','BANK','TRANSFER','CHEQUE')),
 reference_no VARCHAR(100), status VARCHAR(16) NOT NULL DEFAULT 'POSTED' CHECK(status IN ('POSTED','REVERSED')),
 created_by UUID REFERENCES users(id) ON DELETE RESTRICT, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS supplier_payment_allocations (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(), supplier_payment_id UUID NOT NULL REFERENCES supplier_payments(id) ON DELETE RESTRICT,
 purchase_order_id UUID NOT NULL REFERENCES purchase_orders(id) ON DELETE RESTRICT,
 amount NUMERIC(18,6) NOT NULL CHECK(amount>0), UNIQUE(supplier_payment_id,purchase_order_id)
);
CREATE TABLE IF NOT EXISTS purchase_returns (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(), return_no VARCHAR(40) NOT NULL UNIQUE,
 supplier_id UUID NOT NULL REFERENCES suppliers(id) ON DELETE RESTRICT,
 warehouse_id UUID NOT NULL REFERENCES warehouses(id) ON DELETE RESTRICT,
 status VARCHAR(16) NOT NULL DEFAULT 'DRAFT' CHECK(status IN ('DRAFT','POSTED','CANCELLED')),
 reason TEXT, created_by UUID REFERENCES users(id) ON DELETE RESTRICT,
 posted_at TIMESTAMPTZ, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS purchase_return_lines (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(), purchase_return_id UUID NOT NULL REFERENCES purchase_returns(id) ON DELETE RESTRICT,
 item_id UUID NOT NULL REFERENCES items(id) ON DELETE RESTRICT, lot_no VARCHAR(80) NOT NULL DEFAULT '',
 quantity NUMERIC(18,6) NOT NULL CHECK(quantity>0), unit_cost NUMERIC(18,6) NOT NULL CHECK(unit_cost>=0)
);
CREATE TABLE IF NOT EXISTS finished_goods_inspections (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(), production_order_id UUID NOT NULL UNIQUE REFERENCES production_orders(id) ON DELETE RESTRICT,
 inspected_by UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT, inspected_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 result VARCHAR(12) NOT NULL CHECK(result IN ('PASS','FAIL','CONDITIONAL')),
 parameters JSONB NOT NULL DEFAULT '{}'::jsonb, notes TEXT
);
CREATE TABLE IF NOT EXISTS production_losses (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(), production_order_id UUID NOT NULL REFERENCES production_orders(id) ON DELETE RESTRICT,
 loss_type VARCHAR(20) NOT NULL CHECK(loss_type IN ('PROCESS','MOISTURE','DAMAGE','OTHER')),
 quantity NUMERIC(18,6) NOT NULL CHECK(quantity>0), reason TEXT NOT NULL,
 approved_by UUID REFERENCES users(id) ON DELETE RESTRICT, approved_at TIMESTAMPTZ,
 created_by UUID REFERENCES users(id) ON DELETE RESTRICT, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS inventory_adjustments (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(), adjustment_no VARCHAR(40) NOT NULL UNIQUE,
 warehouse_id UUID NOT NULL REFERENCES warehouses(id) ON DELETE RESTRICT,
 status VARCHAR(16) NOT NULL DEFAULT 'DRAFT' CHECK(status IN ('DRAFT','POSTED','CANCELLED')),
 reason TEXT NOT NULL, created_by UUID REFERENCES users(id) ON DELETE RESTRICT,
 approved_by UUID REFERENCES users(id) ON DELETE RESTRICT, approved_at TIMESTAMPTZ,
 created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS inventory_adjustment_lines (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(), adjustment_id UUID NOT NULL REFERENCES inventory_adjustments(id) ON DELETE RESTRICT,
 item_id UUID NOT NULL REFERENCES items(id) ON DELETE RESTRICT, lot_no VARCHAR(80) NOT NULL DEFAULT '',
 quantity_delta NUMERIC(18,6) NOT NULL CHECK(quantity_delta<>0), unit_cost NUMERIC(18,6) NOT NULL CHECK(unit_cost>=0)
);
INSERT INTO permissions(code,name_ar,module_code) VALUES
 ('SUPPLIER_PAYMENTS.MANAGE','إدارة سداد الموردين','ACCOUNTING'),
 ('PURCHASE_RETURNS.MANAGE','إدارة مرتجعات المشتريات','PURCHASES'),
 ('ACCOUNTING.PERIODS.MANAGE','إدارة الفترات المحاسبية','ACCOUNTING'),
 ('QUALITY.FINISHED_APPROVE','اعتماد جودة المنتج النهائي','QUALITY'),
 ('PRODUCTION.LOSSES.MANAGE','إدارة هالك الإنتاج','PRODUCTION'),
 ('INVENTORY.ADJUST','اعتماد تسويات المخزون','INVENTORY')
ON CONFLICT(code) DO NOTHING;
