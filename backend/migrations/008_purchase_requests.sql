CREATE TABLE IF NOT EXISTS purchase_requests (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
 request_no VARCHAR(40) NOT NULL UNIQUE,
 requested_by UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
 request_date DATE NOT NULL DEFAULT CURRENT_DATE,
 needed_by DATE,
 warehouse_id UUID NOT NULL REFERENCES warehouses(id) ON DELETE RESTRICT,
 status VARCHAR(16) NOT NULL DEFAULT 'DRAFT' CHECK(status IN ('DRAFT','PENDING_APPROVAL','APPROVED','REJECTED','ORDERED')),
 reason TEXT,
 approved_by UUID REFERENCES users(id) ON DELETE RESTRICT,
 approved_at TIMESTAMPTZ,
 purchase_order_id UUID REFERENCES purchase_orders(id) ON DELETE RESTRICT,
 created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 CHECK(needed_by IS NULL OR needed_by>=request_date),
 CHECK((status NOT IN ('APPROVED','ORDERED')) OR (approved_by IS NOT NULL AND approved_at IS NOT NULL))
);
CREATE TABLE IF NOT EXISTS purchase_request_lines (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
 purchase_request_id UUID NOT NULL REFERENCES purchase_requests(id) ON DELETE RESTRICT,
 line_no INTEGER NOT NULL CHECK(line_no>0),
 item_id UUID NOT NULL REFERENCES items(id) ON DELETE RESTRICT,
 requested_qty NUMERIC(18,6) NOT NULL CHECK(requested_qty>0),
 notes TEXT,
 UNIQUE(purchase_request_id,line_no)
);
INSERT INTO permissions(code,name_ar,module_code) VALUES
 ('PURCHASE_REQUESTS.READ','عرض طلبات الشراء الداخلية','PURCHASES'),
 ('PURCHASE_REQUESTS.MANAGE','إنشاء طلبات الشراء الداخلية','PURCHASES'),
 ('PURCHASE_REQUESTS.APPROVE','اعتماد طلبات الشراء الداخلية','PURCHASES'),
 ('PURCHASE_REQUESTS.CONVERT','تحويل الطلب المعتمد إلى أمر شراء','PURCHASES')
ON CONFLICT(code) DO NOTHING;
