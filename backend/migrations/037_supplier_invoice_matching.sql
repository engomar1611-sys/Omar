CREATE TABLE IF NOT EXISTS supplier_invoices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  supplier_invoice_no VARCHAR(60) NOT NULL,
  supplier_id UUID NOT NULL REFERENCES suppliers(id) ON DELETE RESTRICT,
  purchase_order_id UUID NOT NULL REFERENCES purchase_orders(id) ON DELETE RESTRICT,
  invoice_date DATE NOT NULL,
  due_date DATE NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'DRAFT'
    CHECK (status IN ('DRAFT','PENDING_APPROVAL','REGISTERED','REJECTED','CANCELLED')),
  subtotal NUMERIC(18,6) NOT NULL DEFAULT 0 CHECK (subtotal >= 0),
  total_amount NUMERIC(18,6) NOT NULL DEFAULT 0 CHECK (total_amount >= 0),
  notes TEXT,
  created_by UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  registered_by UUID REFERENCES users(id) ON DELETE RESTRICT,
  registered_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(supplier_id,supplier_invoice_no),
  CHECK (due_date >= invoice_date),
  CHECK ((status = 'REGISTERED') = (registered_by IS NOT NULL AND registered_at IS NOT NULL))
);
CREATE TABLE IF NOT EXISTS supplier_invoice_lines (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  supplier_invoice_id UUID NOT NULL REFERENCES supplier_invoices(id) ON DELETE RESTRICT,
  goods_receipt_line_id UUID NOT NULL REFERENCES goods_receipt_lines(id) ON DELETE RESTRICT,
  purchase_order_line_id UUID NOT NULL REFERENCES purchase_order_lines(id) ON DELETE RESTRICT,
  item_id UUID NOT NULL REFERENCES items(id) ON DELETE RESTRICT,
  invoiced_qty NUMERIC(18,6) NOT NULL CHECK (invoiced_qty > 0),
  unit_cost NUMERIC(18,6) NOT NULL CHECK (unit_cost >= 0),
  line_total NUMERIC(18,6) NOT NULL CHECK (line_total >= 0),
  UNIQUE(supplier_invoice_id,goods_receipt_line_id)
);
CREATE INDEX IF NOT EXISTS idx_supplier_invoices_due_status
  ON supplier_invoices(supplier_id,due_date,status);
CREATE INDEX IF NOT EXISTS idx_supplier_invoice_lines_receipt
  ON supplier_invoice_lines(goods_receipt_line_id);

INSERT INTO permissions(code,name_ar,module_code) VALUES
 ('SUPPLIER_INVOICES.READ','عرض فواتير الموردين ومطابقتها','PURCHASES'),
 ('SUPPLIER_INVOICES.MANAGE','تسجيل فواتير الموردين','PURCHASES'),
 ('SUPPLIER_INVOICES.APPROVE','اعتماد ومطابقة فواتير الموردين','PURCHASES')
ON CONFLICT(code) DO NOTHING;
INSERT INTO role_permissions(role_id,permission_id)
SELECT r.id,p.id FROM roles r CROSS JOIN permissions p
WHERE r.code='SYSTEM_ADMIN'
 AND p.code IN ('SUPPLIER_INVOICES.READ','SUPPLIER_INVOICES.MANAGE','SUPPLIER_INVOICES.APPROVE')
ON CONFLICT DO NOTHING;
