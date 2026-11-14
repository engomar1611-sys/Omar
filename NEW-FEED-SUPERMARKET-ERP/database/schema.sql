-- NEW FEED SUPERMARKET ERP
-- Initial domain schema. Apply with a dedicated migration process.
-- No fabricated commercial SKU, price, barcode, or stock data is seeded.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS branches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code VARCHAR(30) NOT NULL UNIQUE,
  name VARCHAR(160) NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  username VARCHAR(80) NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  display_name VARCHAR(160) NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code VARCHAR(60) NOT NULL UNIQUE,
  name VARCHAR(120) NOT NULL
);

CREATE TABLE IF NOT EXISTS user_roles (
  user_id UUID NOT NULL REFERENCES users(id),
  role_id UUID NOT NULL REFERENCES roles(id),
  PRIMARY KEY (user_id, role_id)
);

CREATE TABLE IF NOT EXISTS permissions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code VARCHAR(100) NOT NULL UNIQUE,
  description VARCHAR(200) NOT NULL
);

CREATE TABLE IF NOT EXISTS role_permissions (
  role_id UUID NOT NULL REFERENCES roles(id),
  permission_id UUID NOT NULL REFERENCES permissions(id),
  PRIMARY KEY (role_id, permission_id)
);

CREATE TABLE IF NOT EXISTS categories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_id UUID REFERENCES categories(id),
  code VARCHAR(60) NOT NULL UNIQUE,
  name_ar VARCHAR(160) NOT NULL,
  name_en VARCHAR(160),
  is_active BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE TABLE IF NOT EXISTS units (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code VARCHAR(20) NOT NULL UNIQUE,
  name_ar VARCHAR(80) NOT NULL,
  name_en VARCHAR(80),
  dimension VARCHAR(20) NOT NULL CHECK (dimension IN ('count','mass','volume','length')),
  base_factor NUMERIC(20,8) NOT NULL CHECK (base_factor > 0)
);

CREATE TABLE IF NOT EXISTS products (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sku VARCHAR(80) NOT NULL UNIQUE,
  category_id UUID REFERENCES categories(id),
  name_ar VARCHAR(240) NOT NULL,
  name_en VARCHAR(240),
  base_unit_id UUID NOT NULL REFERENCES units(id),
  is_weighted BOOLEAN NOT NULL DEFAULT FALSE,
  tracks_expiry BOOLEAN NOT NULL DEFAULT FALSE,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS product_barcodes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id UUID NOT NULL REFERENCES products(id),
  barcode VARCHAR(80) NOT NULL UNIQUE,
  barcode_type VARCHAR(30) NOT NULL DEFAULT 'standard',
  unit_id UUID REFERENCES units(id),
  is_scale_barcode BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS product_units (
  product_id UUID NOT NULL REFERENCES products(id),
  unit_id UUID NOT NULL REFERENCES units(id),
  conversion_to_base NUMERIC(20,8) NOT NULL CHECK (conversion_to_base > 0),
  is_purchase_unit BOOLEAN NOT NULL DEFAULT FALSE,
  is_sale_unit BOOLEAN NOT NULL DEFAULT FALSE,
  PRIMARY KEY (product_id, unit_id)
);

CREATE TABLE IF NOT EXISTS warehouses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_id UUID NOT NULL REFERENCES branches(id),
  code VARCHAR(40) NOT NULL UNIQUE,
  name VARCHAR(160) NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE TABLE IF NOT EXISTS stock_lots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id UUID NOT NULL REFERENCES products(id),
  warehouse_id UUID NOT NULL REFERENCES warehouses(id),
  lot_number VARCHAR(100),
  expiry_date DATE,
  received_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  quantity_on_hand NUMERIC(20,6) NOT NULL DEFAULT 0 CHECK (quantity_on_hand >= 0),
  unit_cost NUMERIC(20,6) NOT NULL CHECK (unit_cost >= 0),
  CHECK (expiry_date IS NULL OR expiry_date >= DATE '2000-01-01')
);

CREATE INDEX IF NOT EXISTS idx_stock_lots_fefo
  ON stock_lots(product_id, warehouse_id, expiry_date, received_at);

CREATE TABLE IF NOT EXISTS suppliers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code VARCHAR(60) NOT NULL UNIQUE,
  name VARCHAR(200) NOT NULL,
  phone VARCHAR(40),
  is_active BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE TABLE IF NOT EXISTS customers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code VARCHAR(60) NOT NULL UNIQUE,
  name VARCHAR(200) NOT NULL,
  phone VARCHAR(40),
  loyalty_points BIGINT NOT NULL DEFAULT 0 CHECK (loyalty_points >= 0),
  is_active BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE TABLE IF NOT EXISTS purchase_orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  reference_no VARCHAR(50) NOT NULL UNIQUE,
  supplier_id UUID NOT NULL REFERENCES suppliers(id),
  branch_id UUID NOT NULL REFERENCES branches(id),
  status VARCHAR(24) NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft','submitted','approved','ordered','part_received','received','cancelled')),
  currency CHAR(3) NOT NULL DEFAULT 'EGP',
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS purchase_order_lines (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  purchase_order_id UUID NOT NULL REFERENCES purchase_orders(id),
  product_id UUID NOT NULL REFERENCES products(id),
  unit_id UUID NOT NULL REFERENCES units(id),
  quantity NUMERIC(20,6) NOT NULL CHECK (quantity > 0),
  unit_price NUMERIC(20,6) NOT NULL CHECK (unit_price >= 0)
);

CREATE TABLE IF NOT EXISTS sales (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  reference_no VARCHAR(50) NOT NULL UNIQUE,
  branch_id UUID NOT NULL REFERENCES branches(id),
  customer_id UUID REFERENCES customers(id),
  cashier_id UUID NOT NULL REFERENCES users(id),
  status VARCHAR(20) NOT NULL DEFAULT 'open'
    CHECK (status IN ('open','completed','voided','returned')),
  currency CHAR(3) NOT NULL DEFAULT 'EGP',
  subtotal NUMERIC(20,6) NOT NULL DEFAULT 0 CHECK (subtotal >= 0),
  discount_total NUMERIC(20,6) NOT NULL DEFAULT 0 CHECK (discount_total >= 0),
  tax_total NUMERIC(20,6) NOT NULL DEFAULT 0 CHECK (tax_total >= 0),
  grand_total NUMERIC(20,6) NOT NULL DEFAULT 0 CHECK (grand_total >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS sale_lines (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sale_id UUID NOT NULL REFERENCES sales(id),
  product_id UUID NOT NULL REFERENCES products(id),
  unit_id UUID NOT NULL REFERENCES units(id),
  quantity NUMERIC(20,6) NOT NULL CHECK (quantity > 0),
  unit_price NUMERIC(20,6) NOT NULL CHECK (unit_price >= 0),
  discount_amount NUMERIC(20,6) NOT NULL DEFAULT 0 CHECK (discount_amount >= 0),
  line_total NUMERIC(20,6) NOT NULL CHECK (line_total >= 0)
);

CREATE TABLE IF NOT EXISTS payment_methods (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code VARCHAR(30) NOT NULL UNIQUE,
  name_ar VARCHAR(80) NOT NULL,
  name_en VARCHAR(80),
  is_active BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE TABLE IF NOT EXISTS sale_payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sale_id UUID NOT NULL REFERENCES sales(id),
  payment_method_id UUID NOT NULL REFERENCES payment_methods(id),
  amount NUMERIC(20,6) NOT NULL CHECK (amount > 0),
  reference_text VARCHAR(120),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code VARCHAR(40) NOT NULL UNIQUE,
  name_ar VARCHAR(160) NOT NULL,
  name_en VARCHAR(160),
  account_type VARCHAR(20) NOT NULL
    CHECK (account_type IN ('asset','liability','equity','revenue','expense')),
  is_active BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE TABLE IF NOT EXISTS journal_entries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  reference_no VARCHAR(50) NOT NULL UNIQUE,
  source_type VARCHAR(40) NOT NULL,
  source_id UUID,
  entry_date DATE NOT NULL,
  status VARCHAR(16) NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft','posted','reversed')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS journal_lines (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  journal_entry_id UUID NOT NULL REFERENCES journal_entries(id),
  account_id UUID NOT NULL REFERENCES accounts(id),
  debit NUMERIC(20,6) NOT NULL DEFAULT 0 CHECK (debit >= 0),
  credit NUMERIC(20,6) NOT NULL DEFAULT 0 CHECK (credit >= 0),
  CHECK ((debit = 0) <> (credit = 0))
);

CREATE INDEX IF NOT EXISTS idx_sales_created_at ON sales(created_at);
CREATE INDEX IF NOT EXISTS idx_purchase_supplier ON purchase_orders(supplier_id);
CREATE INDEX IF NOT EXISTS idx_sale_lines_sale ON sale_lines(sale_id);
CREATE INDEX IF NOT EXISTS idx_journal_lines_entry ON journal_lines(journal_entry_id);
