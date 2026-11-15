-- 045: controlled delivery lifecycle and immutable status history.
ALTER TABLE delivery_orders
  ADD COLUMN IF NOT EXISTS status_updated_by UUID REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS status_updated_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS failure_reason TEXT,
  ADD COLUMN IF NOT EXISTS cancelled_reason TEXT;

CREATE TABLE IF NOT EXISTS delivery_order_status_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  delivery_order_id UUID NOT NULL REFERENCES delivery_orders(id),
  previous_status VARCHAR(20),
  new_status VARCHAR(20) NOT NULL,
  courier_employee_id UUID REFERENCES employees(id),
  note TEXT,
  changed_by UUID REFERENCES users(id),
  changed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_delivery_status_history_order
  ON delivery_order_status_history(delivery_order_id,changed_at DESC);
