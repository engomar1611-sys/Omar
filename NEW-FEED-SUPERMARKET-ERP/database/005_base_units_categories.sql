-- Core category and unit dictionaries only; no commercial stock, prices or GTINs are invented.
INSERT INTO units(code,name_ar,name_en,dimension,base_factor) VALUES
 ('PCS','قطعة','Piece','count',1),
 ('KG','كيلوجرام','Kilogram','mass',1),
 ('G','جرام','Gram','mass',0.001),
 ('L','لتر','Liter','volume',1),
 ('ML','ملليلتر','Milliliter','volume',0.001),
 ('M','متر','Meter','length',1)
ON CONFLICT(code) DO NOTHING;

INSERT INTO categories(code,name_ar,name_en) VALUES
 ('FOOD','مواد غذائية','Food'),
 ('BEVERAGES','مشروبات','Beverages'),
 ('DAIRY','ألبان ومنتجاتها','Dairy'),
 ('BAKERY','مخبوزات','Bakery'),
 ('SNACKS','تسالي وشيبسي','Snacks'),
 ('CLEANING','منظفات','Cleaning'),
 ('PERSONAL_CARE','عناية شخصية','Personal Care'),
 ('HOME','مستلزمات منزلية','Household'),
 ('FROZEN','مجمدات','Frozen'),
 ('FRESH','خضروات وفاكهة طازجة','Fresh Produce'),
 ('MEAT','لحوم ودواجن وأسماك','Meat Poultry and Fish'),
 ('BABY','منتجات الأطفال','Baby Products'),
 ('PET','مستلزمات الحيوانات الأليفة','Pet Supplies'),
 ('STATIONERY','أدوات مكتبية','Stationery')
ON CONFLICT(code) DO NOTHING;
