INSERT INTO permissions(code,name_ar,module_code,description) VALUES
 ('INVENTORY.ADJUST.APPROVE','اعتماد وترحيل تسويات المخزون','INVENTORY','صلاحية مستقلة لاعتماد مسودات تسويات المخزون وترحيل أثرها المخزني والمحاسبي')
ON CONFLICT(code) DO UPDATE SET name_ar=EXCLUDED.name_ar,module_code=EXCLUDED.module_code,description=EXCLUDED.description;

INSERT INTO role_permissions(role_id,permission_id)
SELECT r.id,p.id FROM roles r JOIN permissions p ON p.code='INVENTORY.ADJUST.APPROVE'
WHERE r.code='SYSTEM_ADMIN'
ON CONFLICT(role_id,permission_id) DO NOTHING;
