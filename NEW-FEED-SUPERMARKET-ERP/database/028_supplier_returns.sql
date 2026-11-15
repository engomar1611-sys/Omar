-- 028: supplier purchase returns, inspection, stock relief and credit allocation.
CREATE TABLE IF NOT EXISTS supplier_returns (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
 reference_no VARCHAR(50) NOT NULL UNIQUE,
 supplier_id UUID NOT NULL REFERENCES suppliers(id),
 purchase_order_id UUID NOT NULL REFERENCES purchase_orders(id),
 purchase_receipt_id UUID NOT NULL REFERENCES purchase_receipts(id),
 reason VARCHAR(1000) NOT NULL,
 status VARCHAR(20) NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','inspected','rejected','posted')),
 requested_by UUID REFERENCES users(id),
 inspected_by UUID REFERENCES users(id),
 posted_by UUID REFERENCES users(id),
 journal_entry_id UUID REFERENCES journal_entries(id),
 credit_total NUMERIC(20,6) NOT NULL DEFAULT 0 CHECK(credit_total>=0),
 inventory_cost_total NUMERIC(20,6) NOT NULL DEFAULT 0 CHECK(inventory_cost_total>=0),
 created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 inspected_at TIMESTAMPTZ,
 posted_at TIMESTAMPTZ
);
CREATE TABLE IF NOT EXISTS supplier_return_lines (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
 return_id UUID NOT NULL REFERENCES supplier_returns(id) ON DELETE CASCADE,
 receipt_line_id UUID NOT NULL REFERENCES purchase_receipt_lines(id),
 stock_lot_id UUID NOT NULL REFERENCES stock_lots(id),
 product_id UUID NOT NULL REFERENCES products(id),
 requested_quantity NUMERIC(20,6) NOT NULL CHECK(requested_quantity>0),
 accepted_quantity NUMERIC(20,6) NOT NULL DEFAULT 0 CHECK(accepted_quantity>=0),
 rejected_quantity NUMERIC(20,6) NOT NULL DEFAULT 0 CHECK(rejected_quantity>=0),
 unit_cost NUMERIC(20,6) NOT NULL CHECK(unit_cost>=0),
 credit_unit_price NUMERIC(20,6) NOT NULL CHECK(credit_unit_price>=0),
 notes VARCHAR(500),
 CHECK(accepted_quantity+rejected_quantity<=requested_quantity+0.000001)
);
CREATE TABLE IF NOT EXISTS supplier_return_allocations (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
 return_id UUID NOT NULL REFERENCES supplier_returns(id) ON DELETE CASCADE,
 invoice_id UUID NOT NULL REFERENCES supplier_invoices(id),
 amount NUMERIC(20,6) NOT NULL CHECK(amount>0),
 UNIQUE(return_id,invoice_id)
);
CREATE INDEX IF NOT EXISTS idx_supplier_returns_supplier ON supplier_returns(supplier_id,created_at DESC);
CREATE INDEX IF NOT EXISTS idx_supplier_return_lines_receipt ON supplier_return_lines(receipt_line_id);
CREATE INDEX IF NOT EXISTS idx_supplier_return_allocations_invoice ON supplier_return_allocations(invoice_id);
