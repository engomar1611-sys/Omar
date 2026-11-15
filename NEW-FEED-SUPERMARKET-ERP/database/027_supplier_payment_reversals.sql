-- 027: auditable supplier payment reversals.
ALTER TABLE supplier_payments
  ADD COLUMN IF NOT EXISTS status VARCHAR(16) NOT NULL DEFAULT 'posted',
  ADD COLUMN IF NOT EXISTS void_reason VARCHAR(1000),
  ADD COLUMN IF NOT EXISTS voided_by UUID REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS voided_at TIMESTAMPTZ;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid='supplier_payments'::regclass
      AND conname='supplier_payments_status_check'
  ) THEN
    ALTER TABLE supplier_payments
      ADD CONSTRAINT supplier_payments_status_check
      CHECK(status IN ('posted','voided'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_supplier_payments_status_date
  ON supplier_payments(status,payment_date DESC);
