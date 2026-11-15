-- Generalize quality holds so positive manual adjustments and stocktake gains
-- can be isolated by source document/line, not only by sales return.
ALTER TABLE inventory_quality_holds
  ALTER COLUMN sales_return_id DROP NOT NULL,
  ALTER COLUMN sales_return_line_id DROP NOT NULL;

ALTER TABLE inventory_quality_holds
  ADD COLUMN IF NOT EXISTS source_type VARCHAR(32) NOT NULL DEFAULT 'SALES_RETURN',
  ADD COLUMN IF NOT EXISTS source_id UUID,
  ADD COLUMN IF NOT EXISTS source_line_id UUID;

UPDATE inventory_quality_holds
SET source_id=sales_return_id,
    source_line_id=sales_return_line_id
WHERE source_id IS NULL OR source_line_id IS NULL;

ALTER TABLE inventory_quality_holds
  ADD CONSTRAINT inventory_quality_holds_source_consistency CHECK (
    (source_type='SALES_RETURN'
      AND sales_return_id IS NOT NULL AND sales_return_line_id IS NOT NULL
      AND source_id=sales_return_id AND source_line_id=sales_return_line_id)
    OR
    (source_type IN ('INVENTORY_ADJUSTMENT','INVENTORY_COUNT')
      AND sales_return_id IS NULL AND sales_return_line_id IS NULL
      AND source_id IS NOT NULL AND source_line_id IS NOT NULL)
  );

CREATE UNIQUE INDEX IF NOT EXISTS uq_inventory_quality_holds_source_line
  ON inventory_quality_holds(source_type,source_line_id)
  WHERE source_line_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS inventory_quality_inspections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  quality_hold_id UUID NOT NULL REFERENCES inventory_quality_holds(id) ON DELETE RESTRICT,
  attempt_no INTEGER NOT NULL CHECK (attempt_no > 0),
  result VARCHAR(8) NOT NULL CHECK (result IN ('PASS','FAIL')),
  parameters JSONB NOT NULL DEFAULT '{}'::jsonb,
  notes TEXT,
  inventory_status VARCHAR(16) NOT NULL CHECK (inventory_status IN ('RELEASED','QUARANTINED')),
  inspected_by UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  inspected_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (quality_hold_id,attempt_no)
);

CREATE INDEX IF NOT EXISTS idx_inventory_quality_inspections_hold
  ON inventory_quality_inspections(quality_hold_id,attempt_no DESC);

INSERT INTO permissions(code,name_ar,module_code,description) VALUES
 ('QUALITY.INVENTORY_HOLD_INSPECT','فحص كميات التسويات والجرد المحجوزة','QUALITY',
  'فحص والإفراج أو الحجر للكميات المضافة بتسويات المخزون أو فروق الجرد')
ON CONFLICT(code) DO UPDATE SET name_ar=EXCLUDED.name_ar,module_code=EXCLUDED.module_code,description=EXCLUDED.description;

INSERT INTO role_permissions(role_id,permission_id)
SELECT r.id,p.id FROM roles r JOIN permissions p ON p.code='QUALITY.INVENTORY_HOLD_INSPECT'
WHERE r.code='SYSTEM_ADMIN'
ON CONFLICT(role_id,permission_id) DO NOTHING;
