CREATE TABLE IF NOT EXISTS finished_goods_inspection_history (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
 production_order_id UUID NOT NULL REFERENCES production_orders(id) ON DELETE RESTRICT,
 attempt_no INTEGER NOT NULL CHECK(attempt_no>0),
 inspected_by UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
 inspected_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 result VARCHAR(12) NOT NULL CHECK(result IN ('PASS','FAIL','CONDITIONAL')),
 parameters JSONB NOT NULL DEFAULT '{}'::jsonb CHECK(jsonb_typeof(parameters)='object'),
 notes TEXT,
 inventory_status VARCHAR(20) NOT NULL CHECK(inventory_status IN ('RELEASED','QUARANTINED','PENDING_QC')),
 UNIQUE(production_order_id,attempt_no)
);
INSERT INTO finished_goods_inspection_history(production_order_id,attempt_no,inspected_by,inspected_at,result,parameters,notes,inventory_status)
SELECT production_order_id,1,inspected_by,inspected_at,result,parameters,notes,CASE result WHEN 'PASS' THEN 'RELEASED' WHEN 'FAIL' THEN 'QUARANTINED' ELSE 'PENDING_QC' END FROM finished_goods_inspections
ON CONFLICT(production_order_id,attempt_no) DO NOTHING;
CREATE INDEX IF NOT EXISTS idx_finished_goods_inspection_history_order ON finished_goods_inspection_history(production_order_id,attempt_no DESC);
