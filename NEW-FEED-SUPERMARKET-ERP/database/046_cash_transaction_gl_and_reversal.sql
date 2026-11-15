-- 046: map each till to a cash control account and audit cash movement reversals.
ALTER TABLE cashboxes
  ADD COLUMN IF NOT EXISTS ledger_account_id UUID REFERENCES accounts(id);

UPDATE cashboxes
SET ledger_account_id=(SELECT id FROM accounts WHERE code='1000' AND is_active=true)
WHERE ledger_account_id IS NULL
  AND EXISTS (SELECT 1 FROM accounts WHERE code='1000' AND is_active=true);

CREATE INDEX IF NOT EXISTS idx_cashboxes_ledger_account
  ON cashboxes(ledger_account_id);

ALTER TABLE cash_transactions
  ADD COLUMN IF NOT EXISTS journal_entry_id UUID REFERENCES journal_entries(id),
  ADD COLUMN IF NOT EXISTS reversed_by UUID REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS reversed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS reversal_reason TEXT,
  ADD COLUMN IF NOT EXISTS reversal_transaction_id UUID REFERENCES cash_transactions(id);

CREATE INDEX IF NOT EXISTS idx_cash_transactions_journal
  ON cash_transactions(journal_entry_id) WHERE journal_entry_id IS NOT NULL;
