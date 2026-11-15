-- 016: persist gross delivery charge and automatic threshold discounts separately.
ALTER TABLE sales ADD COLUMN IF NOT EXISTS order_discount_amount NUMERIC(20,6) NOT NULL DEFAULT 0 CHECK(order_discount_amount >= 0);
ALTER TABLE sales ADD COLUMN IF NOT EXISTS delivery_discount_amount NUMERIC(20,6) NOT NULL DEFAULT 0 CHECK(delivery_discount_amount >= 0);
ALTER TABLE sales ADD COLUMN IF NOT EXISTS delivery_fee_before_discount NUMERIC(20,6) NOT NULL DEFAULT 0 CHECK(delivery_fee_before_discount >= 0);
