-- Human resources, maintenance and administrative configuration foundation.
CREATE TABLE IF NOT EXISTS departments (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(), code VARCHAR(30) NOT NULL UNIQUE,
 name_ar VARCHAR(120) NOT NULL, manager_employee_id UUID, is_active BOOLEAN NOT NULL DEFAULT TRUE
);
CREATE TABLE IF NOT EXISTS job_titles (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(), code VARCHAR(30) NOT NULL UNIQUE,
 name_ar VARCHAR(120) NOT NULL, department_id UUID REFERENCES departments(id) ON DELETE RESTRICT,
 is_active BOOLEAN NOT NULL DEFAULT TRUE
);
CREATE TABLE IF NOT EXISTS employees (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(), employee_no VARCHAR(40) NOT NULL UNIQUE,
 full_name_ar VARCHAR(200) NOT NULL, national_id VARCHAR(30), phone VARCHAR(40), email VARCHAR(160),
 department_id UUID REFERENCES departments(id) ON DELETE RESTRICT,
 job_title_id UUID REFERENCES job_titles(id) ON DELETE RESTRICT,
 manager_id UUID REFERENCES employees(id) ON DELETE RESTRICT,
 hire_date DATE NOT NULL, employment_type VARCHAR(20) NOT NULL DEFAULT 'FULL_TIME'
   CHECK(employment_type IN ('FULL_TIME','PART_TIME','TEMPORARY','CONTRACT')),
 status VARCHAR(20) NOT NULL DEFAULT 'ACTIVE'
   CHECK(status IN ('ACTIVE','ON_LEAVE','SUSPENDED','TERMINATED')),
 basic_salary NUMERIC(18,6) NOT NULL DEFAULT 0 CHECK(basic_salary>=0),
 bank_name VARCHAR(120), bank_account VARCHAR(80), address TEXT, emergency_contact VARCHAR(160),
 termination_date DATE, notes TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 CHECK(termination_date IS NULL OR termination_date>=hire_date)
);
ALTER TABLE departments DROP CONSTRAINT IF EXISTS departments_manager_employee_id_fkey;
ALTER TABLE departments ADD CONSTRAINT departments_manager_employee_id_fkey
 FOREIGN KEY(manager_employee_id) REFERENCES employees(id) ON DELETE SET NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_employees_national_id ON employees(national_id) WHERE national_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_employees_department_status ON employees(department_id,status);
CREATE TABLE IF NOT EXISTS work_shifts (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(), code VARCHAR(30) NOT NULL UNIQUE, name_ar VARCHAR(100) NOT NULL,
 start_time TIME NOT NULL, end_time TIME NOT NULL, grace_minutes INTEGER NOT NULL DEFAULT 0 CHECK(grace_minutes BETWEEN 0 AND 240),
 break_minutes INTEGER NOT NULL DEFAULT 0 CHECK(break_minutes BETWEEN 0 AND 360), crosses_midnight BOOLEAN NOT NULL DEFAULT FALSE,
 is_active BOOLEAN NOT NULL DEFAULT TRUE
);
CREATE TABLE IF NOT EXISTS employee_shift_assignments (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(), employee_id UUID NOT NULL REFERENCES employees(id) ON DELETE RESTRICT,
 shift_id UUID NOT NULL REFERENCES work_shifts(id) ON DELETE RESTRICT,
 effective_from DATE NOT NULL, effective_to DATE, created_by UUID REFERENCES users(id),
 CHECK(effective_to IS NULL OR effective_to>=effective_from)
);
CREATE INDEX IF NOT EXISTS idx_shift_assignment_employee_dates ON employee_shift_assignments(employee_id,effective_from,effective_to);
CREATE TABLE IF NOT EXISTS attendance_records (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(), employee_id UUID NOT NULL REFERENCES employees(id) ON DELETE RESTRICT,
 work_date DATE NOT NULL, shift_id UUID REFERENCES work_shifts(id) ON DELETE RESTRICT,
 check_in TIMESTAMPTZ, check_out TIMESTAMPTZ,
 status VARCHAR(20) NOT NULL DEFAULT 'PRESENT' CHECK(status IN ('PRESENT','ABSENT','LEAVE','HOLIDAY','REST_DAY')),
 late_minutes INTEGER NOT NULL DEFAULT 0 CHECK(late_minutes>=0), overtime_minutes INTEGER NOT NULL DEFAULT 0 CHECK(overtime_minutes>=0),
 source VARCHAR(20) NOT NULL DEFAULT 'MANUAL' CHECK(source IN ('MANUAL','DEVICE','IMPORT')),
 approved_by UUID REFERENCES users(id), approved_at TIMESTAMPTZ, notes TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 UNIQUE(employee_id,work_date), CHECK(check_out IS NULL OR check_in IS NULL OR check_out>check_in)
);
CREATE TABLE IF NOT EXISTS leave_types (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(), code VARCHAR(30) NOT NULL UNIQUE, name_ar VARCHAR(100) NOT NULL,
 annual_quota NUMERIC(8,2) NOT NULL DEFAULT 0 CHECK(annual_quota>=0),
 paid BOOLEAN NOT NULL DEFAULT TRUE, requires_document BOOLEAN NOT NULL DEFAULT FALSE, is_active BOOLEAN NOT NULL DEFAULT TRUE
);
CREATE TABLE IF NOT EXISTS leave_requests (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(), request_no VARCHAR(40) NOT NULL UNIQUE,
 employee_id UUID NOT NULL REFERENCES employees(id) ON DELETE RESTRICT,
 leave_type_id UUID NOT NULL REFERENCES leave_types(id) ON DELETE RESTRICT,
 start_date DATE NOT NULL, end_date DATE NOT NULL, days NUMERIC(8,2) NOT NULL CHECK(days>0),
 reason TEXT, attachment_ref TEXT,
 status VARCHAR(20) NOT NULL DEFAULT 'PENDING' CHECK(status IN ('PENDING','APPROVED','REJECTED','CANCELLED')),
 approved_by UUID REFERENCES users(id), approved_at TIMESTAMPTZ, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 CHECK(end_date>=start_date)
);
CREATE INDEX IF NOT EXISTS idx_leave_requests_employee_dates ON leave_requests(employee_id,start_date,end_date);
CREATE TABLE IF NOT EXISTS payroll_periods (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(), period_code VARCHAR(20) NOT NULL UNIQUE,
 start_date DATE NOT NULL, end_date DATE NOT NULL, status VARCHAR(16) NOT NULL DEFAULT 'OPEN'
 CHECK(status IN ('OPEN','CALCULATED','APPROVED','POSTED','CLOSED')),
 created_by UUID REFERENCES users(id), approved_by UUID REFERENCES users(id), approved_at TIMESTAMPTZ,
 CHECK(end_date>=start_date)
);
CREATE TABLE IF NOT EXISTS payroll_runs (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(), payroll_period_id UUID NOT NULL UNIQUE REFERENCES payroll_periods(id) ON DELETE RESTRICT,
 status VARCHAR(16) NOT NULL DEFAULT 'DRAFT' CHECK(status IN ('DRAFT','CALCULATED','APPROVED','POSTED','REVERSED')),
 total_gross NUMERIC(18,6) NOT NULL DEFAULT 0, total_deductions NUMERIC(18,6) NOT NULL DEFAULT 0,
 total_net NUMERIC(18,6) NOT NULL DEFAULT 0, calculated_by UUID REFERENCES users(id), calculated_at TIMESTAMPTZ,
 approved_by UUID REFERENCES users(id), approved_at TIMESTAMPTZ, posted_by UUID REFERENCES users(id), posted_at TIMESTAMPTZ
);
CREATE TABLE IF NOT EXISTS payroll_items (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(), payroll_run_id UUID NOT NULL REFERENCES payroll_runs(id) ON DELETE RESTRICT,
 employee_id UUID NOT NULL REFERENCES employees(id) ON DELETE RESTRICT,
 basic_amount NUMERIC(18,6) NOT NULL DEFAULT 0, allowances NUMERIC(18,6) NOT NULL DEFAULT 0,
 overtime_amount NUMERIC(18,6) NOT NULL DEFAULT 0, bonuses NUMERIC(18,6) NOT NULL DEFAULT 0,
 deductions NUMERIC(18,6) NOT NULL DEFAULT 0, absence_deduction NUMERIC(18,6) NOT NULL DEFAULT 0,
 advance_deduction NUMERIC(18,6) NOT NULL DEFAULT 0, net_amount NUMERIC(18,6) NOT NULL,
 details JSONB NOT NULL DEFAULT '{}'::jsonb, UNIQUE(payroll_run_id,employee_id),
 CHECK(basic_amount>=0 AND allowances>=0 AND overtime_amount>=0 AND bonuses>=0 AND deductions>=0
 AND absence_deduction>=0 AND advance_deduction>=0 AND net_amount>=0)
);
CREATE TABLE IF NOT EXISTS employee_advances (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(), advance_no VARCHAR(40) NOT NULL UNIQUE,
 employee_id UUID NOT NULL REFERENCES employees(id) ON DELETE RESTRICT,
 request_date DATE NOT NULL DEFAULT CURRENT_DATE, amount NUMERIC(18,6) NOT NULL CHECK(amount>0),
 installments INTEGER NOT NULL DEFAULT 1 CHECK(installments BETWEEN 1 AND 60),
 status VARCHAR(16) NOT NULL DEFAULT 'PENDING' CHECK(status IN ('PENDING','APPROVED','SETTLED','REJECTED')),
 approved_by UUID REFERENCES users(id), approved_at TIMESTAMPTZ, remaining_amount NUMERIC(18,6) NOT NULL,
 notes TEXT, created_by UUID REFERENCES users(id), CHECK(remaining_amount>=0 AND remaining_amount<=amount)
);
CREATE TABLE IF NOT EXISTS fixed_assets (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(), asset_code VARCHAR(40) NOT NULL UNIQUE,
 name_ar VARCHAR(180) NOT NULL, asset_type VARCHAR(30) NOT NULL CHECK(asset_type IN ('PRODUCTION_LINE','MACHINE','VEHICLE','UTILITY','IT','OTHER')),
 plant_id UUID REFERENCES plants(id) ON DELETE RESTRICT, location VARCHAR(160), serial_no VARCHAR(100),
 manufacturer VARCHAR(120), model VARCHAR(120), purchase_date DATE, warranty_until DATE,
 acquisition_cost NUMERIC(18,6) NOT NULL DEFAULT 0 CHECK(acquisition_cost>=0),
 status VARCHAR(20) NOT NULL DEFAULT 'ACTIVE' CHECK(status IN ('ACTIVE','UNDER_MAINTENANCE','RETIRED')),
 criticality VARCHAR(12) NOT NULL DEFAULT 'MEDIUM' CHECK(criticality IN ('LOW','MEDIUM','HIGH','CRITICAL')),
 notes TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS maintenance_plans (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(), plan_code VARCHAR(40) NOT NULL UNIQUE,
 asset_id UUID NOT NULL REFERENCES fixed_assets(id) ON DELETE RESTRICT,
 title_ar VARCHAR(180) NOT NULL, maintenance_type VARCHAR(16) NOT NULL CHECK(maintenance_type IN ('PREVENTIVE','PREDICTIVE','INSPECTION')),
 interval_days INTEGER NOT NULL CHECK(interval_days BETWEEN 1 AND 3650), next_due_date DATE NOT NULL,
 checklist JSONB NOT NULL DEFAULT '[]'::jsonb, estimated_hours NUMERIC(8,2) NOT NULL DEFAULT 0,
 is_active BOOLEAN NOT NULL DEFAULT TRUE, created_by UUID REFERENCES users(id)
);
CREATE TABLE IF NOT EXISTS maintenance_work_orders (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(), work_order_no VARCHAR(40) NOT NULL UNIQUE,
 asset_id UUID NOT NULL REFERENCES fixed_assets(id) ON DELETE RESTRICT,
 plan_id UUID REFERENCES maintenance_plans(id) ON DELETE RESTRICT,
 maintenance_type VARCHAR(16) NOT NULL CHECK(maintenance_type IN ('PREVENTIVE','CORRECTIVE','EMERGENCY','INSPECTION')),
 priority VARCHAR(12) NOT NULL DEFAULT 'NORMAL' CHECK(priority IN ('LOW','NORMAL','HIGH','CRITICAL')),
 status VARCHAR(20) NOT NULL DEFAULT 'OPEN' CHECK(status IN ('OPEN','ASSIGNED','IN_PROGRESS','WAITING_PARTS','COMPLETED','APPROVED','CANCELLED')),
 reported_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), scheduled_at TIMESTAMPTZ, started_at TIMESTAMPTZ, completed_at TIMESTAMPTZ,
 reported_by UUID REFERENCES users(id), assigned_to UUID REFERENCES employees(id), approved_by UUID REFERENCES users(id), approved_at TIMESTAMPTZ,
 problem_description TEXT NOT NULL, work_performed TEXT, downtime_minutes INTEGER NOT NULL DEFAULT 0 CHECK(downtime_minutes>=0),
 labor_cost NUMERIC(18,6) NOT NULL DEFAULT 0 CHECK(labor_cost>=0), other_cost NUMERIC(18,6) NOT NULL DEFAULT 0 CHECK(other_cost>=0),
 root_cause TEXT, safety_notes TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS maintenance_parts (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(), work_order_id UUID NOT NULL REFERENCES maintenance_work_orders(id) ON DELETE RESTRICT,
 item_id UUID NOT NULL REFERENCES items(id) ON DELETE RESTRICT, warehouse_id UUID NOT NULL REFERENCES warehouses(id) ON DELETE RESTRICT,
 lot_no VARCHAR(80) NOT NULL DEFAULT '', quantity NUMERIC(18,6) NOT NULL CHECK(quantity>0),
 unit_cost NUMERIC(18,6) NOT NULL DEFAULT 0 CHECK(unit_cost>=0), issued_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 issued_by UUID REFERENCES users(id)
);
CREATE TABLE IF NOT EXISTS maintenance_downtime_logs (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(), work_order_id UUID NOT NULL REFERENCES maintenance_work_orders(id) ON DELETE RESTRICT,
 started_at TIMESTAMPTZ NOT NULL, ended_at TIMESTAMPTZ, reason TEXT NOT NULL,
 CHECK(ended_at IS NULL OR ended_at>started_at)
);
CREATE TABLE IF NOT EXISTS company_settings (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(), company_id UUID NOT NULL UNIQUE REFERENCES companies(id) ON DELETE RESTRICT,
 phone VARCHAR(40), email VARCHAR(160), address TEXT, tax_number VARCHAR(60), commercial_register VARCHAR(60),
 logo_ref TEXT, timezone VARCHAR(80) NOT NULL DEFAULT 'Africa/Cairo', currency CHAR(3) NOT NULL DEFAULT 'EGP',
 updated_by UUID REFERENCES users(id), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS numbering_sequences (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(), document_type VARCHAR(40) NOT NULL UNIQUE,
 prefix VARCHAR(20) NOT NULL, next_value BIGINT NOT NULL DEFAULT 1 CHECK(next_value>0),
 padding SMALLINT NOT NULL DEFAULT 6 CHECK(padding BETWEEN 1 AND 12), is_active BOOLEAN NOT NULL DEFAULT TRUE
);
CREATE TABLE IF NOT EXISTS system_parameters (
 parameter_key VARCHAR(80) PRIMARY KEY, parameter_value JSONB NOT NULL,
 description_ar VARCHAR(200), updated_by UUID REFERENCES users(id), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS approval_workflows (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(), workflow_code VARCHAR(50) NOT NULL UNIQUE,
 name_ar VARCHAR(160) NOT NULL, module_code VARCHAR(40) NOT NULL,
 steps JSONB NOT NULL DEFAULT '[]'::jsonb, is_active BOOLEAN NOT NULL DEFAULT TRUE,
 updated_by UUID REFERENCES users(id), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
INSERT INTO permissions(code,name_ar,module_code) VALUES
 ('HR.READ','عرض الموارد البشرية','HR'),('HR.MANAGE','إدارة ملفات الموظفين','HR'),
 ('HR.ATTENDANCE.MANAGE','إدارة الحضور والانصراف','HR'),('HR.LEAVE.APPROVE','اعتماد الإجازات','HR'),
 ('HR.PAYROLL.MANAGE','إعداد مسير الرواتب','HR'),('HR.PAYROLL.APPROVE','اعتماد مسير الرواتب','HR'),
 ('HR.ADVANCES.MANAGE','إدارة السلف','HR'),('MAINTENANCE.READ','عرض الصيانة','MAINTENANCE'),
 ('MAINTENANCE.MANAGE','إدارة أوامر الصيانة','MAINTENANCE'),('MAINTENANCE.PARTS.ISSUE','صرف قطع غيار للصيانة','MAINTENANCE'),
 ('MAINTENANCE.APPROVE','اعتماد إغلاق الصيانة','MAINTENANCE'),('SETTINGS.READ','عرض إعدادات النظام','SETTINGS'),
 ('SETTINGS.MANAGE','إدارة الإعدادات الإدارية','SETTINGS'),('SETTINGS.SECURITY.MANAGE','إدارة إعدادات الأمان','SETTINGS')
ON CONFLICT(code) DO NOTHING;
