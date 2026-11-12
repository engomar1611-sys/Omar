-- Production work centers and capacity-aware scheduling.
CREATE TABLE IF NOT EXISTS production_work_centers (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
 code VARCHAR(30) NOT NULL UNIQUE,
 name_ar VARCHAR(120) NOT NULL,
 plant_id UUID REFERENCES plants(id) ON DELETE RESTRICT,
 capacity_kg_per_hour NUMERIC(18,6) NOT NULL CHECK(capacity_kg_per_hour>0),
 is_active BOOLEAN NOT NULL DEFAULT TRUE,
 created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS production_schedule_entries (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
 schedule_no VARCHAR(40) NOT NULL UNIQUE,
 production_order_id UUID NOT NULL REFERENCES production_orders(id) ON DELETE RESTRICT,
 work_center_id UUID NOT NULL REFERENCES production_work_centers(id) ON DELETE RESTRICT,
 start_at TIMESTAMPTZ NOT NULL,
 end_at TIMESTAMPTZ NOT NULL,
 planned_qty NUMERIC(18,6) NOT NULL CHECK(planned_qty>0),
 status VARCHAR(16) NOT NULL DEFAULT 'PLANNED'
   CHECK(status IN ('PLANNED','CONFIRMED','IN_PROGRESS','COMPLETED','CANCELLED')),
 notes TEXT,
 created_by UUID REFERENCES users(id) ON DELETE RESTRICT,
 confirmed_by UUID REFERENCES users(id) ON DELETE RESTRICT,
 confirmed_at TIMESTAMPTZ,
 started_at TIMESTAMPTZ,
 completed_at TIMESTAMPTZ,
 created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 CHECK(end_at>start_at),
 CHECK((status NOT IN ('CONFIRMED','IN_PROGRESS','COMPLETED')) OR confirmed_at IS NOT NULL),
 CHECK((status NOT IN ('IN_PROGRESS','COMPLETED')) OR started_at IS NOT NULL),
 CHECK((status<>'COMPLETED') OR completed_at IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS idx_prod_schedule_center_time
 ON production_schedule_entries(work_center_id,start_at,end_at)
 WHERE status IN ('PLANNED','CONFIRMED','IN_PROGRESS');
CREATE INDEX IF NOT EXISTS idx_prod_schedule_order
 ON production_schedule_entries(production_order_id,status);
INSERT INTO permissions(code,name_ar,module_code,description) VALUES
 ('PRODUCTION.SCHEDULE.MANAGE','إدارة تخطيط وجدولة الإنتاج','PRODUCTION','إضافة وتأكيد وتحديث جداول تشغيل مراكز الإنتاج')
ON CONFLICT(code) DO UPDATE SET name_ar=EXCLUDED.name_ar,module_code=EXCLUDED.module_code,description=EXCLUDED.description;
INSERT INTO role_permissions(role_id,permission_id)
 SELECT r.id,p.id FROM roles r JOIN permissions p ON p.code='PRODUCTION.SCHEDULE.MANAGE'
 WHERE r.code='SYSTEM_ADMIN' ON CONFLICT(role_id,permission_id) DO NOTHING;
