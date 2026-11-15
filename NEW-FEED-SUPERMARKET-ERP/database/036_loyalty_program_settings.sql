-- 036: explicit configurable loyalty earning policy; disabled by default.
CREATE TABLE IF NOT EXISTS loyalty_program_settings (
  id SMALLINT PRIMARY KEY CHECK (id=1),
  points_per_egp NUMERIC(12,6) NOT NULL DEFAULT 0 CHECK(points_per_egp>=0 AND points_per_egp<=100),
  is_active BOOLEAN NOT NULL DEFAULT FALSE,
  updated_by UUID REFERENCES users(id),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
