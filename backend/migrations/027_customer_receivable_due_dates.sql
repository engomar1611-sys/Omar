-- Contractual customer invoice due dates for accurate receivables aging.
ALTER TABLE sales_invoices ADD COLUMN IF NOT EXISTS due_date DATE;
ALTER TABLE sales_invoices DROP CONSTRAINT IF EXISTS sales_invoices_due_date_check;
ALTER TABLE sales_invoices ADD CONSTRAINT sales_invoices_due_date_check
 CHECK(due_date IS NULL OR due_date>=invoice_date);
CREATE INDEX IF NOT EXISTS idx_sales_invoices_due_date ON sales_invoices(due_date);
