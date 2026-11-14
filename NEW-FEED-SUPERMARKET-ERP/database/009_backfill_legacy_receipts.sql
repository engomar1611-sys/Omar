-- 009: preserve receipts that were already accepted before the quality gate was introduced.
-- Run once during upgrade, before the new receiving API is opened to users.
UPDATE purchase_receipts
SET inspection_status='accepted'
WHERE inspection_status='pending_inspection'
  AND status='accepted'
  AND received_at < CURRENT_TIMESTAMP;

UPDATE purchase_receipt_lines prl
SET accepted_quantity=prl.quantity,
    rejected_quantity=0
FROM purchase_receipts pr
WHERE pr.id=prl.receipt_id
  AND pr.inspection_status='accepted'
  AND prl.accepted_quantity=0
  AND prl.rejected_quantity=0;

-- Existing stock lots were already saleable before the quarantine workflow.
UPDATE stock_lots sl
SET is_saleable=TRUE
WHERE sl.is_saleable=FALSE
  AND sl.quantity_on_hand>0
  AND EXISTS (
    SELECT 1 FROM purchase_receipt_lines prl
    JOIN purchase_receipts pr ON pr.id=prl.receipt_id
    WHERE prl.stock_lot_id=sl.id
      AND pr.inspection_status='accepted'
  );
