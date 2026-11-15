-- 026: correct supplier accounting ledger mappings and GRNI clearing account.
INSERT INTO accounts(code,name_ar,name_en,account_type) VALUES
 ('2010','بضاعة مستلمة غير مفوترة','Goods Received Not Invoiced','liability'),
 ('5020','فروق أسعار المشتريات','Purchase Price Variance','expense')
ON CONFLICT(code) DO UPDATE SET
 name_ar=EXCLUDED.name_ar,name_en=EXCLUDED.name_en,account_type=EXCLUDED.account_type;

INSERT INTO system_account_mappings(mapping_key,account_id)
SELECT v.mapping_key,a.id FROM (VALUES
 ('grni','2010'),
 ('supplier_payables','2000'),
 ('purchase_price_variance','5020')
) v(mapping_key,account_code)
JOIN accounts a ON a.code=v.account_code
ON CONFLICT(mapping_key) DO UPDATE SET account_id=EXCLUDED.account_id,updated_at=now();
