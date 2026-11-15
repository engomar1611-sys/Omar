-- 042: enforce one-to-one conversion between online orders and POS invoices.
CREATE UNIQUE INDEX IF NOT EXISTS uq_ecommerce_orders_sales_id
  ON ecommerce_orders(sales_id) WHERE sales_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_ecommerce_orders_status_created
  ON ecommerce_orders(status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_ecommerce_order_lines_order
  ON ecommerce_order_lines(order_id);
