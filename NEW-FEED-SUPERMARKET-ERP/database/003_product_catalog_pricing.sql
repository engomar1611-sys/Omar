-- Product master data, brands, sourced prices and internal SKU numbering.
CREATE SEQUENCE IF NOT EXISTS product_sku_seq START 1;

CREATE TABLE IF NOT EXISTS brands (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code VARCHAR(40) NOT NULL UNIQUE,
  name_ar VARCHAR(160) NOT NULL,
  name_en VARCHAR(160),
  manufacturer VARCHAR(200),
  country_of_origin VARCHAR(100),
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE products ADD COLUMN IF NOT EXISTS brand_id UUID REFERENCES brands(id);
ALTER TABLE products ADD COLUMN IF NOT EXISTS pack_size NUMERIC(20,6);
ALTER TABLE products ADD COLUMN IF NOT EXISTS pack_unit_id UUID REFERENCES units(id);
ALTER TABLE products ADD COLUMN IF NOT EXISTS variant_description VARCHAR(200);
ALTER TABLE products ADD COLUMN IF NOT EXISTS is_marketplace_listed BOOLEAN NOT NULL DEFAULT FALSE;

CREATE TABLE IF NOT EXISTS price_sources (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(200) NOT NULL,
  source_type VARCHAR(30) NOT NULL CHECK(source_type IN ('supplier_quote','retail_observation','official_feed','manual')),
  source_url TEXT,
  region VARCHAR(120),
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS product_prices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id UUID NOT NULL REFERENCES products(id),
  price_type VARCHAR(20) NOT NULL CHECK(price_type IN ('purchase','retail','wholesale','promotion')),
  amount NUMERIC(20,6) NOT NULL CHECK(amount >= 0),
  currency CHAR(3) NOT NULL DEFAULT 'EGP',
  source_id UUID REFERENCES price_sources(id),
  observed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  valid_from TIMESTAMPTZ NOT NULL DEFAULT now(),
  valid_to TIMESTAMPTZ,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK(valid_to IS NULL OR valid_to > valid_from)
);
CREATE INDEX IF NOT EXISTS idx_product_prices_latest
  ON product_prices(product_id,price_type,observed_at DESC);

CREATE TABLE IF NOT EXISTS product_import_batches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_name VARCHAR(200) NOT NULL,
  source_url TEXT,
  imported_by UUID REFERENCES users(id),
  imported_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  row_count INTEGER NOT NULL DEFAULT 0,
  accepted_count INTEGER NOT NULL DEFAULT 0,
  rejected_count INTEGER NOT NULL DEFAULT 0,
  status VARCHAR(20) NOT NULL DEFAULT 'review'
    CHECK(status IN ('review','approved','rejected'))
);

CREATE TABLE IF NOT EXISTS product_import_rows (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id UUID NOT NULL REFERENCES product_import_batches(id),
  row_number INTEGER NOT NULL,
  raw_data JSONB NOT NULL,
  validation_errors JSONB NOT NULL DEFAULT '[]'::jsonb,
  product_id UUID REFERENCES products(id),
  status VARCHAR(20) NOT NULL DEFAULT 'pending'
    CHECK(status IN ('pending','accepted','rejected')),
  UNIQUE(batch_id,row_number)
);
