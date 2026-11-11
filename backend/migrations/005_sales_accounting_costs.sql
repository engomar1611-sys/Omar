-- Commercial, accounting, cash, returns, overhead and production variance foundations.
CREATE TABLE IF NOT EXISTS customers (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(), code VARCHAR(40) NOT NULL UNIQUE,
 name_ar VARCHAR(200) NOT NULL, phone VARCHAR(40), address TEXT,
 credit_limit NUMERIC(18,6) NOT NULL DEFAULT 0 CHECK(credit_limit>=0),
 is_active BOOLEAN NOT NULL DEFAULT TRUE, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_customers_code_lower ON customers(LOWER(code));
CREATE TABLE IF NOT EXISTS sales_invoices (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(), invoice_no VARCHAR(40) NOT NULL UNIQUE,
 customer_id UUID NOT NULL REFERENCES customers(id) ON DELETE RESTRICT,
 warehouse_id UUID NOT NULL REFERENCES warehouses(id) ON DELETE RESTRICT,
 invoice_date DATE NOT NULL DEFAULT CURRENT_DATE,
 status VARCHAR(20) NOT NULL DEFAULT 'DRAFT' CHECK(status IN ('DRAFT','POSTED','PARTIALLY_PAID','PAID','CANCELLED')),
 subtotal NUMERIC(18,6) NOT NULL DEFAULT 0 CHECK(subtotal>=0),
 discount_amount NUMERIC(18,6) NOT NULL DEFAULT 0 CHECK(discount_amount>=0),
 total_amount NUMERIC(18,6) NOT NULL DEFAULT 0 CHECK(total_amount>=0),
 cost_amount NUMERIC(18,6) NOT NULL DEFAULT 0 CHECK(cost_amount>=0),
 created_by UUID REFERENCES users(id) ON DELETE RESTRICT,
 posted_at TIMESTAMPTZ, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 CHECK(discount_amount<=subtotal), CHECK(total_amount=subtotal-discount_amount)
);
CREATE TABLE IF NOT EXISTS sales_invoice_lines (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
 sales_invoice_id UUID NOT NULL REFERENCES sales_invoices(id) ON DELETE RESTRICT,
 item_id UUID NOT NULL REFERENCES items(id) ON DELETE RESTRICT,
 lot_no VARCHAR(80) NOT NULL DEFAULT '',
 quantity NUMERIC(18,6) NOT NULL CHECK(quantity>0),
 unit_price NUMERIC(18,6) NOT NULL CHECK(unit_price>=0),
 unit_cost NUMERIC(18,6) NOT NULL CHECK(unit_cost>=0),
 line_total NUMERIC(18,6) NOT NULL CHECK(line_total>=0),
 cost_total NUMERIC(18,6) NOT NULL CHECK(cost_total>=0)
);
CREATE TABLE IF NOT EXISTS cash_receipts (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(), receipt_no VARCHAR(40) NOT NULL UNIQUE,
 customer_id UUID NOT NULL REFERENCES customers(id) ON DELETE RESTRICT,
 receipt_date DATE NOT NULL DEFAULT CURRENT_DATE,
 amount NUMERIC(18,6) NOT NULL CHECK(amount>0),
 payment_method VARCHAR(20) NOT NULL CHECK(payment_method IN ('CASH','BANK','TRANSFER','CHEQUE')),
 reference_no VARCHAR(100), status VARCHAR(16) NOT NULL DEFAULT 'POSTED' CHECK(status IN ('POSTED','REVERSED')),
 created_by UUID REFERENCES users(id) ON DELETE RESTRICT, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS receipt_allocations (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
 receipt_id UUID NOT NULL REFERENCES cash_receipts(id) ON DELETE RESTRICT,
 sales_invoice_id UUID NOT NULL REFERENCES sales_invoices(id) ON DELETE RESTRICT,
 amount NUMERIC(18,6) NOT NULL CHECK(amount>0), UNIQUE(receipt_id,sales_invoice_id)
);
CREATE TABLE IF NOT EXISTS sales_returns (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(), return_no VARCHAR(40) NOT NULL UNIQUE,
 sales_invoice_id UUID NOT NULL REFERENCES sales_invoices(id) ON DELETE RESTRICT,
 warehouse_id UUID NOT NULL REFERENCES warehouses(id) ON DELETE RESTRICT,
 status VARCHAR(20) NOT NULL DEFAULT 'PENDING_WAREHOUSE' CHECK(status IN ('PENDING_WAREHOUSE','PENDING_ACCOUNTING','APPROVED','REJECTED')),
 reason TEXT, created_by UUID REFERENCES users(id) ON DELETE RESTRICT,
 warehouse_approved_by UUID REFERENCES users(id) ON DELETE RESTRICT, warehouse_approved_at TIMESTAMPTZ,
 accounting_approved_by UUID REFERENCES users(id) ON DELETE RESTRICT, accounting_approved_at TIMESTAMPTZ,
 created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS sales_return_lines (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(), sales_return_id UUID NOT NULL REFERENCES sales_returns(id) ON DELETE RESTRICT,
 invoice_line_id UUID NOT NULL REFERENCES sales_invoice_lines(id) ON DELETE RESTRICT,
 item_id UUID NOT NULL REFERENCES items(id) ON DELETE RESTRICT,
 lot_no VARCHAR(80) NOT NULL DEFAULT '', quantity NUMERIC(18,6) NOT NULL CHECK(quantity>0),
 unit_price NUMERIC(18,6) NOT NULL CHECK(unit_price>=0), unit_cost NUMERIC(18,6) NOT NULL CHECK(unit_cost>=0)
);
CREATE TABLE IF NOT EXISTS gl_accounts (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(), code VARCHAR(30) NOT NULL UNIQUE,
 name_ar VARCHAR(160) NOT NULL, account_type VARCHAR(20) NOT NULL CHECK(account_type IN ('ASSET','LIABILITY','EQUITY','REVENUE','EXPENSE')),
 is_active BOOLEAN NOT NULL DEFAULT TRUE
);
CREATE TABLE IF NOT EXISTS journal_entries (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(), entry_no VARCHAR(50) NOT NULL UNIQUE,
 entry_date DATE NOT NULL DEFAULT CURRENT_DATE, source_type VARCHAR(40) NOT NULL,
 source_id UUID NOT NULL, description TEXT, status VARCHAR(16) NOT NULL DEFAULT 'POSTED' CHECK(status IN ('POSTED','REVERSED')),
 total_debit NUMERIC(18,6) NOT NULL CHECK(total_debit>=0), total_credit NUMERIC(18,6) NOT NULL CHECK(total_credit>=0),
 created_by UUID REFERENCES users(id) ON DELETE RESTRICT, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 CHECK(total_debit=total_credit), UNIQUE(source_type,source_id)
);
CREATE TABLE IF NOT EXISTS journal_lines (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(), journal_entry_id UUID NOT NULL REFERENCES journal_entries(id) ON DELETE RESTRICT,
 account_id UUID NOT NULL REFERENCES gl_accounts(id) ON DELETE RESTRICT,
 debit NUMERIC(18,6) NOT NULL DEFAULT 0 CHECK(debit>=0), credit NUMERIC(18,6) NOT NULL DEFAULT 0 CHECK(credit>=0),
 description TEXT, CHECK((debit>0 AND credit=0) OR (credit>0 AND debit=0))
);
CREATE TABLE IF NOT EXISTS production_cost_components (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(), production_order_id UUID NOT NULL REFERENCES production_orders(id) ON DELETE RESTRICT,
 component_code VARCHAR(30) NOT NULL CHECK(component_code IN ('LABOR','ENERGY','OVERHEAD','PACKAGING','WASTE')),
 description VARCHAR(200) NOT NULL, amount NUMERIC(18,6) NOT NULL CHECK(amount>=0),
 created_by UUID REFERENCES users(id) ON DELETE RESTRICT, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS expenses (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(), expense_no VARCHAR(40) NOT NULL UNIQUE,
 expense_date DATE NOT NULL DEFAULT CURRENT_DATE, account_id UUID NOT NULL REFERENCES gl_accounts(id) ON DELETE RESTRICT,
 amount NUMERIC(18,6) NOT NULL CHECK(amount>0), payment_method VARCHAR(20) NOT NULL CHECK(payment_method IN ('CASH','BANK')),
 description TEXT NOT NULL, status VARCHAR(16) NOT NULL DEFAULT 'POSTED' CHECK(status IN ('POSTED','REVERSED')),
 created_by UUID REFERENCES users(id) ON DELETE RESTRICT, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
INSERT INTO gl_accounts(code,name_ar,account_type) VALUES
 ('1000','الصندوق','ASSET'),('1010','البنك','ASSET'),('1100','العملاء','ASSET'),
 ('1200','المخزون','ASSET'),('2000','الموردون','LIABILITY'),('3000','رأس المال','EQUITY'),
 ('4000','مبيعات الأعلاف','REVENUE'),('5000','تكلفة المبيعات','EXPENSE'),
 ('5100','أجور الإنتاج','EXPENSE'),('5200','طاقة وتشغيل','EXPENSE'),('5300','مصروفات صناعية غير مباشرة','EXPENSE'),
 ('5400','مصروفات تشغيل أخرى','EXPENSE')
ON CONFLICT(code) DO NOTHING;
INSERT INTO permissions(code,name_ar,module_code) VALUES
 ('CUSTOMERS.READ','عرض العملاء','SALES'),('CUSTOMERS.MANAGE','إدارة العملاء','SALES'),
 ('SALES.POST','ترحيل فواتير المبيعات','SALES'),('RECEIPTS.MANAGE','إدارة المقبوضات','ACCOUNTING'),
 ('RETURNS.MANAGE','إدارة المرتجعات','SALES'),('RETURNS.WAREHOUSE_APPROVE','اعتماد المخزن للمرتجع','INVENTORY'),
 ('RETURNS.ACCOUNTING_APPROVE','الاعتماد المالي للمرتجع','ACCOUNTING'),
 ('ACCOUNTING.MANAGE','إدارة الحسابات','ACCOUNTING'),('EXPENSES.MANAGE','إدارة المصروفات','ACCOUNTING'),
 ('PRODUCTION.COSTS.MANAGE','إدارة عناصر تكلفة الإنتاج','PRODUCTION')
ON CONFLICT(code) DO NOTHING;
