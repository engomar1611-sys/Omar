-- 022: useful independent supermarket departments for POS category navigation.
INSERT INTO categories(code,name_ar,name_en,parent_id)
SELECT v.code,v.name_ar,v.name_en,p.id
FROM (VALUES
 ('CHEESE','قسم الجبن','Cheese','DAIRY'),
 ('YOGURT','الزبادي واللبن الرايب','Yogurt','DAIRY'),
 ('MILK','قسم الألبان','Milk','DAIRY'),
 ('CANNED','قسم المعلبات','Canned Foods','FOOD'),
 ('PASTA_RICE','الأرز والمكرونة','Rice and Pasta','FOOD'),
 ('OILS','الزيوت والسمن','Oils and Ghee','FOOD'),
 ('LEGUMES','البقوليات والحبوب','Legumes and Grains','FOOD'),
 ('SPICES','التوابل والبهارات','Spices','FOOD'),
 ('BREAKFAST','إفطار ومربات وعسل','Breakfast','FOOD'),
 ('SWEETS','الشوكولاتة والحلويات','Chocolate and Sweets','SNACKS'),
 ('FRESH_PRODUCE','الخضار والفاكهة','Fresh Produce','FRESH'),
 ('MEAT_POULTRY','اللحوم والدواجن','Meat and Poultry','MEAT'),
 ('FROZEN_FOODS','الأغذية المجمدة','Frozen Foods','FROZEN'),
 ('BABY_DIAPERS','مستلزمات الأطفال والحفاضات','Baby and Diapers','BABY'),
 ('PET_FOOD','أغذية ومستلزمات الحيوانات','Pet Supplies','PET'),
 ('HOUSEHOLD','الأدوات المنزلية','Household','HOME'),
 ('PAPER_PRODUCTS','المناديل والورقيات','Paper Products','HOME')
) AS v(code,name_ar,name_en,parent_code)
JOIN categories p ON p.code=v.parent_code
ON CONFLICT(code) DO NOTHING;
