-- NEW FEED starter catalogue: editable feed raw materials, preparation inputs, packaging and finished feed products.
ALTER TABLE item_categories DROP CONSTRAINT IF EXISTS item_categories_category_kind_check;
ALTER TABLE item_categories ADD CONSTRAINT item_categories_category_kind_check
 CHECK(category_kind IN ('RAW_MATERIAL','PACKAGING','SEMI_FINISHED','FINISHED_GOOD','SPARE_PART','OTHER'));
INSERT INTO units_of_measure(code,name_ar,decimal_places) VALUES
('KG','كيلوجرام',3),
('TON','طن',3),
('G','جرام',3),
('L','لتر',3),
('ML','ملليلتر',3),
('PCS','قطعة',0),
('BAG','شيكارة',0)
ON CONFLICT(code) DO UPDATE SET name_ar=EXCLUDED.name_ar,decimal_places=EXCLUDED.decimal_places;
INSERT INTO item_categories(code,name_ar,category_kind) VALUES
('CAT-RAW','خامات ومكونات العلف','RAW_MATERIAL'),
('CAT-ADD','إضافات ومركزات علفية','RAW_MATERIAL'),
('CAT-PACK','مواد التعبئة والتغليف','PACKAGING'),
('CAT-SEMI','منتجات نصف مصنعة ومواد تحضير','SEMI_FINISHED'),
('CAT-FINISHED','منتجات علفية تامة الصنع','FINISHED_GOOD'),
('CAT-SPARE','قطع غيار ومستهلكات تشغيل','SPARE_PART'),
('CAT-OTHER','أصناف أخرى','OTHER')
ON CONFLICT(code) DO UPDATE SET name_ar=EXCLUDED.name_ar,category_kind=EXCLUDED.category_kind;
INSERT INTO items(code,name_ar,category_id,base_unit_id,tracks_lot,tracks_expiry)
SELECT v.code,v.name_ar,c.id,u.id,TRUE,v.tracks_expiry
FROM (VALUES
('RM-CORN','ذرة صفراء مجروشة','RAW_MATERIAL','KG',TRUE),
('RM-SOY','كسب فول صويا 44%','RAW_MATERIAL','KG',TRUE),
('RM-SOY46','كسب فول صويا 46%','RAW_MATERIAL','KG',TRUE),
('RM-WHEAT','قمح','RAW_MATERIAL','KG',TRUE),
('RM-BRAN','نخالة قمح','RAW_MATERIAL','KG',TRUE),
('RM-RICEBRAN','ردة أرز','RAW_MATERIAL','KG',TRUE),
('RM-SUNMEAL','كسب عباد الشمس','RAW_MATERIAL','KG',TRUE),
('RM-COTTON','كسب بذرة القطن','RAW_MATERIAL','KG',TRUE),
('RM-CORNGLUTEN','جلوتين الذرة','RAW_MATERIAL','KG',TRUE),
('RM-DDGS','مخلفات تقطير الحبوب DDGS','RAW_MATERIAL','KG',TRUE),
('RM-SORGHUM','ذرة رفيعة','RAW_MATERIAL','KG',TRUE),
('RM-BARLEY','شعير','RAW_MATERIAL','KG',TRUE),
('RM-MOLASSES','مولاس قصب','RAW_MATERIAL','KG',TRUE),
('RM-VEGOIL','زيت نباتي','RAW_MATERIAL','KG',TRUE),
('RM-FISHMEAL','مسحوق سمك','RAW_MATERIAL','KG',TRUE),
('RM-MEATBONE','مسحوق لحم وعظم','RAW_MATERIAL','KG',TRUE),
('RM-POULTRYMEAL','مسحوق مخلفات دواجن','RAW_MATERIAL','KG',TRUE),
('RM-LIMESTONE','حجر جيري مطحون','RAW_MATERIAL','KG',TRUE),
('RM-DCP','فوسفات ثنائي الكالسيوم','RAW_MATERIAL','KG',TRUE),
('RM-MCP','فوسفات أحادي الكالسيوم','RAW_MATERIAL','KG',TRUE),
('RM-SALT','ملح طعام','RAW_MATERIAL','KG',TRUE),
('RM-SODABIC','بيكربونات صوديوم','RAW_MATERIAL','KG',TRUE),
('RM-LYSINE','إل-لايسين','RAW_MATERIAL','KG',TRUE),
('RM-METHIONINE','دي إل-ميثيونين','RAW_MATERIAL','KG',TRUE),
('RM-THREONINE','إل-ثريونين','RAW_MATERIAL','KG',TRUE),
('RM-TRYPTOPHAN','إل-تريبتوفان','RAW_MATERIAL','KG',TRUE),
('RM-CHOLINE','كلوريد الكولين','RAW_MATERIAL','KG',TRUE),
('RM-CHOLCL','كلوريد الكولين 60%','RAW_MATERIAL','KG',TRUE),
('RM-VITPREMIX','مخلوط فيتامينات','RAW_MATERIAL','KG',TRUE),
('RM-MINPREMIX','مخلوط أملاح معدنية','RAW_MATERIAL','KG',TRUE),
('RM-ENZYME','مخلوط إنزيمات','RAW_MATERIAL','KG',TRUE),
('RM-PHOS','مضاد فطريات / رابط سموم','RAW_MATERIAL','KG',TRUE),
('RM-TOXIN','رابط سموم فطرية','RAW_MATERIAL','KG',TRUE),
('RM-ANTIOX','مضاد أكسدة','RAW_MATERIAL','KG',TRUE),
('RM-COCC','مضاد كوكسيديا','RAW_MATERIAL','KG',TRUE),
('RM-PROBIOTIC','بروبيوتك','RAW_MATERIAL','KG',TRUE),
('RM-PHYTASE','إنزيم فيتيز','RAW_MATERIAL','KG',TRUE),
('RM-PIGMENT','صبغة / ملون علف','RAW_MATERIAL','KG',TRUE),
('RM-UREA','يوريا أعلاف (للمجترات فقط)','RAW_MATERIAL','KG',TRUE),
('RM-BYPASSFAT','دهون محمية للمجترات','RAW_MATERIAL','KG',TRUE),
('RM-BYPASSPROT','بروتين محمي للمجترات','RAW_MATERIAL','KG',TRUE),
('RM-FISHOIL','زيت سمك','RAW_MATERIAL','KG',TRUE),
('RM-ACID','محمض أعلاف','RAW_MATERIAL','KG',TRUE),
('RM-FLAVOR','محسن نكهة','RAW_MATERIAL','KG',TRUE),
('RM-BINDER','مادة رابطة للتحبيب','RAW_MATERIAL','KG',TRUE),
('RM-ANTICAKING','مانع تكتل','RAW_MATERIAL','KG',TRUE),
('RM-WATER','مياه تشغيل','RAW_MATERIAL','L',FALSE),
('PK-BAG25','شيكارة 25 كجم','PACKAGING','PCS',FALSE),
('PK-BAG50','شيكارة 50 كجم','PACKAGING','PCS',FALSE),
('PK-BIGBAG','جامبو باج','PACKAGING','PCS',FALSE),
('PK-LABEL','ملصق بيانات المنتج','PACKAGING','PCS',FALSE),
('PK-THREAD','خيط خياطة الشكائر','PACKAGING','KG',FALSE),
('PK-STRETCH','استرتش تغليف','PACKAGING','KG',FALSE),
('SF-GRIND','ذرة مطحونة مجهزة للتشغيل','SEMI_FINISHED','KG',TRUE),
('SF-PREMIX','بريمكس مجهز للتشغيل','SEMI_FINISHED','KG',TRUE),
('SF-MIX','خلطة علف قبل التحبيب','SEMI_FINISHED','KG',TRUE),
('FG-POULTRY-START','علف دواجن بادئ','FINISHED_GOOD','KG',TRUE),
('FG-POULTRY-GROW','علف دواجن نامي','FINISHED_GOOD','KG',TRUE),
('FG-POULTRY-FINISH','علف دواجن ناهي','FINISHED_GOOD','KG',TRUE),
('FG-LAYER-1','علف بياض إنتاج أول','FINISHED_GOOD','KG',TRUE),
('FG-LAYER-2','علف بياض إنتاج ثاني','FINISHED_GOOD','KG',TRUE),
('FG-CATTLE-MAINT','علف ماشية صيانة','FINISHED_GOOD','KG',TRUE),
('FG-CATTLE-FATTEN','علف ماشية تسمين','FINISHED_GOOD','KG',TRUE),
('FG-SHEEP','علف أغنام','FINISHED_GOOD','KG',TRUE),
('FG-FISH','علف أسماك','FINISHED_GOOD','KG',TRUE),
('FG-RABBIT','علف أرانب','FINISHED_GOOD','KG',TRUE),
('FG-DUCK','علف بط','FINISHED_GOOD','KG',TRUE)
) AS v(code,name_ar,category_kind,unit_code,tracks_expiry)
JOIN item_categories c ON c.category_kind=v.category_kind AND c.code=CASE
 WHEN v.code LIKE 'RM-%' AND v.code NOT IN ('RM-CORN','RM-SOY','RM-SOY46','RM-WHEAT','RM-BRAN','RM-RICEBRAN','RM-SUNMEAL','RM-COTTON','RM-CORNGLUTEN','RM-DDGS','RM-SORGHUM','RM-BARLEY','RM-MOLASSES','RM-VEGOIL','RM-FISHMEAL','RM-MEATBONE','RM-POULTRYMEAL','RM-LIMESTONE','RM-DCP','RM-MCP','RM-SALT','RM-SODABIC','RM-WATER') THEN 'CAT-ADD'
 WHEN v.code LIKE 'RM-%' THEN 'CAT-RAW'
 WHEN v.code LIKE 'PK-%' THEN 'CAT-PACK'
 WHEN v.code LIKE 'SF-%' THEN 'CAT-SEMI'
 WHEN v.code LIKE 'FG-%' THEN 'CAT-FINISHED' END
JOIN units_of_measure u ON u.code=v.unit_code
ON CONFLICT(code) DO UPDATE SET name_ar=EXCLUDED.name_ar,category_id=EXCLUDED.category_id,base_unit_id=EXCLUDED.base_unit_id,tracks_lot=TRUE,tracks_expiry=EXCLUDED.tracks_expiry;
INSERT INTO unit_conversions(from_unit_id,to_unit_id,factor)
SELECT a.id,b.id,0.001 FROM units_of_measure a,units_of_measure b WHERE a.code='KG' AND b.code='TON'
ON CONFLICT(from_unit_id,to_unit_id) DO UPDATE SET factor=EXCLUDED.factor;
INSERT INTO unit_conversions(from_unit_id,to_unit_id,factor)
SELECT a.id,b.id,1000 FROM units_of_measure a,units_of_measure b WHERE a.code='TON' AND b.code='KG'
ON CONFLICT(from_unit_id,to_unit_id) DO UPDATE SET factor=EXCLUDED.factor;
INSERT INTO feed_types(code,name_ar,name_en,description) VALUES
 ('POULTRY','أعلاف الدواجن','Poultry feed','أعلاف التسمين والبياض ومراحل التربية'),
 ('LAYER','أعلاف البياض','Layer feed','أعلاف الدجاج البياض'),
 ('CATTLE','أعلاف الماشية','Cattle feed','أعلاف الأبقار والعجول'),
 ('SHEEP','أعلاف الأغنام','Sheep feed','أعلاف الأغنام والماعز'),
 ('FISH','أعلاف الأسماك','Fish feed','أعلاف الأسماك'),
 ('RABBIT','أعلاف الأرانب','Rabbit feed','أعلاف الأرانب'),
 ('DUCK','أعلاف البط','Duck feed','أعلاف البط')
ON CONFLICT(code) DO UPDATE SET name_ar=EXCLUDED.name_ar,name_en=EXCLUDED.name_en,description=EXCLUDED.description;
INSERT INTO feed_products(code,name_ar,feed_type_id,item_id,target_species,product_stage)
SELECT v.code,v.name_ar,t.id,i.id,v.species,v.stage
FROM (VALUES
 ('FG-POULTRY-START','علف دواجن بادئ','POULTRY','FG-POULTRY-START','دواجن تسمين','بادئ'),
 ('FG-POULTRY-GROW','علف دواجن نامي','POULTRY','FG-POULTRY-GROW','دواجن تسمين','نامي'),
 ('FG-POULTRY-FINISH','علف دواجن ناهي','POULTRY','FG-POULTRY-FINISH','دواجن تسمين','ناهي'),
 ('FG-LAYER-1','علف بياض إنتاج أول','LAYER','FG-LAYER-1','دجاج بياض','إنتاج أول'),
 ('FG-LAYER-2','علف بياض إنتاج ثاني','LAYER','FG-LAYER-2','دجاج بياض','إنتاج ثاني'),
 ('FG-CATTLE-MAINT','علف ماشية صيانة','CATTLE','FG-CATTLE-MAINT','ماشية','صيانة'),
 ('FG-CATTLE-FATTEN','علف ماشية تسمين','CATTLE','FG-CATTLE-FATTEN','عجول','تسمين'),
 ('FG-SHEEP','علف أغنام','SHEEP','FG-SHEEP','أغنام','عام'),
 ('FG-FISH','علف أسماك','FISH','FG-FISH','أسماك','عام'),
 ('FG-RABBIT','علف أرانب','RABBIT','FG-RABBIT','أرانب','عام'),
 ('FG-DUCK','علف بط','DUCK','FG-DUCK','بط','عام')
) v(code,name_ar,type_code,item_code,species,stage)
JOIN feed_types t ON t.code=v.type_code JOIN items i ON i.code=v.item_code
ON CONFLICT(code) DO UPDATE SET name_ar=EXCLUDED.name_ar,feed_type_id=EXCLUDED.feed_type_id,item_id=EXCLUDED.item_id,target_species=EXCLUDED.target_species,product_stage=EXCLUDED.product_stage;
