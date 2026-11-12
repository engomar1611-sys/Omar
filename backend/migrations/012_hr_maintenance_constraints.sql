-- Extend stock movement types for maintenance issues and add payroll posting accounts.
ALTER TABLE stock_movements DROP CONSTRAINT IF EXISTS stock_movements_movement_type_check;
ALTER TABLE stock_movements ADD CONSTRAINT stock_movements_movement_type_check
 CHECK (movement_type IN ('PURCHASE_RECEIPT','PRODUCTION_ISSUE','PRODUCTION_OUTPUT','ADJUSTMENT_IN','ADJUSTMENT_OUT','MAINTENANCE_ISSUE'));
INSERT INTO gl_accounts(code,name_ar,account_type) VALUES
 ('1300','سلف العاملين','ASSET'),('2100','رواتب مستحقة','LIABILITY')
ON CONFLICT(code) DO NOTHING;
