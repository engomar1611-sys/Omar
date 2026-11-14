-- 008: controlled sales returns with warehouse inspection and financial approval.
ALTER TABLE sale_returns
  ADD COLUMN IF NOT EXISTS warehouse_id UUID REFERENCES warehouses(id);
ALTER TABLE sale_returns
  ADD COLUMN IF NOT EXISTS inspection_note TEXT;

ALTER TABLE sale_return_lines
  ADD COLUMN IF NOT EXISTS inspected_by UUID REFERENCES users(id);
ALTER TABLE sale_return_lines
  ADD COLUMN IF NOT EXISTS expiry_date DATE;
ALTER TABLE sale_return_lines
  ADD COLUMN IF NOT EXISTS stock_lot_id UUID REFERENCES stock_lots(id);
ALTER TABLE sale_return_lines
  ADD COLUMN IF NOT EXISTS inspected_at TIMESTAMPTZ;

CREATE TABLE IF NOT EXISTS sale_return_refunds (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  return_id UUID NOT NULL UNIQUE REFERENCES sale_returns(id),
  payment_method_id UUID NOT NULL REFERENCES payment_methods(id),
  amount NUMERIC(20,6) NOT NULL CHECK (amount > 0),
  reference_text VARCHAR(120),
  processed_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ix_sale_returns_sale_status
  ON sale_returns(sale_id,status,created_at DESC);
