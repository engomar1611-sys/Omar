-- 048: connect card refunds to the merchant settlement bank ledger.
ALTER TABLE sale_return_refunds
  ADD COLUMN IF NOT EXISTS settlement_bank_account_id UUID REFERENCES bank_accounts(id),
  ADD COLUMN IF NOT EXISTS terminal_amount NUMERIC(20,6) CHECK(terminal_amount IS NULL OR terminal_amount >= 0);

CREATE INDEX IF NOT EXISTS idx_sale_return_refunds_settlement_bank
  ON sale_return_refunds(settlement_bank_account_id) WHERE settlement_bank_account_id IS NOT NULL;
