-- 040: audit actual refund tender and link cash refunds to the exact till session.
ALTER TABLE sale_return_refunds
  ADD COLUMN IF NOT EXISTS cash_session_id UUID REFERENCES cash_sessions(id),
  ADD COLUMN IF NOT EXISTS bank_id UUID REFERENCES payment_banks(id),
  ADD COLUMN IF NOT EXISTS transaction_reference VARCHAR(100),
  ADD COLUMN IF NOT EXISTS card_last_four CHAR(4);

CREATE INDEX IF NOT EXISTS idx_sale_return_refunds_cash_session
  ON sale_return_refunds(cash_session_id) WHERE cash_session_id IS NOT NULL;
