-- Purchasing, receiving, quality, inventory ledger, and production costing.
CREATE TABLE IF NOT EXISTS suppliers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code VARCHAR(40) NOT NULL UNIQUE,
  name_ar VARCHAR(200) NOT NULL,
  tax_number VARCHAR(40),
  phone VARCHAR(40),
  address TEXT,
  payment_terms_days INTEGER NOT NULL DEFAULT 0 CHECK (payment_terms_days >= 0),
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_suppliers_code_lower ON suppliers(LOWER(code));

CREATE TABLE IF NOT EXISTS purchase_orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_no VARCHAR(40) NOT NULL UNIQUE,
  supplier_id UUID NOT NULL REFERENCES suppliers(id) ON DELETE RESTRICT,
  warehouse_id UUID NOT NULL REFERENCES warehouses(id) ON DELETE RESTRICT,
  order_date DATE NOT NULL DEFAULT CURRENT_DATE,
  expected_date DATE,
  status VARCHAR(24) NOT NULL DEFAULT 'DRAFT'
    CHECK (status IN ('DRAFT','APPROVED','PARTIALLY_RECEIVED','RECEIVED','CANCELLED')),
  notes TEXT,
  created_by UUID REFERENCES users(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (expected_date IS NULL OR expected_date >= order_date)
);
CREATE TABLE IF NOT EXISTS purchase_order_lines (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  purchase_order_id UUID NOT NULL REFERENCES purchase_orders(id) ON DELETE RESTRICT,
  line_no INTEGER NOT NULL CHECK (line_no > 0),
  item_id UUID NOT NULL REFERENCES items(id) ON DELETE RESTRICT,
  ordered_qty NUMERIC(18,6) NOT NULL CHECK (ordered_qty > 0),
  unit_cost NUMERIC(18,6) NOT NULL CHECK (unit_cost >= 0),
  received_qty NUMERIC(18,6) NOT NULL DEFAULT 0 CHECK (received_qty >= 0 AND received_qty <= ordered_qty),
  UNIQUE(purchase_order_id,line_no)
);
CREATE TABLE IF NOT EXISTS goods_receipts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  receipt_no VARCHAR(40) NOT NULL UNIQUE,
  purchase_order_id UUID NOT NULL REFERENCES purchase_orders(id) ON DELETE RESTRICT,
  received_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  status VARCHAR(24) NOT NULL DEFAULT 'PENDING_QC'
    CHECK (status IN ('PENDING_QC','ACCEPTED','PARTIAL','REJECTED')),
  received_by UUID REFERENCES users(id) ON DELETE RESTRICT,
  quality_approved_by UUID REFERENCES users(id) ON DELETE RESTRICT,
  quality_approved_at TIMESTAMPTZ,
  notes TEXT,
  CHECK ((status = 'PENDING_QC' AND quality_approved_at IS NULL) OR status <> 'PENDING_QC')
);
CREATE TABLE IF NOT EXISTS goods_receipt_lines (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  goods_receipt_id UUID NOT NULL REFERENCES goods_receipts(id) ON DELETE RESTRICT,
  purchase_order_line_id UUID NOT NULL REFERENCES purchase_order_lines(id) ON DELETE RESTRICT,
  item_id UUID NOT NULL REFERENCES items(id) ON DELETE RESTRICT,
  lot_no VARCHAR(80),
  expiry_date DATE,
  received_qty NUMERIC(18,6) NOT NULL CHECK (received_qty > 0),
  accepted_qty NUMERIC(18,6) NOT NULL DEFAULT 0 CHECK (accepted_qty >= 0),
  rejected_qty NUMERIC(18,6) NOT NULL DEFAULT 0 CHECK (rejected_qty >= 0),
  unit_cost NUMERIC(18,6) NOT NULL CHECK (unit_cost >= 0),
  CHECK (accepted_qty + rejected_qty <= received_qty)
);
CREATE TABLE IF NOT EXISTS quality_inspections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  goods_receipt_line_id UUID NOT NULL UNIQUE REFERENCES goods_receipt_lines(id) ON DELETE RESTRICT,
  inspected_by UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  inspected_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  result VARCHAR(16) NOT NULL CHECK (result IN ('PASS','PARTIAL','FAIL')),
  accepted_qty NUMERIC(18,6) NOT NULL CHECK (accepted_qty >= 0),
  rejected_qty NUMERIC(18,6) NOT NULL CHECK (rejected_qty >= 0),
  parameters JSONB NOT NULL DEFAULT '{}'::jsonb,
  notes TEXT,
  CHECK (accepted_qty + rejected_qty > 0)
);

CREATE TABLE IF NOT EXISTS inventory_balances (
  warehouse_id UUID NOT NULL REFERENCES warehouses(id) ON DELETE RESTRICT,
  item_id UUID NOT NULL REFERENCES items(id) ON DELETE RESTRICT,
  lot_no VARCHAR(80) NOT NULL DEFAULT '',
  expiry_date DATE,
  quantity NUMERIC(18,6) NOT NULL DEFAULT 0 CHECK (quantity >= 0),
  average_unit_cost NUMERIC(18,6) NOT NULL DEFAULT 0 CHECK (average_unit_cost >= 0),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (warehouse_id,item_id,lot_no)
);
CREATE TABLE IF NOT EXISTS stock_movements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  movement_no VARCHAR(50) NOT NULL UNIQUE,
  warehouse_id UUID NOT NULL REFERENCES warehouses(id) ON DELETE RESTRICT,
  item_id UUID NOT NULL REFERENCES items(id) ON DELETE RESTRICT,
  lot_no VARCHAR(80) NOT NULL DEFAULT '',
  movement_type VARCHAR(24) NOT NULL CHECK (movement_type IN ('PURCHASE_RECEIPT','PRODUCTION_ISSUE','PRODUCTION_OUTPUT','ADJUSTMENT_IN','ADJUSTMENT_OUT')),
  quantity_in NUMERIC(18,6) NOT NULL DEFAULT 0 CHECK (quantity_in >= 0),
  quantity_out NUMERIC(18,6) NOT NULL DEFAULT 0 CHECK (quantity_out >= 0),
  unit_cost NUMERIC(18,6) NOT NULL CHECK (unit_cost >= 0),
  reference_type VARCHAR(40) NOT NULL,
  reference_id UUID NOT NULL,
  created_by UUID REFERENCES users(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK ((quantity_in > 0 AND quantity_out = 0) OR (quantity_out > 0 AND quantity_in = 0))
);
CREATE INDEX IF NOT EXISTS idx_stock_movements_item_date ON stock_movements(item_id,created_at DESC);

CREATE TABLE IF NOT EXISTS production_orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_no VARCHAR(40) NOT NULL UNIQUE,
  feed_product_id UUID NOT NULL REFERENCES feed_products(id) ON DELETE RESTRICT,
  formulation_id UUID NOT NULL REFERENCES formulations(id) ON DELETE RESTRICT,
  warehouse_id UUID NOT NULL REFERENCES warehouses(id) ON DELETE RESTRICT,
  planned_qty NUMERIC(18,6) NOT NULL CHECK (planned_qty > 0),
  actual_qty NUMERIC(18,6),
  status VARCHAR(20) NOT NULL DEFAULT 'DRAFT'
    CHECK (status IN ('DRAFT','RELEASED','COMPLETED','CANCELLED')),
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  total_material_cost NUMERIC(18,6),
  unit_production_cost NUMERIC(18,6),
  created_by UUID REFERENCES users(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK ((status <> 'COMPLETED') OR (actual_qty > 0 AND total_material_cost >= 0 AND unit_production_cost >= 0))
);
CREATE TABLE IF NOT EXISTS production_consumptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  production_order_id UUID NOT NULL REFERENCES production_orders(id) ON DELETE RESTRICT,
  item_id UUID NOT NULL REFERENCES items(id) ON DELETE RESTRICT,
  lot_no VARCHAR(80) NOT NULL DEFAULT '',
  quantity NUMERIC(18,6) NOT NULL CHECK (quantity > 0),
  average_unit_cost NUMERIC(18,6) NOT NULL CHECK (average_unit_cost >= 0),
  extended_cost NUMERIC(18,6) NOT NULL CHECK (extended_cost >= 0),
  UNIQUE(production_order_id,item_id,lot_no)
);
CREATE TABLE IF NOT EXISTS production_outputs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  production_order_id UUID NOT NULL UNIQUE REFERENCES production_orders(id) ON DELETE RESTRICT,
  item_id UUID NOT NULL REFERENCES items(id) ON DELETE RESTRICT,
  lot_no VARCHAR(80) NOT NULL,
  quantity NUMERIC(18,6) NOT NULL CHECK (quantity > 0),
  unit_cost NUMERIC(18,6) NOT NULL CHECK (unit_cost >= 0),
  total_cost NUMERIC(18,6) NOT NULL CHECK (total_cost >= 0)
);

INSERT INTO permissions(code,name_ar,module_code) VALUES
 ('SUPPLIERS.READ','عرض الموردين','PURCHASES'),
 ('SUPPLIERS.MANAGE','إدارة الموردين','PURCHASES'),
 ('PURCHASES.APPROVE','اعتماد أوامر الشراء','PURCHASES'),
 ('RECEIVING.MANAGE','استلام المشتريات','PURCHASES'),
 ('QUALITY.APPROVE','اعتماد فحص الجودة','QUALITY'),
 ('PRODUCTION.COMPLETE','إتمام أوامر التشغيل','PRODUCTION')
ON CONFLICT (code) DO NOTHING;
