-- Link supplier returns to their source purchase order and record contractual due dates.
ALTER TABLE purchase_returns
 ADD COLUMN IF NOT EXISTS purchase_order_id UUID REFERENCES purchase_orders(id) ON DELETE RESTRICT;
ALTER TABLE purchase_orders
 ADD COLUMN IF NOT EXISTS payment_due_date DATE;
CREATE INDEX IF NOT EXISTS idx_purchase_returns_order_status ON purchase_returns(purchase_order_id,status);
CREATE INDEX IF NOT EXISTS idx_purchase_orders_due_date ON purchase_orders(payment_due_date);
