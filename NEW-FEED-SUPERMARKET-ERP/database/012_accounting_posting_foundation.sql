-- 012: minimum operational chart of accounts and source-to-account mappings.
ALTER TABLE payment_methods
  ADD COLUMN IF NOT EXISTS account_id UUID REFERENCES accounts(id);

INSERT INTO accounts(code,name_ar,name_en,account_type) VALUES
  ('1000','الصندوق الرئيسي','Main Cash','asset'),
  ('1010','البنوك','Bank Accounts','asset'),
  ('1020','المحافظ الإلكترونية','E-wallets','asset'),
  ('1200','المخزون','Inventory','asset'),
  ('2100','بضاعة مستلمة غير مفوترة','Goods Received Not Invoiced','liability'),
  ('2110','مبالغ مرتجعات مستحقة للعملاء','Customer Refunds Payable','liability'),
  ('4000','إيرادات المبيعات','Sales Revenue','revenue'),
  ('4010','مردودات ومسموحات المبيعات','Sales Returns and Allowances','revenue'),
  ('5000','تكلفة البضاعة المباعة','Cost of Goods Sold','expense')
ON CONFLICT(code) DO NOTHING;

CREATE TABLE IF NOT EXISTS system_account_mappings (
  mapping_key VARCHAR(60) PRIMARY KEY,
  account_id UUID NOT NULL REFERENCES accounts(id),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO system_account_mappings(mapping_key,account_id)
SELECT v.mapping_key,a.id
FROM (VALUES
  ('inventory','1200'),
  ('grni','2100'),
  ('refund_payable','2110'),
  ('sales_revenue','4000'),
  ('sales_returns','4010'),
  ('cogs','5000')
) AS v(mapping_key,account_code)
JOIN accounts a ON a.code=v.account_code
ON CONFLICT(mapping_key) DO UPDATE SET account_id=EXCLUDED.account_id,updated_at=now();

UPDATE payment_methods pm SET account_id=a.id
FROM accounts a
WHERE (pm.code='CASH' AND a.code='1000')
   OR (pm.code IN ('CARD','BANK_TRANSFER') AND a.code='1010')
   OR (pm.code='WALLET' AND a.code='1020');

CREATE UNIQUE INDEX IF NOT EXISTS uq_journal_source_posting
  ON journal_entries(source_type,source_id)
  WHERE source_id IS NOT NULL;
