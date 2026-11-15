-- 043: retain payment sub-ledger references and support controlled payroll payment reversal.
ALTER TABLE payroll_runs
  ADD COLUMN IF NOT EXISTS payment_cash_transaction_id UUID REFERENCES cash_transactions(id),
  ADD COLUMN IF NOT EXISTS payment_bank_transaction_id UUID REFERENCES bank_transactions(id),
  ADD COLUMN IF NOT EXISTS reversal_journal_entry_id UUID REFERENCES journal_entries(id),
  ADD COLUMN IF NOT EXISTS reversed_by UUID REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS reversed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS reversal_reason TEXT;

ALTER TABLE payroll_runs DROP CONSTRAINT IF EXISTS payroll_runs_status_check;
ALTER TABLE payroll_runs ADD CONSTRAINT payroll_runs_status_check
  CHECK (status IN ('draft','approved','paid','cancelled','reversed'));

CREATE INDEX IF NOT EXISTS idx_payroll_payment_cash_transaction
  ON payroll_runs(payment_cash_transaction_id) WHERE payment_cash_transaction_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_payroll_payment_bank_transaction
  ON payroll_runs(payment_bank_transaction_id) WHERE payment_bank_transaction_id IS NOT NULL;
