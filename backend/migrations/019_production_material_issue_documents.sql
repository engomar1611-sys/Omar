-- Separate, auditable raw-material issue document for each production order.
CREATE TABLE IF NOT EXISTS production_material_issues (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  issue_no VARCHAR(40) NOT NULL UNIQUE,
  production_order_id UUID NOT NULL UNIQUE REFERENCES production_orders(id) ON DELETE RESTRICT,
  issue_qty NUMERIC(18,6) NOT NULL CHECK(issue_qty > 0),
  total_cost NUMERIC(18,6) NOT NULL DEFAULT 0 CHECK(total_cost >= 0),
  status VARCHAR(16) NOT NULL DEFAULT 'POSTED' CHECK(status IN ('POSTED')),
  issued_by UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  issued_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_production_material_issues_issued_at ON production_material_issues(issued_at DESC);
INSERT INTO permissions(code,name_ar,module_code,description) VALUES('PRODUCTION.MATERIALS.ISSUE','صرف خامات أوامر الإنتاج','PRODUCTION','إنشاء إذن صرف خامات مستقل مرتبط بأمر الإنتاج')
ON CONFLICT(code) DO UPDATE SET name_ar=EXCLUDED.name_ar,module_code=EXCLUDED.module_code,description=EXCLUDED.description;
INSERT INTO role_permissions(role_id,permission_id) SELECT r.id,p.id FROM roles r JOIN permissions p ON p.code='PRODUCTION.MATERIALS.ISSUE' WHERE r.code='SYSTEM_ADMIN' ON CONFLICT(role_id,permission_id) DO NOTHING;
