-- Cost centers, cost-center tagging on journal lines/expenses, and permissions.
CREATE TABLE IF NOT EXISTS cost_centers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code VARCHAR(30) NOT NULL UNIQUE CHECK (code ~ '^[A-Z0-9][A-Z0-9._-]*$'),
  name_ar VARCHAR(160) NOT NULL,
  parent_id UUID REFERENCES cost_centers(id) ON DELETE RESTRICT,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_by UUID REFERENCES users(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (parent_id IS NULL OR parent_id <> id)
);

ALTER TABLE journal_lines ADD COLUMN IF NOT EXISTS cost_center_id UUID REFERENCES cost_centers(id) ON DELETE RESTRICT;
ALTER TABLE expenses ADD COLUMN IF NOT EXISTS cost_center_id UUID REFERENCES cost_centers(id) ON DELETE RESTRICT;
CREATE INDEX IF NOT EXISTS idx_journal_lines_cost_center ON journal_lines(cost_center_id) WHERE cost_center_id IS NOT NULL;

INSERT INTO cost_centers(code, name_ar) VALUES
  ('PROD', 'الإنتاج'),
  ('WH', 'المخازن'),
  ('QC', 'الجودة'),
  ('MAINT', 'الصيانة'),
  ('SALES', 'المبيعات والتوزيع'),
  ('ADMIN', 'الإدارة والحسابات')
ON CONFLICT (code) DO NOTHING;

INSERT INTO permissions(code, name_ar, module_code, description) VALUES
  ('COST_CENTERS.MANAGE', 'إدارة مراكز التكلفة', 'ACCOUNTING', 'إنشاء وتعديل وتعطيل مراكز التكلفة')
ON CONFLICT (code) DO NOTHING;

INSERT INTO role_permissions(role_id, permission_id)
SELECT r.id, p.id FROM roles r JOIN permissions p ON p.code = 'COST_CENTERS.MANAGE'
 WHERE r.code = 'SYSTEM_ADMIN'
ON CONFLICT (role_id, permission_id) DO NOTHING;
