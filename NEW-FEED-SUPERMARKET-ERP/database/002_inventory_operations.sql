-- Operational inventory and purchasing layer.
CREATE TABLE IF NOT EXISTS stock_movements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  reference_no VARCHAR(60) NOT NULL,
  movement_type VARCHAR(24) NOT NULL CHECK (movement_type IN ('purchase_receipt','sale_issue','sale_return','purchase_return','adjustment','transfer_in','transfer_out')),
  product_id UUID NOT NULL REFERENCES products(id),
  warehouse_id UUID NOT NULL REFERENCES warehouses(id),
  lot_id UUID REFERENCES stock_lots(id),
  quantity_in NUMERIC(20,6) NOT NULL DEFAULT 0 CHECK (quantity_in >= 0),
  quantity_out NUMERIC(20,6) NOT NULL DEFAULT 0 CHECK (quantity_out >= 0),
  unit_cost NUMERIC(20,6) NOT NULL CHECK (unit_cost >= 0),
  source_type VARCHAR(40) NOT NULL,
  source_id UUID NOT NULL,
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK ((quantity_in = 0) <> (quantity_out = 0))
);
CREATE INDEX IF NOT EXISTS idx_stock_movements_product_date
  ON stock_movements(product_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_stock_movements_source
  ON stock_movements(source_type, source_id);

CREATE TABLE IF NOT EXISTS purchase_receipts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  reference_no VARCHAR(60) NOT NULL UNIQUE,
  purchase_order_id UUID NOT NULL REFERENCES purchase_orders(id),
  warehouse_id UUID NOT NULL REFERENCES warehouses(id),
  received_by UUID REFERENCES users(id),
  received_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  status VARCHAR(16) NOT NULL DEFAULT 'accepted'
    CHECK (status IN ('draft','accepted','rejected'))
);

CREATE TABLE IF NOT EXISTS purchase_receipt_lines (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  receipt_id UUID NOT NULL REFERENCES purchase_receipts(id),
  product_id UUID NOT NULL REFERENCES products(id),
  quantity NUMERIC(20,6) NOT NULL CHECK (quantity > 0),
  unit_cost NUMERIC(20,6) NOT NULL CHECK (unit_cost >= 0),
  lot_number VARCHAR(100),
  expiry_date DATE,
  stock_lot_id UUID REFERENCES stock_lots(id)
);
