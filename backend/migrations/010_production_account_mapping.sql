-- Dedicated ledger account for packaging costs capitalized into finished-goods inventory.
INSERT INTO gl_accounts(code,name_ar,account_type)
VALUES ('5410','تكاليف التعبئة والتغليف','EXPENSE')
ON CONFLICT(code) DO NOTHING;
