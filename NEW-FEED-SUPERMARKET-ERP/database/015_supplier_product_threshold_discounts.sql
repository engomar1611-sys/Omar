-- 015: supplier-product sourcing, party numbers and configurable threshold discounts.
CREATE SEQUENCE IF NOT EXISTS customer_number_seq START 1001;
CREATE SEQUENCE IF NOT EXISTS supplier_number_seq START 1001;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS customer_number BIGINT;
ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS supplier_number BIGINT;
UPDATE customers SET customer_number=nextval('customer_number_seq') WHERE customer_number IS NULL;
UPDATE suppliers SET supplier_number=nextval('supplier_number_seq') WHERE supplier_number IS NULL;
ALTER TABLE customers ALTER COLUMN customer_number SET DEFAULT nextval('customer_number_seq');
ALTER TABLE customers ALTER COLUMN customer_number SET NOT NULL;
ALTER TABLE suppliers ALTER COLUMN supplier_number SET DEFAULT nextval('supplier_number_seq');
ALTER TABLE suppliers ALTER COLUMN supplier_number SET NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_customers_customer_number ON customers(customer_number);
CREATE UNIQUE INDEX IF NOT EXISTS uq_suppliers_supplier_number ON suppliers(supplier_number);

CREATE TABLE IF NOT EXISTS product_suppliers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  supplier_id UUID NOT NULL REFERENCES suppliers(id),
  product_id UUID NOT NULL REFERENCES products(id),
  supplier_product_code VARCHAR(100),
  last_purchase_price NUMERIC(20,6) CHECK(last_purchase_price IS NULL OR last_purchase_price >= 0),
  is_primary BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(supplier_id,product_id)
);
CREATE INDEX IF NOT EXISTS ix_product_suppliers_product ON product_suppliers(product_id);
CREATE INDEX IF NOT EXISTS ix_product_suppliers_supplier ON product_suppliers(supplier_id);

CREATE TABLE IF NOT EXISTS sales_discount_settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  min_order_amount NUMERIC(20,6) NOT NULL DEFAULT 0 CHECK(min_order_amount >= 0),
  order_discount_type VARCHAR(10) NOT NULL DEFAULT 'percent' CHECK(order_discount_type IN ('amount','percent')),
  order_discount_value NUMERIC(20,6) NOT NULL DEFAULT 0 CHECK(order_discount_value >= 0),
  delivery_min_order_amount NUMERIC(20,6) NOT NULL DEFAULT 0 CHECK(delivery_min_order_amount >= 0),
  delivery_discount_type VARCHAR(10) NOT NULL DEFAULT 'percent' CHECK(delivery_discount_type IN ('amount','percent')),
  delivery_discount_value NUMERIC(20,6) NOT NULL DEFAULT 0 CHECK(delivery_discount_value >= 0),
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by UUID REFERENCES users(id)
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_sales_discount_settings_active
  ON sales_discount_settings(is_active) WHERE is_active=TRUE;
