-- 032: connect selected invoice tax code to sales and its tax liability account.
ALTER TABLE sales ADD COLUMN IF NOT EXISTS tax_code_id UUID REFERENCES tax_codes(id);
