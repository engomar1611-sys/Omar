-- Authentication sessions, login throttling, and role-based permissions.
CREATE UNIQUE INDEX IF NOT EXISTS uq_users_username_lower
  ON users (LOWER(username));

CREATE TABLE IF NOT EXISTS permissions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code VARCHAR(80) NOT NULL UNIQUE,
  name_ar VARCHAR(160) NOT NULL,
  module_code VARCHAR(50) NOT NULL,
  description TEXT,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS role_permissions (
  role_id UUID NOT NULL REFERENCES roles(id) ON DELETE RESTRICT,
  permission_id UUID NOT NULL REFERENCES permissions(id) ON DELETE RESTRICT,
  granted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (role_id, permission_id)
);

CREATE TABLE IF NOT EXISTS auth_sessions (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  expires_at TIMESTAMPTZ NOT NULL,
  revoked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (revoked_at IS NULL OR revoked_at >= created_at)
);

CREATE TABLE IF NOT EXISTS auth_login_attempts (
  username VARCHAR(80) NOT NULL,
  ip_address VARCHAR(64) NOT NULL,
  failed_attempts INTEGER NOT NULL DEFAULT 0 CHECK (failed_attempts >= 0),
  locked_until TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (username, ip_address)
);

CREATE INDEX IF NOT EXISTS idx_auth_sessions_user_expiry
  ON auth_sessions(user_id, expires_at DESC);

CREATE INDEX IF NOT EXISTS idx_auth_login_attempts_lock
  ON auth_login_attempts(locked_until)
  WHERE locked_until IS NOT NULL;

INSERT INTO permissions(code, name_ar, module_code) VALUES
  ('SYSTEM.ADMIN', 'إدارة النظام بالكامل', 'SYSTEM'),
  ('USERS.READ', 'عرض المستخدمين', 'USERS'),
  ('USERS.MANAGE', 'إدارة المستخدمين', 'USERS'),
  ('ROLES.MANAGE', 'إدارة الأدوار والصلاحيات', 'USERS'),
  ('ITEMS.READ', 'عرض الأصناف', 'MASTER_DATA'),
  ('ITEMS.MANAGE', 'إدارة الأصناف', 'MASTER_DATA'),
  ('WAREHOUSES.READ', 'عرض المخازن', 'MASTER_DATA'),
  ('WAREHOUSES.MANAGE', 'إدارة المخازن', 'MASTER_DATA'),
  ('FEED_TYPES.MANAGE', 'إدارة أنواع الأعلاف', 'MASTER_DATA'),
  ('FEED_PRODUCTS.MANAGE', 'إدارة منتجات الأعلاف', 'MASTER_DATA'),
  ('FORMULATIONS.READ', 'عرض التركيبات', 'FORMULATIONS'),
  ('FORMULATIONS.MANAGE', 'إدارة التركيبات', 'FORMULATIONS'),
  ('FORMULATIONS.APPROVE', 'اعتماد التركيبات', 'FORMULATIONS'),
  ('INVENTORY.READ', 'عرض المخزون', 'INVENTORY'),
  ('INVENTORY.MANAGE', 'إدارة حركات المخزون', 'INVENTORY'),
  ('PURCHASES.READ', 'عرض المشتريات', 'PURCHASES'),
  ('PURCHASES.MANAGE', 'إدارة المشتريات', 'PURCHASES'),
  ('PRODUCTION.READ', 'عرض الإنتاج', 'PRODUCTION'),
  ('PRODUCTION.MANAGE', 'إدارة أوامر الإنتاج', 'PRODUCTION'),
  ('QUALITY.READ', 'عرض الجودة', 'QUALITY'),
  ('QUALITY.MANAGE', 'إدارة فحوص الجودة', 'QUALITY'),
  ('SALES.READ', 'عرض المبيعات', 'SALES'),
  ('SALES.MANAGE', 'إدارة المبيعات', 'SALES'),
  ('ACCOUNTING.READ', 'عرض الحسابات', 'ACCOUNTING'),
  ('ACCOUNTING.POST', 'ترحيل القيود المحاسبية', 'ACCOUNTING'),
  ('REPORTS.READ', 'عرض التقارير', 'REPORTS'),
  ('SETTINGS.MANAGE', 'إدارة إعدادات النظام', 'SETTINGS')
ON CONFLICT (code) DO NOTHING;
