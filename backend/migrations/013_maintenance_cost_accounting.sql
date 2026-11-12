-- Maintenance work-order cost posting accounts.
INSERT INTO gl_accounts(code,name_ar,account_type) VALUES
 ('2150','مستحقات أجور ومصروفات الصيانة','LIABILITY'),
 ('5500','مصروفات صيانة المعدات','EXPENSE')
ON CONFLICT(code) DO NOTHING;

INSERT INTO permissions(code,name_ar,module_code) VALUES
 ('MAINTENANCE.COSTS.READ','عرض تكاليف الصيانة والقيود','MAINTENANCE')
ON CONFLICT(code) DO NOTHING;
