CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS companies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code VARCHAR(30) NOT NULL UNIQUE,
  name_ar VARCHAR(200) NOT NULL,
  name_en VARCHAR(200),
  base_currency CHAR(3) NOT NULL DEFAULT 'EGP',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS plants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id),
  code VARCHAR(30) NOT NULL,
  name_ar VARCHAR(200) NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  UNIQUE(company_id, code)
);

CREATE TABLE IF NOT EXISTS warehouses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  plant_id UUID NOT NULL REFERENCES plants(id),
  code VARCHAR(30) NOT NULL,
  name_ar VARCHAR(200) NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  UNIQUE(plant_id, code)
);

CREATE TABLE IF NOT EXISTS units_of_measure (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code VARCHAR(20) NOT NULL UNIQUE,
  name_ar VARCHAR(80) NOT NULL,
  decimal_places SMALLINT NOT NULL DEFAULT 3 CHECK (decimal_places BETWEEN 0 AND 6)
);

CREATE TABLE IF NOT EXISTS item_categories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code VARCHAR(30) NOT NULL UNIQUE,
  name_ar VARCHAR(120) NOT NULL,
  category_kind VARCHAR(30) NOT NULL CHECK (category_kind IN ('RAW_MATERIAL','PACKAGING','FINISHED_GOOD','SPARE_PART','OTHER')),
  is_active BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE TABLE IF NOT EXISTS items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code VARCHAR(50) NOT NULL UNIQUE,
  name_ar VARCHAR(200) NOT NULL,
  category_id UUID NOT NULL REFERENCES item_categories(id),
  base_unit_id UUID NOT NULL REFERENCES units_of_measure(id),
  tracks_lot BOOLEAN NOT NULL DEFAULT TRUE,
  tracks_expiry BOOLEAN NOT NULL DEFAULT FALSE,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Feed types are master data, not a hard-coded enum: poultry, livestock, fish, etc.
CREATE TABLE IF NOT EXISTS feed_types (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code VARCHAR(40) NOT NULL UNIQUE,
  name_ar VARCHAR(120) NOT NULL,
  name_en VARCHAR(120),
  description TEXT,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS feed_products (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code VARCHAR(50) NOT NULL UNIQUE,
  name_ar VARCHAR(200) NOT NULL,
  feed_type_id UUID NOT NULL REFERENCES feed_types(id),
  item_id UUID NOT NULL UNIQUE REFERENCES items(id),
  target_species VARCHAR(100),
  product_stage VARCHAR(100),
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS formulations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  feed_product_id UUID NOT NULL REFERENCES feed_products(id),
  version_no INTEGER NOT NULL CHECK (version_no > 0),
  status VARCHAR(20) NOT NULL DEFAULT 'DRAFT'
    CHECK (status IN ('DRAFT','IN_REVIEW','APPROVED','RETIRED')),
  effective_from DATE,
  effective_to DATE,
  notes TEXT,
  approved_by UUID,
  approved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(feed_product_id, version_no),
  CHECK (effective_to IS NULL OR effective_from IS NULL OR effective_to >= effective_from),
  CHECK ((status <> 'APPROVED') OR (approved_by IS NOT NULL AND approved_at IS NOT NULL))
);

CREATE TABLE IF NOT EXISTS formulation_lines (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  formulation_id UUID NOT NULL REFERENCES formulations(id) ON DELETE RESTRICT,
  item_id UUID NOT NULL REFERENCES items(id),
  percentage NUMERIC(9,6) NOT NULL CHECK (percentage > 0 AND percentage <= 100),
  sequence_no INTEGER NOT NULL,
  UNIQUE(formulation_id, item_id),
  UNIQUE(formulation_id, sequence_no)
);

CREATE TABLE IF NOT EXISTS roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code VARCHAR(40) NOT NULL UNIQUE,
  name_ar VARCHAR(100) NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  username VARCHAR(80) NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  display_name VARCHAR(160) NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS user_roles (
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  role_id UUID NOT NULL REFERENCES roles(id) ON DELETE RESTRICT,
  PRIMARY KEY(user_id, role_id)
);

CREATE TABLE IF NOT EXISTS audit_logs (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  actor_user_id UUID REFERENCES users(id),
  action VARCHAR(80) NOT NULL,
  entity_type VARCHAR(80) NOT NULL,
  entity_id UUID,
  details JSONB NOT NULL DEFAULT '{}'::jsonb,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_items_category ON items(category_id);
CREATE INDEX IF NOT EXISTS idx_feed_products_type ON feed_products(feed_type_id);
CREATE INDEX IF NOT EXISTS idx_formulations_product_status ON formulations(feed_product_id, status);
CREATE INDEX IF NOT EXISTS idx_audit_logs_entity ON audit_logs(entity_type, entity_id, occurred_at DESC);

-- A formulation may not exceed 100%; exact 100% is enforced at approval in the service layer.
CREATE OR REPLACE FUNCTION prevent_approved_formulation_line_changes()
RETURNS TRIGGER AS $$
DECLARE
  target_id UUID;
  current_status VARCHAR(20);
BEGIN
  target_id := COALESCE(NEW.formulation_id, OLD.formulation_id);
  SELECT status INTO current_status FROM formulations WHERE id = target_id;
  IF current_status = 'APPROVED' THEN
    RAISE EXCEPTION 'Approved formulation lines are immutable; create a new version';
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_approved_formulation_lines_immutable ON formulation_lines;
CREATE TRIGGER trg_approved_formulation_lines_immutable
BEFORE INSERT OR UPDATE OR DELETE ON formulation_lines
FOR EACH ROW EXECUTE FUNCTION prevent_approved_formulation_line_changes();
