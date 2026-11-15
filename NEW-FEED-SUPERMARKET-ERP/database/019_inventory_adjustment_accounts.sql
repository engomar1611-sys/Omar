-- 019: ledger accounts for physical inventory gains and losses.
INSERT INTO accounts(code,name_ar,name_en,account_type) VALUES
 ('4020','أرباح تسويات المخزون','Inventory Adjustment Gain','revenue'),
 ('5010','خسائر تسويات المخزون','Inventory Adjustment Loss','expense')
ON CONFLICT(code) DO NOTHING;
INSERT INTO system_account_mappings(mapping_key,account_id)
SELECT v.mapping_key,a.id FROM (VALUES ('inventory_gain','4020'),('inventory_loss','5010')) v(mapping_key,account_code)
JOIN accounts a ON a.code=v.account_code
ON CONFLICT(mapping_key) DO UPDATE SET account_id=EXCLUDED.account_id,updated_at=now();
