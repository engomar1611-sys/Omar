-- Master data extensions: unit conversions, warehouse locations, and item barcodes.
CREATE TABLE IF NOT EXISTS unit_conversions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  from_unit_id UUID NOT NULL REFERENCES units_of_measure(id) ON DELETE RESTRICT,
  to_unit_id UUID NOT NULL REFERENCES units_of_measure(id) ON DELETE RESTRICT,
  factor NUMERIC(18,8) NOT NULL CHECK (factor > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (from_unit_id <> to_unit_id),
  UNIQUE(from_unit_id, to_unit_id)
);

CREATE TABLE IF NOT EXISTS warehouse_locations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  warehouse_id UUID NOT NULL REFERENCES warehouses(id) ON DELETE RESTRICT,
  code VARCHAR(40) NOT NULL,
  name_ar VARCHAR(120) NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  UNIQUE(warehouse_id, code)
);

CREATE TABLE IF NOT EXISTS item_barcodes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  item_id UUID NOT NULL REFERENCES items(id) ON DELETE RESTRICT,
  barcode VARCHAR(100) NOT NULL UNIQUE,
  unit_id UUID REFERENCES units_of_measure(id) ON DELETE RESTRICT,
  is_primary BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_units_code_lower ON units_of_measure(LOWER(code));
CREATE UNIQUE INDEX IF NOT EXISTS uq_categories_code_lower ON item_categories(LOWER(code));
CREATE UNIQUE INDEX IF NOT EXISTS uq_items_code_lower ON items(LOWER(code));
CREATE UNIQUE INDEX IF NOT EXISTS uq_feed_types_code_lower ON feed_types(LOWER(code));
CREATE UNIQUE INDEX IF NOT EXISTS uq_feed_products_code_lower ON feed_products(LOWER(code));
CREATE INDEX IF NOT EXISTS idx_item_barcodes_item ON item_barcodes(item_id);
CREATE INDEX IF NOT EXISTS idx_warehouse_locations_warehouse ON warehouse_locations(warehouse_id);

INSERT INTO permissions(code, name_ar, module_code) VALUES
  ('UNITS.MANAGE', 'إدارة وحدات القياس', 'MASTER_DATA'),
  ('CATEGORIES.MANAGE', 'إدارة تصنيفات الأصناف', 'MASTER_DATA'),
  ('WAREHOUSE_LOCATIONS.MANAGE', 'إدارة مواقع التخزين', 'MASTER_DATA'),
  ('ITEM_BARCODES.MANAGE', 'إدارة باركود الأصناف', 'MASTER_DATA'),
  ('FEED_TYPES.READ', 'عرض أنواع الأعلاف', 'MASTER_DATA'),
  ('FEED_PRODUCTS.READ', 'عرض منتجات الأعلاف', 'MASTER_DATA')
ON CONFLICT (code) DO NOTHING;
