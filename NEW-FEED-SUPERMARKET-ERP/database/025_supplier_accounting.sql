-- 025: supplier invoices, payables, partial settlements and allocation controls.
INSERT INTO accounts(code,name_ar,name_en,account_type) VALUES
 ('2000','مستحقات الموردين','Accounts Payable','liability'),
 ('5010','فروق أسعار المشتريات','Purchase Price Variance','expense')
ON CONFLICT(code) DO NOTHING;

INSERT INTO system_account_mappings(mapping_key,account_id)
SELECT v.mapping_key,a.id FROM (VALUES
 ('supplier_payables','2000'),
 ('purchase_price_variance','5010')
) v(mapping_key,account_code)
JOIN accounts a ON a.code=v.account_code
ON CONFLICT(mapping_key) DO UPDATE SET account_id=EXCLUDED.account_id,updated_at=now();

CREATE TABLE IF NOT EXISTS supplier_invoices (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
 reference_no VARCHAR(50) NOT NULL UNIQUE,
 supplier_invoice_no VARCHAR(100) NOT NULL,
 supplier_id UUID NOT NULL REFERENCES suppliers(id),
 purchase_order_id UUID NOT NULL REFERENCES purchase_orders(id),
 invoice_date DATE NOT NULL DEFAULT CURRENT_DATE,
 due_date DATE,
 status VARCHAR(16) NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','posted','voided')),
 subtotal NUMERIC(20,6) NOT NULL DEFAULT 0 CHECK(subtotal>=0),
 journal_entry_id UUID REFERENCES journal_entries(id),
 created_by UUID REFERENCES users(id),
 posted_by UUID REFERENCES users(id),
 posted_at TIMESTAMPTZ,
 created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 UNIQUE(supplier_id,supplier_invoice_no)
);
CREATE TABLE IF NOT EXISTS supplier_invoice_lines (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
 invoice_id UUID NOT NULL REFERENCES supplier_invoices(id) ON DELETE CASCADE,
 receipt_line_id UUID NOT NULL REFERENCES purchase_receipt_lines(id),
 quantity NUMERIC(20,6) NOT NULL CHECK(quantity>0),
 unit_price NUMERIC(20,6) NOT NULL CHECK(unit_price>=0),
 line_total NUMERIC(20,6) NOT NULL CHECK(line_total>=0)
);
CREATE INDEX IF NOT EXISTS idx_supplier_invoice_lines_receipt ON supplier_invoice_lines(receipt_line_id);

CREATE TABLE IF NOT EXISTS supplier_payments (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
 reference_no VARCHAR(50) NOT NULL UNIQUE,
 supplier_id UUID NOT NULL REFERENCES suppliers(id),
 payment_method_id UUID NOT NULL REFERENCES payment_methods(id),
 amount NUMERIC(20,6) NOT NULL CHECK(amount>0),
 payment_date DATE NOT NULL DEFAULT CURRENT_DATE,
 payment_reference VARCHAR(120),
 bank_id UUID REFERENCES payment_banks(id),
 transaction_reference VARCHAR(120),
 card_last_four CHAR(4),
 created_by UUID REFERENCES users(id),
 journal_entry_id UUID REFERENCES journal_entries(id),
 created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS supplier_payment_allocations (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
 payment_id UUID NOT NULL REFERENCES supplier_payments(id) ON DELETE CASCADE,
 invoice_id UUID NOT NULL REFERENCES supplier_invoices(id),
 amount NUMERIC(20,6) NOT NULL CHECK(amount>0),
 UNIQUE(payment_id,invoice_id)
);
CREATE INDEX IF NOT EXISTS idx_supplier_payment_allocations_invoice ON supplier_payment_allocations(invoice_id);

INSERT INTO permissions(code,description) VALUES
 ('supplier.accounting','فواتير الموردين ومستحقاتهم وتسوياتهم')
ON CONFLICT(code) DO NOTHING;
INSERT INTO role_permissions(role_id,permission_id)
SELECT r.id,p.id FROM roles r CROSS JOIN permissions p
WHERE r.code IN ('SUPER_ADMIN','ACCOUNTANT','PURCHASING','BRANCH_MANAGER')
 AND p.code='supplier.accounting'
ON CONFLICT DO NOTHING;
