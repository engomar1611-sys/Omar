-- Sales delivery, picking and shipment traceability.
CREATE TABLE IF NOT EXISTS sales_deliveries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  delivery_no VARCHAR(40) NOT NULL UNIQUE,
  sales_invoice_id UUID NOT NULL REFERENCES sales_invoices(id) ON DELETE RESTRICT,
  delivery_date DATE NOT NULL DEFAULT CURRENT_DATE,
  shipping_address TEXT,
  driver_name VARCHAR(160),
  vehicle_no VARCHAR(40),
  status VARCHAR(24) NOT NULL DEFAULT 'PREPARING'
    CHECK (status IN ('PREPARING','READY','SHIPPED','PARTIALLY_DELIVERED','DELIVERED','CANCELLED')),
  notes TEXT,
  prepared_by UUID REFERENCES users(id) ON DELETE RESTRICT,
  shipped_by UUID REFERENCES users(id) ON DELETE RESTRICT,
  shipped_at TIMESTAMPTZ,
  delivered_by UUID REFERENCES users(id) ON DELETE RESTRICT,
  delivered_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK ((status NOT IN ('SHIPPED','PARTIALLY_DELIVERED','DELIVERED') OR shipped_at IS NOT NULL)),
  CHECK ((status NOT IN ('PARTIALLY_DELIVERED','DELIVERED') OR delivered_at IS NOT NULL))
);
CREATE TABLE IF NOT EXISTS sales_delivery_lines (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sales_delivery_id UUID NOT NULL REFERENCES sales_deliveries(id) ON DELETE RESTRICT,
  invoice_line_id UUID NOT NULL REFERENCES sales_invoice_lines(id) ON DELETE RESTRICT,
  item_id UUID NOT NULL REFERENCES items(id) ON DELETE RESTRICT,
  lot_no VARCHAR(80) NOT NULL DEFAULT '',
  planned_qty NUMERIC(18,6) NOT NULL CHECK (planned_qty > 0),
  shipped_qty NUMERIC(18,6) NOT NULL DEFAULT 0 CHECK (shipped_qty >= 0 AND shipped_qty <= planned_qty),
  delivered_qty NUMERIC(18,6) NOT NULL DEFAULT 0 CHECK (delivered_qty >= 0 AND delivered_qty <= shipped_qty),
  UNIQUE(sales_delivery_id, invoice_line_id)
);
CREATE INDEX IF NOT EXISTS idx_sales_deliveries_invoice
  ON sales_deliveries(sales_invoice_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_sales_delivery_lines_invoice_line
  ON sales_delivery_lines(invoice_line_id);
INSERT INTO permissions(code,name_ar,module_code) VALUES
 ('SALES_DELIVERIES.READ','عرض أوامر التجهيز والتسليم','SALES'),
 ('SALES_DELIVERIES.MANAGE','إنشاء وتجهيز أوامر التسليم','SALES'),
 ('SALES_DELIVERIES.DISPATCH','اعتماد الشحن وخروج السيارة','SALES'),
 ('SALES_DELIVERIES.CONFIRM','تأكيد استلام العميل','SALES')
ON CONFLICT (code) DO NOTHING;
