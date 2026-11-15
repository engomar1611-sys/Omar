-- 052: activate least-privilege operational role defaults across all ERP modules.
INSERT INTO permissions(code,description) VALUES
 ('sales.void.invoice','إلغاء فاتورة بيع مع عكس القيود والمخزون'),
 ('sales.void.line','إنشاء طلب مرتجع من فاتورة بيع'),
 ('supplier.accounting','إدارة حسابات الموردين ومدفوعاتهم'),
 ('loyalty.manage','إدارة إعدادات وحركات نقاط الولاء'),
 ('hr.attendance','إدارة الحضور والانصراف'),
 ('hr.payroll','إدارة مسيرات الرواتب والصرف'),
 ('cash.manage','إدارة الخزائن وجلسات الكاشير'),
 ('bank.manage','إدارة الحسابات والحركات البنكية'),
 ('reports.view','عرض التقارير'),
 ('settings.manage','إدارة إعدادات النظام')
ON CONFLICT(code) DO NOTHING;

-- Cashiers: POS, customer returns initiation and their till sessions.
INSERT INTO role_permissions(role_id,permission_id)
SELECT r.id,p.id FROM roles r CROSS JOIN permissions p
WHERE r.code='CASHIER' AND p.code IN
 ('sales.manage','catalog.view','cash.manage','sales.void.line','returns.view')
ON CONFLICT DO NOTHING;

-- Stock keepers: inventory and warehouse inspection only; no financial approval.
INSERT INTO role_permissions(role_id,permission_id)
SELECT r.id,p.id FROM roles r CROSS JOIN permissions p
WHERE r.code='STOCK_KEEPER' AND p.code IN
 ('inventory.manage','catalog.view','catalog.export','returns.inspect','returns.view')
ON CONFLICT DO NOTHING;

-- Purchasing staff: procurement, supplier workflows and catalogue maintenance.
INSERT INTO role_permissions(role_id,permission_id)
SELECT r.id,p.id FROM roles r CROSS JOIN permissions p
WHERE r.code='PURCHASING' AND p.code IN
 ('purchasing.manage','supplier.accounting','catalog.view','catalog.create','catalog.edit','catalog.import','catalog.export')
ON CONFLICT DO NOTHING;

-- Accountants: financial approval, bank and cash ledgers, supplier accounting and reporting.
INSERT INTO role_permissions(role_id,permission_id)
SELECT r.id,p.id FROM roles r CROSS JOIN permissions p
WHERE r.code='ACCOUNTANT' AND p.code IN
 ('accounting.manage','supplier.accounting','returns.approve','returns.view','bank.manage','cash.manage','reports.view','reports.export')
ON CONFLICT DO NOTHING;

-- Branch managers: operational oversight with explicit void/discount and approval controls.
INSERT INTO role_permissions(role_id,permission_id)
SELECT r.id,p.id FROM roles r CROSS JOIN permissions p
WHERE r.code='BRANCH_MANAGER' AND p.code IN
 ('sales.manage','sales.discount','sales.discount.manage','sales.void.line','sales.void.invoice',
  'catalog.view','catalog.create','catalog.edit','catalog.import','catalog.import.approve','catalog.export',
  'inventory.manage','purchasing.manage','supplier.accounting','returns.inspect','returns.approve','returns.view',
  'accounting.manage','cash.manage','bank.manage','hr.manage','hr.attendance','hr.payroll',
  'assets.manage','delivery.manage','delivery.report','ecommerce.manage','loyalty.manage',
  'reports.view','reports.export','settings.manage')
ON CONFLICT DO NOTHING;

-- HR manager role is limited to employee, attendance and payroll operations.
INSERT INTO role_permissions(role_id,permission_id)
SELECT r.id,p.id FROM roles r CROSS JOIN permissions p
WHERE r.code='HR_MANAGER' AND p.code IN ('hr.manage','hr.attendance','hr.payroll')
ON CONFLICT DO NOTHING;

-- Keep return-list access aligned with inspection and finance approval roles.
INSERT INTO role_permissions(role_id,permission_id)
SELECT r.id,p.id FROM roles r CROSS JOIN permissions p
WHERE (r.code IN ('CASHIER','STOCK_KEEPER','PURCHASING','ACCOUNTANT','BRANCH_MANAGER') AND p.code='returns.view')
   OR (r.code='SUPER_ADMIN' AND p.code IN ('returns.view','backup.manage'))
ON CONFLICT DO NOTHING;
