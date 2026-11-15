-- 027: auditable supplier invoice/payment reversals and supplier aging.
ALTER TABLE supplier_payments ADD COLUMN IF NOT EXISTS status VARCHAR(16) NOT NULL DEFAULT 'posted';
ALTER TABLE supplier_payments ADD COLUMN IF NOT EXISTS void_reason VARCHAR(1000);
ALTER TABLE supplier_payments ADD COLUMN IF NOT EXISTS voided_by UUID REFERENCES users(id);
ALTER TABLE supplier_payments ADD COLUMN IF NOT EXISTS voided_at TIMESTAMPTZ;
DO $$
BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='supplier_payments_status_check') THEN
  ALTER TABLE supplier_payments ADD CONSTRAINT supplier_payments_status_check CHECK(status IN ('posted','voided'));
 END IF;
END $$;
CREATE INDEX IF NOT EXISTS idx_supplier_invoices_supplier_due ON supplier_invoices(supplier_id,due_date) WHERE status='posted';
CREATE INDEX IF NOT EXISTS idx_supplier_payments_supplier_date ON supplier_payments(supplier_id,payment_date) WHERE status='posted';
