-- Track returned quantities independently from the aggregate lot balance.
-- A lot can contain released stock and one or more uninspected customer returns.
CREATE TABLE IF NOT EXISTS inventory_quality_holds (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  warehouse_id UUID NOT NULL REFERENCES warehouses(id) ON DELETE RESTRICT,
  item_id UUID NOT NULL REFERENCES items(id) ON DELETE RESTRICT,
  lot_no VARCHAR(80) NOT NULL DEFAULT '',
  sales_return_id UUID NOT NULL REFERENCES sales_returns(id) ON DELETE RESTRICT,
  sales_return_line_id UUID NOT NULL UNIQUE REFERENCES sales_return_lines(id) ON DELETE RESTRICT,
  held_qty NUMERIC(18,6) NOT NULL CHECK (held_qty > 0),
  status VARCHAR(16) NOT NULL DEFAULT 'PENDING_QC'
    CHECK (status IN ('PENDING_QC','RELEASED','QUARANTINED')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  inspected_by UUID REFERENCES users(id) ON DELETE RESTRICT,
  inspected_at TIMESTAMPTZ,
  CHECK ((status = 'PENDING_QC' AND inspected_at IS NULL) OR status <> 'PENDING_QC')
);
CREATE INDEX IF NOT EXISTS idx_inventory_quality_holds_available
  ON inventory_quality_holds(warehouse_id,item_id,lot_no,status);

-- Conservatively quarantine historical approved returns because the previous
-- implementation did not persist per-return inspection history.
INSERT INTO inventory_quality_holds
  (warehouse_id,item_id,lot_no,sales_return_id,sales_return_line_id,held_qty,status)
SELECT r.warehouse_id,l.item_id,l.lot_no,r.id,l.id,l.quantity,'PENDING_QC'
FROM sales_returns r
JOIN sales_return_lines l ON l.sales_return_id=r.id
WHERE r.status='APPROVED'
ON CONFLICT (sales_return_line_id) DO NOTHING;

-- Sales invoices can only consume RELEASED lots. Restore the original lot-level
-- quality gate for lots whose status was changed by the old per-return inspector;
-- the returned quantities themselves remain held in inventory_quality_holds.
UPDATE inventory_balances b
SET quality_status='RELEASED',updated_at=NOW()
WHERE b.quality_status IN ('PENDING_QC','QUARANTINED')
  AND EXISTS (
    SELECT 1
    FROM sales_returns r
    JOIN sales_return_lines l ON l.sales_return_id=r.id
    WHERE r.status='APPROVED'
      AND r.warehouse_id=b.warehouse_id
      AND l.item_id=b.item_id
      AND l.lot_no=b.lot_no
  );
