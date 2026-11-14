-- 010: initial role permissions and standard payment method references.
INSERT INTO roles(code,name) VALUES
  ('SUPER_ADMIN','مدير النظام'),
  ('CASHIER','كاشير'),
  ('STOCK_KEEPER','أمين مخزن'),
  ('PURCHASING','مسؤول مشتريات'),
  ('ACCOUNTANT','محاسب'),
  ('BRANCH_MANAGER','مدير فرع')
ON CONFLICT(code) DO NOTHING;

INSERT INTO permissions(code,description) VALUES
  ('catalog.manage','إدارة الأصناف والباركود والأسعار'),
  ('inventory.manage','إدارة المخزون وحركاته'),
  ('purchasing.manage','إدارة المشتريات والاستلام'),
  ('sales.manage','إدارة المبيعات ونقطة البيع'),
  ('returns.inspect','فحص مرتجعات البيع بالمخزن'),
  ('returns.approve','اعتماد المرتجعات ماليًا'),
  ('accounting.manage','إدارة الحسابات والخزائن'),
  ('hr.manage','إدارة الموظفين والورديات'),
  ('assets.manage','إدارة الأصول والصيانة'),
  ('delivery.manage','إدارة التوصيل'),
  ('ecommerce.manage','إدارة طلبات المتجر الإلكتروني'),
  ('users.manage','إدارة المستخدمين والصلاحيات'),
  ('settings.manage','إدارة إعدادات النظام')
ON CONFLICT(code) DO NOTHING;

INSERT INTO role_permissions(role_id,permission_id)
SELECT r.id,p.id FROM roles r CROSS JOIN permissions p
WHERE r.code='SUPER_ADMIN'
ON CONFLICT DO NOTHING;

INSERT INTO payment_methods(code,name_ar,name_en) VALUES
  ('CASH','نقدي','Cash'),
  ('CARD','بطاقة بنكية','Card'),
  ('WALLET','محفظة إلكترونية','E-wallet'),
  ('BANK_TRANSFER','تحويل بنكي','Bank transfer')
ON CONFLICT(code) DO NOTHING;
