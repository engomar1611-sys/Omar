-- 006: operational foundations for supermarket modules.
-- Idempotent additions; does not seed fictitious business data.
ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS email VARCHAR(180);
ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS tax_number VARCHAR(60);
ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS address TEXT;
ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS notes TEXT;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS email VARCHAR(180);
ALTER TABLE customers ADD COLUMN IF NOT EXISTS address TEXT;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS notes TEXT;
ALTER TABLE sales ADD COLUMN IF NOT EXISTS channel VARCHAR(20) NOT NULL DEFAULT 'pos'
  CHECK (channel IN ('pos','ecommerce','delivery'));
ALTER TABLE sales ADD COLUMN IF NOT EXISTS cashier_shift_id UUID;
ALTER TABLE sales ADD COLUMN IF NOT EXISTS completed_at TIMESTAMPTZ;
ALTER TABLE sales ADD COLUMN IF NOT EXISTS idempotency_key VARCHAR(100);
CREATE UNIQUE INDEX IF NOT EXISTS uq_sales_idempotency_key
  ON sales(idempotency_key) WHERE idempotency_key IS NOT NULL;

CREATE TABLE IF NOT EXISTS purchase_receipt_inspections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  receipt_id UUID NOT NULL REFERENCES purchase_receipts(id),
  product_id UUID NOT NULL REFERENCES products(id),
  accepted_quantity NUMERIC(20,6) NOT NULL DEFAULT 0 CHECK (accepted_quantity >= 0),
  rejected_quantity NUMERIC(20,6) NOT NULL DEFAULT 0 CHECK (rejected_quantity >= 0),
  condition_note TEXT,
  inspected_by UUID REFERENCES users(id),
  inspected_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (accepted_quantity + rejected_quantity > 0)
);

CREATE TABLE IF NOT EXISTS sale_returns (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  reference_no VARCHAR(50) NOT NULL UNIQUE,
  sale_id UUID NOT NULL REFERENCES sales(id),
  status VARCHAR(20) NOT NULL DEFAULT 'pending_inspection'
    CHECK(status IN ('pending_inspection','pending_finance','approved','rejected','refunded')),
  reason TEXT NOT NULL,
  requested_by UUID REFERENCES users(id),
  inspected_by UUID REFERENCES users(id),
  financially_approved_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  approved_at TIMESTAMPTZ
);
CREATE TABLE IF NOT EXISTS sale_return_lines (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  return_id UUID NOT NULL REFERENCES sale_returns(id),
  sale_line_id UUID NOT NULL REFERENCES sale_lines(id),
  product_id UUID NOT NULL REFERENCES products(id),
  quantity NUMERIC(20,6) NOT NULL CHECK(quantity > 0),
  condition VARCHAR(20) NOT NULL DEFAULT 'pending'
    CHECK(condition IN ('pending','sellable','damaged','expired')),
  refund_amount NUMERIC(20,6) NOT NULL CHECK(refund_amount >= 0)
);

CREATE TABLE IF NOT EXISTS cashboxes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_id UUID NOT NULL REFERENCES branches(id),
  code VARCHAR(40) NOT NULL UNIQUE,
  name VARCHAR(120) NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE
);
CREATE TABLE IF NOT EXISTS cash_transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cashbox_id UUID NOT NULL REFERENCES cashboxes(id),
  reference_no VARCHAR(50) NOT NULL UNIQUE,
  direction VARCHAR(10) NOT NULL CHECK(direction IN ('in','out')),
  amount NUMERIC(20,6) NOT NULL CHECK(amount > 0),
  source_type VARCHAR(40) NOT NULL,
  source_id UUID,
  description TEXT,
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS employees (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_code VARCHAR(40) NOT NULL UNIQUE,
  user_id UUID REFERENCES users(id),
  branch_id UUID NOT NULL REFERENCES branches(id),
  full_name VARCHAR(180) NOT NULL,
  job_title VARCHAR(120),
  phone VARCHAR(40),
  hire_date DATE,
  employment_status VARCHAR(20) NOT NULL DEFAULT 'active'
    CHECK(employment_status IN ('active','inactive','terminated')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS employee_shifts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id UUID NOT NULL REFERENCES employees(id),
  branch_id UUID NOT NULL REFERENCES branches(id),
  starts_at TIMESTAMPTZ NOT NULL,
  ends_at TIMESTAMPTZ,
  status VARCHAR(20) NOT NULL DEFAULT 'open'
    CHECK(status IN ('open','closed','cancelled')),
  CHECK(ends_at IS NULL OR ends_at > starts_at)
);

CREATE TABLE IF NOT EXISTS fixed_assets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  asset_code VARCHAR(50) NOT NULL UNIQUE,
  name VARCHAR(180) NOT NULL,
  category VARCHAR(100),
  branch_id UUID NOT NULL REFERENCES branches(id),
  purchase_date DATE,
  purchase_cost NUMERIC(20,6) NOT NULL DEFAULT 0 CHECK(purchase_cost >= 0),
  serial_number VARCHAR(120),
  status VARCHAR(20) NOT NULL DEFAULT 'active'
    CHECK(status IN ('active','maintenance','disposed')),
  notes TEXT
);
CREATE TABLE IF NOT EXISTS asset_maintenance (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  asset_id UUID NOT NULL REFERENCES fixed_assets(id),
  reference_no VARCHAR(50) NOT NULL UNIQUE,
  description TEXT NOT NULL,
  scheduled_at DATE,
  completed_at DATE,
  cost NUMERIC(20,6) NOT NULL DEFAULT 0 CHECK(cost >= 0),
  status VARCHAR(20) NOT NULL DEFAULT 'open'
    CHECK(status IN ('open','in_progress','completed','cancelled'))
);

CREATE TABLE IF NOT EXISTS delivery_orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  reference_no VARCHAR(50) NOT NULL UNIQUE,
  sale_id UUID REFERENCES sales(id),
  customer_id UUID NOT NULL REFERENCES customers(id),
  address TEXT NOT NULL,
  courier_employee_id UUID REFERENCES employees(id),
  delivery_fee NUMERIC(20,6) NOT NULL DEFAULT 0 CHECK(delivery_fee >= 0),
  status VARCHAR(20) NOT NULL DEFAULT 'pending'
    CHECK(status IN ('pending','assigned','out_for_delivery','delivered','failed','cancelled')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  delivered_at TIMESTAMPTZ
);
CREATE TABLE IF NOT EXISTS ecommerce_orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  reference_no VARCHAR(50) NOT NULL UNIQUE,
  customer_id UUID REFERENCES customers(id),
  customer_name VARCHAR(180) NOT NULL,
  phone VARCHAR(40) NOT NULL,
  address TEXT NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'new'
    CHECK(status IN ('new','confirmed','preparing','converted','cancelled')),
  sales_id UUID REFERENCES sales(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS ecommerce_order_lines (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID NOT NULL REFERENCES ecommerce_orders(id),
  product_id UUID NOT NULL REFERENCES products(id),
  quantity NUMERIC(20,6) NOT NULL CHECK(quantity > 0)
);

CREATE TABLE IF NOT EXISTS accounting_periods (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  period_name VARCHAR(40) NOT NULL UNIQUE,
  starts_on DATE NOT NULL,
  ends_on DATE NOT NULL,
  status VARCHAR(16) NOT NULL DEFAULT 'open'
    CHECK(status IN ('open','closed')),
  closed_by UUID REFERENCES users(id),
  closed_at TIMESTAMPTZ,
  CHECK(ends_on >= starts_on)
);
CREATE TABLE IF NOT EXISTS bank_accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_id UUID NOT NULL REFERENCES branches(id),
  code VARCHAR(40) NOT NULL UNIQUE,
  bank_name VARCHAR(120) NOT NULL,
  account_name VARCHAR(120) NOT NULL,
  account_number_masked VARCHAR(40),
  currency CHAR(3) NOT NULL DEFAULT 'EGP',
  is_active BOOLEAN NOT NULL DEFAULT TRUE
);
