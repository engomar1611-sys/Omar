-- 029: complete missing operational foundations without fabricated business data.
ALTER TABLE employees ADD COLUMN IF NOT EXISTS monthly_salary NUMERIC(20,6) NOT NULL DEFAULT 0 CHECK (monthly_salary >= 0);
ALTER TABLE employees ADD COLUMN IF NOT EXISTS national_id_masked VARCHAR(30);
ALTER TABLE employees ADD COLUMN IF NOT EXISTS emergency_contact VARCHAR(80);

CREATE TABLE IF NOT EXISTS customer_loyalty_transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id UUID NOT NULL REFERENCES customers(id),
  reference_no VARCHAR(60) NOT NULL UNIQUE,
  transaction_type VARCHAR(16) NOT NULL CHECK (transaction_type IN ('earn','redeem','adjust','expire')),
  points BIGINT NOT NULL CHECK (points > 0),
  source_type VARCHAR(40) NOT NULL,
  source_id UUID,
  notes TEXT,
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_loyalty_customer_date ON customer_loyalty_transactions(customer_id,created_at DESC);

CREATE TABLE IF NOT EXISTS employee_attendance (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id UUID NOT NULL REFERENCES employees(id),
  branch_id UUID NOT NULL REFERENCES branches(id),
  attendance_date DATE NOT NULL,
  clock_in TIMESTAMPTZ,
  clock_out TIMESTAMPTZ,
  status VARCHAR(16) NOT NULL DEFAULT 'present' CHECK(status IN ('present','absent','leave','late')),
  notes TEXT,
  approved_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(employee_id,attendance_date),
  CHECK(clock_out IS NULL OR clock_in IS NOT NULL AND clock_out > clock_in)
);
CREATE TABLE IF NOT EXISTS payroll_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  reference_no VARCHAR(50) NOT NULL UNIQUE,
  period_start DATE NOT NULL,
  period_end DATE NOT NULL,
  status VARCHAR(16) NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','approved','paid','cancelled')),
  total_gross NUMERIC(20,6) NOT NULL DEFAULT 0 CHECK(total_gross >= 0),
  total_deductions NUMERIC(20,6) NOT NULL DEFAULT 0 CHECK(total_deductions >= 0),
  total_net NUMERIC(20,6) NOT NULL DEFAULT 0 CHECK(total_net >= 0),
  created_by UUID REFERENCES users(id),
  approved_by UUID REFERENCES users(id),
  approved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK(period_end >= period_start)
);
CREATE TABLE IF NOT EXISTS payroll_lines (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  payroll_run_id UUID NOT NULL REFERENCES payroll_runs(id),
  employee_id UUID NOT NULL REFERENCES employees(id),
  base_salary NUMERIC(20,6) NOT NULL CHECK(base_salary >= 0),
  additions NUMERIC(20,6) NOT NULL DEFAULT 0 CHECK(additions >= 0),
  deductions NUMERIC(20,6) NOT NULL DEFAULT 0 CHECK(deductions >= 0),
  net_salary NUMERIC(20,6) NOT NULL CHECK(net_salary >= 0),
  UNIQUE(payroll_run_id,employee_id)
);

CREATE TABLE IF NOT EXISTS cash_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  reference_no VARCHAR(50) NOT NULL UNIQUE,
  cashbox_id UUID NOT NULL REFERENCES cashboxes(id),
  cashier_id UUID NOT NULL REFERENCES users(id),
  opened_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  opening_float NUMERIC(20,6) NOT NULL DEFAULT 0 CHECK(opening_float >= 0),
  expected_cash NUMERIC(20,6),
  counted_cash NUMERIC(20,6),
  variance NUMERIC(20,6),
  status VARCHAR(16) NOT NULL DEFAULT 'open' CHECK(status IN ('open','closed')),
  closed_at TIMESTAMPTZ,
  closed_by UUID REFERENCES users(id),
  CHECK((status='open' AND closed_at IS NULL) OR (status='closed' AND closed_at IS NOT NULL))
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_cash_session_one_open_per_box ON cash_sessions(cashbox_id) WHERE status='open';

CREATE TABLE IF NOT EXISTS bank_transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bank_account_id UUID NOT NULL REFERENCES bank_accounts(id),
  reference_no VARCHAR(60) NOT NULL UNIQUE,
  transaction_date DATE NOT NULL DEFAULT CURRENT_DATE,
  direction VARCHAR(8) NOT NULL CHECK(direction IN ('in','out')),
  amount NUMERIC(20,6) NOT NULL CHECK(amount > 0),
  description TEXT,
  source_type VARCHAR(40) NOT NULL DEFAULT 'manual',
  source_id UUID,
  status VARCHAR(16) NOT NULL DEFAULT 'posted' CHECK(status IN ('posted','reversed')),
  reversed_by UUID REFERENCES users(id),
  reversed_at TIMESTAMPTZ,
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_bank_transactions_account_date ON bank_transactions(bank_account_id,transaction_date DESC);

CREATE TABLE IF NOT EXISTS company_settings (
  setting_key VARCHAR(80) PRIMARY KEY,
  setting_value JSONB NOT NULL,
  updated_by UUID REFERENCES users(id),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS tax_codes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code VARCHAR(40) NOT NULL UNIQUE,
  name_ar VARCHAR(120) NOT NULL,
  rate NUMERIC(9,6) NOT NULL CHECK(rate >= 0 AND rate <= 100),
  account_id UUID REFERENCES accounts(id),
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS system_notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title VARCHAR(180) NOT NULL,
  message TEXT NOT NULL,
  severity VARCHAR(12) NOT NULL DEFAULT 'info' CHECK(severity IN ('info','warning','critical')),
  module_code VARCHAR(40),
  is_read BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO permissions(code,description) VALUES
 ('loyalty.manage','إدارة نقاط ولاء العملاء'),
 ('hr.attendance','إدارة حضور وانصراف الموظفين'),
 ('hr.payroll','إدارة الرواتب'),
 ('cash.manage','إدارة جلسات الخزينة والكاشير'),
 ('bank.manage','إدارة حركة الحسابات البنكية'),
 ('settings.manage','إدارة إعدادات الشركة والضرائب')
ON CONFLICT(code) DO NOTHING;
INSERT INTO role_permissions(role_id,permission_id)
SELECT r.id,p.id FROM roles r CROSS JOIN permissions p
WHERE r.code IN ('SUPER_ADMIN','BRANCH_MANAGER') AND p.code IN
 ('loyalty.manage','hr.attendance','hr.payroll','cash.manage','bank.manage','settings.manage')
ON CONFLICT DO NOTHING;
INSERT INTO role_permissions(role_id,permission_id)
SELECT r.id,p.id FROM roles r CROSS JOIN permissions p
WHERE r.code='ACCOUNTANT' AND p.code IN ('hr.payroll','cash.manage','bank.manage','settings.manage')
ON CONFLICT DO NOTHING;
INSERT INTO role_permissions(role_id,permission_id)
SELECT r.id,p.id FROM roles r CROSS JOIN permissions p
WHERE r.code='HR_MANAGER' AND p.code IN ('hr.attendance','hr.payroll')
ON CONFLICT DO NOTHING;
