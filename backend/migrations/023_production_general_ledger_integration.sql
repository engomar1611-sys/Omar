-- Integrate production material consumption and finished output with the general ledger.
-- Account 1300 is a balance-sheet work-in-process account, not an expense account.
INSERT INTO gl_accounts(code,name_ar,account_type)
VALUES ('1300','إنتاج تحت التشغيل','ASSET')
ON CONFLICT(code) DO NOTHING;
