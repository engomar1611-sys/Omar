-- 033: associate cash payments with the exact cashier session for reliable reconciliation.
ALTER TABLE sale_payments ADD COLUMN IF NOT EXISTS cash_session_id UUID REFERENCES cash_sessions(id);
CREATE INDEX IF NOT EXISTS idx_sale_payments_cash_session ON sale_payments(cash_session_id) WHERE cash_session_id IS NOT NULL;
-- One operator must not run two open tills at the same time.
CREATE UNIQUE INDEX IF NOT EXISTS uq_cash_session_one_open_per_cashier
  ON cash_sessions(cashier_id) WHERE status='open';
