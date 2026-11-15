-- 041: configurable point redemption and auditable POS loyalty discounts.
ALTER TABLE loyalty_program_settings
  ADD COLUMN IF NOT EXISTS egp_per_point NUMERIC(12,6) NOT NULL DEFAULT 0
    CHECK (egp_per_point >= 0 AND egp_per_point <= 1000);

ALTER TABLE sales
  ADD COLUMN IF NOT EXISTS loyalty_points_redeemed BIGINT NOT NULL DEFAULT 0
    CHECK (loyalty_points_redeemed >= 0),
  ADD COLUMN IF NOT EXISTS loyalty_discount_amount NUMERIC(14,6) NOT NULL DEFAULT 0
    CHECK (loyalty_discount_amount >= 0);

CREATE INDEX IF NOT EXISTS idx_loyalty_transactions_source
  ON customer_loyalty_transactions(source_type, source_id, transaction_type);
