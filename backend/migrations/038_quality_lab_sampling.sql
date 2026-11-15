CREATE TABLE IF NOT EXISTS quality_specifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  item_id UUID NOT NULL REFERENCES items(id) ON DELETE RESTRICT,
  stage VARCHAR(20) NOT NULL CHECK(stage IN ('RAW_MATERIAL','IN_PROCESS','FINISHED_GOOD')),
  version_no INTEGER NOT NULL CHECK(version_no>0),
  sample_quantity NUMERIC(18,6) NOT NULL DEFAULT 0.5 CHECK(sample_quantity>0),
  frequency_kg NUMERIC(18,6) NOT NULL DEFAULT 0 CHECK(frequency_kg>=0),
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  approved_by UUID REFERENCES users(id) ON DELETE RESTRICT,
  approved_at TIMESTAMPTZ,
  created_by UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(item_id,stage,version_no),
  CHECK((is_active=FALSE) OR (approved_by IS NOT NULL AND approved_at IS NOT NULL))
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_quality_active_specification
  ON quality_specifications(item_id,stage) WHERE is_active=TRUE;
CREATE TABLE IF NOT EXISTS quality_specification_parameters (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  specification_id UUID NOT NULL REFERENCES quality_specifications(id) ON DELETE RESTRICT,
  parameter_code VARCHAR(40) NOT NULL,
  name_ar VARCHAR(160) NOT NULL,
  unit VARCHAR(30) NOT NULL DEFAULT '',
  minimum_value NUMERIC(18,6),
  maximum_value NUMERIC(18,6),
  target_value NUMERIC(18,6),
  required BOOLEAN NOT NULL DEFAULT TRUE,
  test_method VARCHAR(200),
  UNIQUE(specification_id,parameter_code),
  CHECK(minimum_value IS NULL OR maximum_value IS NULL OR minimum_value<=maximum_value),
  CHECK(target_value IS NULL OR minimum_value IS NULL OR target_value>=minimum_value),
  CHECK(target_value IS NULL OR maximum_value IS NULL OR target_value<=maximum_value)
);
CREATE TABLE IF NOT EXISTS quality_samples (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sample_no VARCHAR(50) NOT NULL UNIQUE,
  specification_id UUID NOT NULL REFERENCES quality_specifications(id) ON DELETE RESTRICT,
  source_type VARCHAR(24) NOT NULL CHECK(source_type IN ('GOODS_RECEIPT','PRODUCTION_ORDER')),
  source_id UUID NOT NULL,
  source_line_id UUID NOT NULL,
  item_id UUID NOT NULL REFERENCES items(id) ON DELETE RESTRICT,
  warehouse_id UUID NOT NULL REFERENCES warehouses(id) ON DELETE RESTRICT,
  lot_no VARCHAR(80) NOT NULL DEFAULT '',
  stage VARCHAR(20) NOT NULL CHECK(stage IN ('RAW_MATERIAL','IN_PROCESS','FINISHED_GOOD')),
  sample_quantity NUMERIC(18,6) NOT NULL CHECK(sample_quantity>0),
  status VARCHAR(16) NOT NULL DEFAULT 'COLLECTED'
    CHECK(status IN ('COLLECTED','IN_TEST','PASSED','FAILED','CANCELLED')),
  collected_by UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  collected_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  tested_by UUID REFERENCES users(id) ON DELETE RESTRICT,
  tested_at TIMESTAMPTZ,
  notes TEXT,
  CHECK((status IN ('PASSED','FAILED'))=(tested_by IS NOT NULL AND tested_at IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS idx_quality_samples_source
  ON quality_samples(source_type,source_id,source_line_id,stage,status);
CREATE INDEX IF NOT EXISTS idx_quality_samples_lot
  ON quality_samples(item_id,lot_no,stage,collected_at DESC);
CREATE TABLE IF NOT EXISTS quality_sample_results (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sample_id UUID NOT NULL REFERENCES quality_samples(id) ON DELETE RESTRICT,
  parameter_id UUID NOT NULL REFERENCES quality_specification_parameters(id) ON DELETE RESTRICT,
  numeric_value NUMERIC(18,6),
  text_value TEXT,
  unit VARCHAR(30) NOT NULL DEFAULT '',
  result VARCHAR(8) NOT NULL CHECK(result IN ('PASS','FAIL')),
  tested_by UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  tested_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  notes TEXT,
  UNIQUE(sample_id,parameter_id),
  CHECK(numeric_value IS NOT NULL OR text_value IS NOT NULL)
);
CREATE TABLE IF NOT EXISTS quality_certificates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  certificate_no VARCHAR(50) NOT NULL UNIQUE,
  sample_id UUID NOT NULL UNIQUE REFERENCES quality_samples(id) ON DELETE RESTRICT,
  item_id UUID NOT NULL REFERENCES items(id) ON DELETE RESTRICT,
  lot_no VARCHAR(80) NOT NULL DEFAULT '',
  issued_by UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  issued_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  certificate_data JSONB NOT NULL DEFAULT '{}'::jsonb,
  status VARCHAR(12) NOT NULL DEFAULT 'ISSUED' CHECK(status IN ('ISSUED','REVOKED'))
);
CREATE INDEX IF NOT EXISTS idx_quality_certificates_lot ON quality_certificates(item_id,lot_no,status);

INSERT INTO permissions(code,name_ar,module_code) VALUES
 ('QUALITY.SPECS.MANAGE','إدارة مواصفات الجودة وحدود الاختبار','QUALITY'),
 ('QUALITY.SAMPLES.READ','عرض العينات ونتائج المعمل','QUALITY'),
 ('QUALITY.SAMPLES.MANAGE','تسجيل وسحب عينات الجودة','QUALITY'),
 ('QUALITY.SAMPLES.TEST','إدخال نتائج اختبارات المعمل واعتمادها','QUALITY'),
 ('QUALITY.COA.READ','عرض شهادات تحليل المنتج','QUALITY')
ON CONFLICT(code) DO NOTHING;
INSERT INTO role_permissions(role_id,permission_id)
SELECT r.id,p.id FROM roles r CROSS JOIN permissions p
WHERE r.code='SYSTEM_ADMIN'
 AND p.code IN ('QUALITY.SPECS.MANAGE','QUALITY.SAMPLES.READ','QUALITY.SAMPLES.MANAGE','QUALITY.SAMPLES.TEST','QUALITY.COA.READ')
ON CONFLICT DO NOTHING;
