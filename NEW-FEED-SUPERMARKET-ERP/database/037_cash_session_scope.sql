-- 037: scope till cash movements to the exact cashier session.
ALTER TABLE cash_transactions
  ADD COLUMN IF NOT EXISTS cash_session_id UUID REFERENCES cash_sessions(id);
CREATE INDEX IF NOT EXISTS idx_cash_transactions_session
  ON cash_transactions(cash_session_id) WHERE cash_session_id IS NOT NULL;

-- Bank ledger entries retain a direct link to their GL posting when one exists.
ALTER TABLE bank_transactions
  ADD COLUMN IF NOT EXISTS journal_entry_id UUID REFERENCES journal_entries(id);
CREATE INDEX IF NOT EXISTS idx_bank_transactions_journal
  ON bank_transactions(journal_entry_id) WHERE journal_entry_id IS NOT NULL;
