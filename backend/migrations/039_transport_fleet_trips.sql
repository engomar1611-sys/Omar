CREATE TABLE IF NOT EXISTS transport_vehicles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_no VARCHAR(40) NOT NULL UNIQUE,
  plate_no VARCHAR(30) NOT NULL UNIQUE,
  vehicle_type VARCHAR(40) NOT NULL,
  capacity_kg NUMERIC(18,6) NOT NULL CHECK(capacity_kg>0),
  current_odometer NUMERIC(18,2) NOT NULL DEFAULT 0 CHECK(current_odometer>=0),
  insurance_expiry DATE,
  license_expiry DATE,
  maintenance_asset_id UUID,
  status VARCHAR(16) NOT NULL DEFAULT 'ACTIVE' CHECK(status IN ('ACTIVE','IN_SERVICE','RETIRED')),
  notes TEXT,
  created_by UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS transport_drivers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id UUID,
  driver_name VARCHAR(160) NOT NULL,
  phone VARCHAR(40),
  license_no VARCHAR(60) NOT NULL UNIQUE,
  license_expiry DATE NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  notes TEXT,
  created_by UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS transport_trips (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  trip_no VARCHAR(50) NOT NULL UNIQUE,
  vehicle_id UUID NOT NULL REFERENCES transport_vehicles(id) ON DELETE RESTRICT,
  driver_id UUID NOT NULL REFERENCES transport_drivers(id) ON DELETE RESTRICT,
  origin VARCHAR(200) NOT NULL,
  destination VARCHAR(200) NOT NULL,
  planned_departure TIMESTAMPTZ NOT NULL,
  dispatched_at TIMESTAMPTZ,
  arrived_at TIMESTAMPTZ,
  odometer_start NUMERIC(18,2) NOT NULL CHECK(odometer_start>=0),
  odometer_end NUMERIC(18,2) CHECK(odometer_end>=0),
  status VARCHAR(16) NOT NULL DEFAULT 'LOADED'
    CHECK(status IN ('LOADED','DISPATCHED','ARRIVED','COMPLETED','CANCELLED')),
  notes TEXT,
  created_by UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK(odometer_end IS NULL OR odometer_end>=odometer_start)
);
CREATE INDEX IF NOT EXISTS idx_transport_trips_vehicle_status ON transport_trips(vehicle_id,status);
CREATE INDEX IF NOT EXISTS idx_transport_trips_driver_status ON transport_trips(driver_id,status);
CREATE TABLE IF NOT EXISTS transport_trip_deliveries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  trip_id UUID NOT NULL REFERENCES transport_trips(id) ON DELETE RESTRICT,
  sales_delivery_id UUID NOT NULL REFERENCES sales_deliveries(id) ON DELETE RESTRICT,
  load_weight_kg NUMERIC(18,6) NOT NULL CHECK(load_weight_kg>0),
  sequence_no INTEGER NOT NULL DEFAULT 1,
  pod_received_by VARCHAR(160),
  pod_received_at TIMESTAMPTZ,
  pod_notes TEXT,
  pod_signature_ref TEXT,
  pod_photo_ref TEXT,
  active_trip BOOLEAN NOT NULL DEFAULT TRUE,
  UNIQUE(trip_id,sales_delivery_id)
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_transport_active_delivery
  ON transport_trip_deliveries(sales_delivery_id) WHERE active_trip=TRUE;
CREATE TABLE IF NOT EXISTS transport_trip_costs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  trip_id UUID NOT NULL REFERENCES transport_trips(id) ON DELETE RESTRICT,
  cost_type VARCHAR(20) NOT NULL CHECK(cost_type IN ('FUEL','TOLL','LOADING','UNLOADING','MAINTENANCE','OTHER')),
  amount NUMERIC(18,6) NOT NULL CHECK(amount>=0),
  liters NUMERIC(18,6) CHECK(liters IS NULL OR liters>=0),
  reference_no VARCHAR(80),
  description TEXT,
  created_by UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS transport_cost_allocations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  trip_id UUID NOT NULL REFERENCES transport_trips(id) ON DELETE RESTRICT,
  sales_delivery_id UUID NOT NULL REFERENCES sales_deliveries(id) ON DELETE RESTRICT,
  amount NUMERIC(18,6) NOT NULL CHECK(amount>=0),
  allocation_method VARCHAR(20) NOT NULL CHECK(allocation_method IN ('BY_WEIGHT','EQUAL')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(trip_id,sales_delivery_id)
);
ALTER TABLE sales_deliveries ADD COLUMN IF NOT EXISTS transport_cost NUMERIC(18,6) NOT NULL DEFAULT 0 CHECK(transport_cost>=0);

INSERT INTO permissions(code,name_ar,module_code) VALUES
 ('TRANSPORT.VEHICLES.READ','عرض أسطول النقل','TRANSPORT'),
 ('TRANSPORT.VEHICLES.MANAGE','إدارة المركبات','TRANSPORT'),
 ('TRANSPORT.DRIVERS.READ','عرض السائقين','TRANSPORT'),
 ('TRANSPORT.DRIVERS.MANAGE','إدارة السائقين','TRANSPORT'),
 ('TRANSPORT.TRIPS.READ','عرض الرحلات','TRANSPORT'),
 ('TRANSPORT.TRIPS.MANAGE','إنشاء وإدارة الرحلات','TRANSPORT'),
 ('TRANSPORT.TRIPS.DISPATCH','اعتماد تحميل وانطلاق الرحلات','TRANSPORT'),
 ('TRANSPORT.TRIPS.COMPLETE','استلام وإغلاق الرحلات','TRANSPORT'),
 ('TRANSPORT.COSTS.MANAGE','تسجيل وتوزيع تكاليف النقل','TRANSPORT')
ON CONFLICT(code) DO NOTHING;
INSERT INTO role_permissions(role_id,permission_id)
SELECT r.id,p.id FROM roles r CROSS JOIN permissions p
WHERE r.code='SYSTEM_ADMIN'
 AND p.code IN ('TRANSPORT.VEHICLES.READ','TRANSPORT.VEHICLES.MANAGE','TRANSPORT.DRIVERS.READ','TRANSPORT.DRIVERS.MANAGE',
 'TRANSPORT.TRIPS.READ','TRANSPORT.TRIPS.MANAGE','TRANSPORT.TRIPS.DISPATCH','TRANSPORT.TRIPS.COMPLETE','TRANSPORT.COSTS.MANAGE')
ON CONFLICT DO NOTHING;
