CREATE TABLE IF NOT EXISTS customer_quotations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  quote_no VARCHAR(40) NOT NULL UNIQUE,
  customer_id UUID NOT NULL REFERENCES customers(id) ON DELETE RESTRICT,
  warehouse_id UUID NOT NULL REFERENCES warehouses(id) ON DELETE RESTRICT,
  quote_date DATE NOT NULL DEFAULT CURRENT_DATE,
  valid_until DATE,
  status VARCHAR(20) NOT NULL DEFAULT 'DRAFT'
    CHECK (status IN ('DRAFT','PENDING_APPROVAL','APPROVED','REJECTED','CONVERTED','CANCELLED')),
  discount_amount NUMERIC(18,6) NOT NULL DEFAULT 0 CHECK (discount_amount >= 0),
  notes TEXT,
  created_by UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  approved_by UUID REFERENCES users(id) ON DELETE RESTRICT,
  approved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (valid_until IS NULL OR valid_until >= quote_date),
  CHECK (discount_amount >= 0),
  CHECK ((status IN ('APPROVED','CONVERTED')) = (approved_by IS NOT NULL AND approved_at IS NOT NULL))
);
CREATE TABLE IF NOT EXISTS customer_quotation_lines (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  quotation_id UUID NOT NULL REFERENCES customer_quotations(id) ON DELETE RESTRICT,
  line_no INTEGER NOT NULL CHECK (line_no > 0),
  item_id UUID NOT NULL REFERENCES items(id) ON DELETE RESTRICT,
  quantity NUMERIC(18,6) NOT NULL CHECK (quantity > 0),
  unit_price NUMERIC(18,6) NOT NULL CHECK (unit_price >= 0),
  notes TEXT,
  UNIQUE (quotation_id, line_no)
);
CREATE TABLE IF NOT EXISTS sales_orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_no VARCHAR(40) NOT NULL UNIQUE,
  source_quotation_id UUID NOT NULL UNIQUE REFERENCES customer_quotations(id) ON DELETE RESTRICT,
  customer_id UUID NOT NULL REFERENCES customers(id) ON DELETE RESTRICT,
  warehouse_id UUID NOT NULL REFERENCES warehouses(id) ON DELETE RESTRICT,
  order_date DATE NOT NULL DEFAULT CURRENT_DATE,
  status VARCHAR(24) NOT NULL DEFAULT 'OPEN'
    CHECK (status IN ('OPEN','INVOICED','PARTIALLY_DELIVERED','DELIVERED','CANCELLED')),
  discount_amount NUMERIC(18,6) NOT NULL DEFAULT 0 CHECK (discount_amount >= 0),
  created_by UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS sales_order_lines (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sales_order_id UUID NOT NULL REFERENCES sales_orders(id) ON DELETE RESTRICT,
  line_no INTEGER NOT NULL CHECK (line_no > 0),
  item_id UUID NOT NULL REFERENCES items(id) ON DELETE RESTRICT,
  ordered_qty NUMERIC(18,6) NOT NULL CHECK (ordered_qty > 0),
  unit_price NUMERIC(18,6) NOT NULL CHECK (unit_price >= 0),
  invoiced_qty NUMERIC(18,6) NOT NULL DEFAULT 0 CHECK (invoiced_qty >= 0 AND invoiced_qty <= ordered_qty),
  delivered_qty NUMERIC(18,6) NOT NULL DEFAULT 0 CHECK (delivered_qty >= 0 AND delivered_qty <= invoiced_qty),
  UNIQUE (sales_order_id, line_no)
);
CREATE TABLE IF NOT EXISTS sales_order_reservations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sales_order_id UUID NOT NULL REFERENCES sales_orders(id) ON DELETE RESTRICT,
  sales_order_line_id UUID NOT NULL REFERENCES sales_order_lines(id) ON DELETE RESTRICT,
  warehouse_id UUID NOT NULL REFERENCES warehouses(id) ON DELETE RESTRICT,
  item_id UUID NOT NULL REFERENCES items(id) ON DELETE RESTRICT,
  lot_no VARCHAR(80) NOT NULL DEFAULT '',
  reserved_qty NUMERIC(18,6) NOT NULL CHECK (reserved_qty > 0),
  status VARCHAR(16) NOT NULL DEFAULT 'RESERVED'
    CHECK (status IN ('RESERVED','CONSUMED','RELEASED')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_sales_order_reservations_available
  ON sales_order_reservations(warehouse_id,item_id,lot_no,status);
CREATE INDEX IF NOT EXISTS idx_sales_orders_customer_date
  ON sales_orders(customer_id,order_date DESC);

ALTER TABLE sales_invoices
  ADD COLUMN IF NOT EXISTS sales_order_id UUID REFERENCES sales_orders(id) ON DELETE RESTRICT;
CREATE UNIQUE INDEX IF NOT EXISTS uq_sales_invoices_order
  ON sales_invoices(sales_order_id) WHERE sales_order_id IS NOT NULL;
ALTER TABLE sales_invoice_lines
  ADD COLUMN IF NOT EXISTS sales_order_line_id UUID REFERENCES sales_order_lines(id) ON DELETE RESTRICT;

INSERT INTO permissions(code,name_ar,module_code) VALUES
 ('SALES_QUOTES.READ','عرض عروض أسعار العملاء','SALES'),
 ('SALES_QUOTES.MANAGE','إنشاء وإدارة عروض أسعار العملاء','SALES'),
 ('SALES_QUOTES.APPROVE','اعتماد عروض أسعار العملاء','SALES'),
 ('SALES_ORDERS.READ','عرض أوامر البيع وحجوزات المخزون','SALES'),
 ('SALES_ORDERS.MANAGE','إدارة أوامر البيع','SALES'),
 ('SALES_ORDERS.CANCEL','إلغاء أمر بيع وتحرير الحجز','SALES')
ON CONFLICT(code) DO NOTHING;
INSERT INTO role_permissions(role_id,permission_id)
SELECT r.id,p.id FROM roles r CROSS JOIN permissions p
WHERE r.code='SYSTEM_ADMIN'
 AND p.code IN ('SALES_QUOTES.READ','SALES_QUOTES.MANAGE','SALES_QUOTES.APPROVE','SALES_ORDERS.READ','SALES_ORDERS.MANAGE','SALES_ORDERS.CANCEL')
ON CONFLICT DO NOTHING;
