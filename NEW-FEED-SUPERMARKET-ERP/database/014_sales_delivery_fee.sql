-- 014: persist delivery charge on the originating sales invoice.
ALTER TABLE sales
  ADD COLUMN IF NOT EXISTS delivery_fee NUMERIC(20,6) NOT NULL DEFAULT 0
  CHECK (delivery_fee >= 0);
