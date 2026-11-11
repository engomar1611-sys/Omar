-- Reversal controls and immutable document reversal audit.
CREATE TABLE IF NOT EXISTS document_reversals (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
 source_type VARCHAR(40) NOT NULL,
 source_id UUID NOT NULL,
 reversal_entry_id UUID REFERENCES journal_entries(id) ON DELETE RESTRICT,
 reason TEXT NOT NULL,
 reversed_by UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
 reversed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 UNIQUE(source_type,source_id)
);
INSERT INTO permissions(code,name_ar,module_code) VALUES
 ('SALES.REVERSE','عكس فواتير المبيعات','SALES'),
 ('RECEIPTS.REVERSE','عكس سندات القبض','ACCOUNTING'),
 ('PURCHASE_RETURNS.REVERSE','عكس مردودات المشتريات','PURCHASES'),
 ('SUPPLIER_PAYMENTS.REVERSE','عكس سندات صرف الموردين','ACCOUNTING'),
 ('EXPENSES.REVERSE','عكس المصروفات','ACCOUNTING')
ON CONFLICT(code) DO NOTHING;
