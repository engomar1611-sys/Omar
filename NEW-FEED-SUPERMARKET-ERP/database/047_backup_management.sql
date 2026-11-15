-- 047: backup inventory and permission for controlled database backup operations.
INSERT INTO permissions(code,description)
VALUES ('backup.manage','إنشاء النسخ الاحتياطية وإدارة الاستعادة')
ON CONFLICT(code) DO NOTHING;

INSERT INTO role_permissions(role_id,permission_id)
SELECT r.id,p.id FROM roles r CROSS JOIN permissions p
WHERE r.code='SUPER_ADMIN' AND p.code='backup.manage'
ON CONFLICT DO NOTHING;

CREATE TABLE IF NOT EXISTS system_backups (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  file_name VARCHAR(180) NOT NULL UNIQUE,
  sha256 CHAR(64) NOT NULL,
  size_bytes BIGINT NOT NULL CHECK(size_bytes > 0),
  status VARCHAR(16) NOT NULL DEFAULT 'completed' CHECK(status IN ('completed','failed')),
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_system_backups_created
  ON system_backups(created_at DESC);
