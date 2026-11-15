-- 034: post approved payroll disbursements to the general ledger.
ALTER TABLE payroll_runs ADD COLUMN IF NOT EXISTS payment_journal_entry_id UUID REFERENCES journal_entries(id);
INSERT INTO accounts(code,name_ar,name_en,account_type)
VALUES ('5100','مصروف الأجور والمرتبات','Wages and Salaries Expense','expense')
ON CONFLICT(code) DO NOTHING;
INSERT INTO system_account_mappings(mapping_key,account_id)
SELECT v.mapping_key,a.id
FROM (VALUES ('payroll_expense','5100'),('cash','1000'),('bank','1010')) v(mapping_key,account_code)
JOIN accounts a ON a.code=v.account_code
ON CONFLICT(mapping_key) DO UPDATE SET account_id=EXCLUDED.account_id,updated_at=now();
