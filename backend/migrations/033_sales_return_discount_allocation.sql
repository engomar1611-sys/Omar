-- Persist the net customer credit for a sales return after allocating the
-- original invoice-level discount proportionally across returned line value.
ALTER TABLE sales_returns
  ADD COLUMN IF NOT EXISTS gross_amount NUMERIC(18,6),
  ADD COLUMN IF NOT EXISTS discount_amount NUMERIC(18,6),
  ADD COLUMN IF NOT EXISTS net_amount NUMERIC(18,6);

ALTER TABLE sales_returns
  ADD CONSTRAINT sales_returns_amounts_nonnegative
    CHECK ((gross_amount IS NULL OR gross_amount >= 0)
       AND (discount_amount IS NULL OR discount_amount >= 0)
       AND (net_amount IS NULL OR net_amount >= 0)),
  ADD CONSTRAINT sales_returns_net_not_above_gross
    CHECK (net_amount IS NULL OR (gross_amount IS NOT NULL AND net_amount <= gross_amount));

-- Keep historical approved returns unchanged: their posted journal entries
-- used the gross amount. New approvals persist the discounted net amount.
UPDATE sales_returns sr
SET gross_amount=COALESCE((
  SELECT SUM(l.quantity*l.unit_price)
  FROM sales_return_lines l WHERE l.sales_return_id=sr.id
),0)
WHERE sr.gross_amount IS NULL;
