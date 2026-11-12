INSERT INTO permissions(code,name_ar,module_code,description) VALUES
 ('INVENTORY.ADJUST.APPROVE','اعتماد وترحيل تسويات المخزون','INVENTORY','صلاحية مستقلة لاعتماد مسودات تسويات المخزون وترحيل أثرها المخزني والمحاسبي')
ON CONFLICT(code) DO UPDATE SET name_ar=EXCLUDED.name_ar,module_code=EXCLUDED.module_code,description=EXCLUDED.description;
