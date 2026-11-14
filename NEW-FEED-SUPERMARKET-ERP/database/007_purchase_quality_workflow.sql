-- 007: quarantine received goods until warehouse quality inspection is approved.
ALTER TABLE stock_lots
  ADD COLUMN IF NOT EXISTS is_saleable BOOLEAN NOT NULL DEFAULT TRUE;
ALTER TABLE purchase_receipts
  ADD COLUMN IF NOT EXISTS inspection_status VARCHAR(24) NOT NULL DEFAULT 'pending_inspection'
  CHECK (inspection_status IN ('pending_inspection','accepted','rejected'));
ALTER TABLE purchase_receipt_lines
  ADD COLUMN IF NOT EXISTS accepted_quantity NUMERIC(20,6) NOT NULL DEFAULT 0 CHECK (accepted_quantity >= 0);
ALTER TABLE purchase_receipt_lines
  ADD COLUMN IF NOT EXISTS rejected_quantity NUMERIC(20,6) NOT NULL DEFAULT 0 CHECK (rejected_quantity >= 0);
CREATE INDEX IF NOT EXISTS ix_stock_lots_saleable_fefo
  ON stock_lots(product_id, warehouse_id, expiry_date, received_at)
  WHERE is_saleable = TRUE AND quantity_on_hand > 0;
