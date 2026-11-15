CREATE TABLE IF NOT EXISTS supplier_quotes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  purchase_request_id UUID NOT NULL REFERENCES purchase_requests(id) ON DELETE RESTRICT,
  supplier_id UUID NOT NULL REFERENCES suppliers(id) ON DELETE RESTRICT,
  quote_no VARCHAR(40) NOT NULL,
  quote_date DATE NOT NULL DEFAULT CURRENT_DATE,
  valid_until DATE,
  currency_code CHAR(3) NOT NULL DEFAULT 'EGP',
  payment_terms TEXT,
  delivery_terms TEXT,
  notes TEXT,
  status VARCHAR(16) NOT NULL DEFAULT 'SUBMITTED'
    CHECK (status IN ('SUBMITTED','AWARDED','NOT_SELECTED','CANCELLED')),
  submitted_by UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  awarded_by UUID REFERENCES users(id) ON DELETE RESTRICT,
  awarded_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (purchase_request_id, supplier_id),
  UNIQUE (purchase_request_id, quote_no),
  CHECK (valid_until IS NULL OR valid_until >= quote_date),
  CHECK ((status = 'AWARDED') = (awarded_by IS NOT NULL AND awarded_at IS NOT NULL))
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_supplier_quotes_one_award_per_request
  ON supplier_quotes(purchase_request_id) WHERE status = 'AWARDED';
CREATE TABLE IF NOT EXISTS supplier_quote_lines (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  supplier_quote_id UUID NOT NULL REFERENCES supplier_quotes(id) ON DELETE RESTRICT,
  purchase_request_line_id UUID NOT NULL REFERENCES purchase_request_lines(id) ON DELETE RESTRICT,
  item_id UUID NOT NULL REFERENCES items(id) ON DELETE RESTRICT,
  quoted_qty NUMERIC(18,6) NOT NULL CHECK (quoted_qty > 0),
  unit_cost NUMERIC(18,6) NOT NULL CHECK (unit_cost > 0),
  notes TEXT,
  UNIQUE (supplier_quote_id, purchase_request_line_id)
);
INSERT INTO permissions(code,name_ar,module_code) VALUES
 ('PURCHASE_QUOTES.READ','عرض عروض أسعار الموردين والمقارنة','PURCHASES'),
 ('PURCHASE_QUOTES.MANAGE','تسجيل عروض أسعار الموردين','PURCHASES'),
 ('PURCHASE_QUOTES.AWARD','ترسية عروض أسعار الموردين','PURCHASES')
ON CONFLICT(code) DO NOTHING;
