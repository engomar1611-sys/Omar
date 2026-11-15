-- 038: map each bank sub-ledger account to its general-ledger control account.
ALTER TABLE bank_accounts
  ADD COLUMN IF NOT EXISTS ledger_account_id UUID REFERENCES accounts(id);

UPDATE bank_accounts
SET ledger_account_id=(SELECT id FROM accounts WHERE code='1010')
WHERE ledger_account_id IS NULL
  AND EXISTS (SELECT 1 FROM accounts WHERE code='1010');

CREATE INDEX IF NOT EXISTS idx_bank_accounts_ledger_account
  ON bank_accounts(ledger_account_id);
