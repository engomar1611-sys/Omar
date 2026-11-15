-- 018: physical stocktake sessions, lot-level counts and report access.
CREATE TABLE IF NOT EXISTS stocktakes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  reference_no VARCHAR(60) NOT NULL UNIQUE,
  warehouse_id UUID NOT NULL REFERENCES warehouses(id),
  status VARCHAR(20) NOT NULL DEFAULT 'counting'
    CHECK(status IN ('counting','posted','cancelled')),
  notes TEXT,
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  posted_by UUID REFERENCES users(id),
  posted_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS ix_stocktakes_warehouse_date ON stocktakes(warehouse_id,created_at DESC);
CREATE TABLE IF NOT EXISTS stocktake_lines (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  stocktake_id UUID NOT NULL REFERENCES stocktakes(id) ON DELETE CASCADE,
  product_id UUID NOT NULL REFERENCES products(id),
  stock_lot_id UUID REFERENCES stock_lots(id),
  expected_quantity NUMERIC(20,6) NOT NULL DEFAULT 0 CHECK(expected_quantity >= 0),
  counted_quantity NUMERIC(20,6) CHECK(counted_quantity IS NULL OR counted_quantity >= 0),
  lot_number VARCHAR(100),
  expiry_date DATE,
  posted_variance NUMERIC(20,6),
  UNIQUE(stocktake_id,product_id,stock_lot_id)
);
CREATE INDEX IF NOT EXISTS ix_stocktake_lines_session ON stocktake_lines(stocktake_id,product_id);
INSERT INTO permissions(code,description)
VALUES ('reports.view','عرض تقارير المبيعات والمخزون والمشتريات والحسابات والتشغيل')
ON CONFLICT(code) DO NOTHING;
INSERT INTO role_permissions(role_id,permission_id)
SELECT r.id,p.id FROM roles r CROSS JOIN permissions p
WHERE r.code IN ('SUPER_ADMIN','BRANCH_MANAGER','ACCOUNTANT','STOCK_KEEPER','PURCHASING')
  AND p.code='reports.view'
ON CONFLICT DO NOTHING;
INSERT INTO role_permissions(role_id,permission_id)
SELECT r.id,p.id FROM roles r CROSS JOIN permissions p
WHERE r.code IN ('STOCK_KEEPER','BRANCH_MANAGER') AND p.code='inventory.manage'
ON CONFLICT DO NOTHING;
