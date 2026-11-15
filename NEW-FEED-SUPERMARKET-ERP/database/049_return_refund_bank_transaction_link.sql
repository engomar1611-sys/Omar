-- 049: retain the bank ledger movement id created by a card refund.
ALTER TABLE sale_return_refunds
  ADD COLUMN IF NOT EXISTS bank_transaction_id UUID REFERENCES bank_transactions(id);

CREATE INDEX IF NOT EXISTS idx_sale_return_refunds_bank_transaction
  ON sale_return_refunds(bank_transaction_id) WHERE bank_transaction_id IS NOT NULL;
