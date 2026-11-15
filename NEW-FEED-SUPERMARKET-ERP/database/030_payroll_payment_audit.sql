-- 030: preserve payment evidence for payroll disbursement.
ALTER TABLE payroll_runs ADD COLUMN IF NOT EXISTS payment_method VARCHAR(12);
ALTER TABLE payroll_runs ADD COLUMN IF NOT EXISTS payment_reference VARCHAR(60);
ALTER TABLE payroll_runs ADD COLUMN IF NOT EXISTS paid_at TIMESTAMPTZ;
ALTER TABLE payroll_runs ADD COLUMN IF NOT EXISTS paid_by UUID REFERENCES users(id);
ALTER TABLE payroll_runs DROP CONSTRAINT IF EXISTS payroll_runs_payment_method_check;
ALTER TABLE payroll_runs ADD CONSTRAINT payroll_runs_payment_method_check
  CHECK (payment_method IS NULL OR payment_method IN ('cash','bank'));
