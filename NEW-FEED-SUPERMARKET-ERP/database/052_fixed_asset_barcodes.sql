-- 052: unique internal barcode for fixed assets, including existing records.
CREATE SEQUENCE IF NOT EXISTS fixed_asset_barcode_seq START 1;

ALTER TABLE fixed_assets
  ADD COLUMN IF NOT EXISTS barcode VARCHAR(32);

UPDATE fixed_assets
SET barcode = 'NFA' || lpad(nextval('fixed_asset_barcode_seq')::text, 12, '0')
WHERE barcode IS NULL;

ALTER TABLE fixed_assets
  ALTER COLUMN barcode SET DEFAULT ('NFA' || lpad(nextval('fixed_asset_barcode_seq')::text, 12, '0'));

CREATE UNIQUE INDEX IF NOT EXISTS uq_fixed_assets_barcode
  ON fixed_assets(barcode)
  WHERE barcode IS NOT NULL;
