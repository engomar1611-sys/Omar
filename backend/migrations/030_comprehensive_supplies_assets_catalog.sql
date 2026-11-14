-- Comprehensive operating supplies and fixed-asset classification catalogue.
-- Seed data is intentionally generic; site-specific brands, models, quantities and valuations are entered by the company.

INSERT INTO units_of_measure(code,name_ar,decimal_places) VALUES
 ('SET','طقم',0),('BOX','علبة',0),('ROLL','لفة',2),('M','متر',3),('M2','متر مربع',3),
 ('M3','متر مكعب',3),('PAIR','زوج',0),('CAN','جركن',0),('DRUM','برميل',0),('HOUR','ساعة',2),
 ('DAY','يوم',2),('KWH','كيلووات ساعة',3),('PACK','عبوة',0)
ON CONFLICT(code) DO UPDATE SET name_ar=EXCLUDED.name_ar,decimal_places=EXCLUDED.decimal_places;

INSERT INTO item_categories(code,name_ar,category_kind) VALUES
 ('CAT-MAINT-CONS','مستهلكات الصيانة والتشغيل','SPARE_PART'),
 ('CAT-ELECTRICAL','مستلزمات كهرباء وتحكم','SPARE_PART'),
 ('CAT-MECHANICAL','مستلزمات ميكانيكا ونقل حركة','SPARE_PART'),
 ('CAT-LAB','مستلزمات المعمل والجودة','OTHER'),
 ('CAT-SAFETY','السلامة والصحة المهنية','OTHER'),
 ('CAT-CLEAN','النظافة والتطهير ومكافحة الآفات','OTHER'),
 ('CAT-ADMIN','مستلزمات إدارية ومكتبية','OTHER'),
 ('CAT-IT','مستلزمات تقنية وشبكات','OTHER'),
 ('CAT-FUEL','وقود وزيوت وشحوم','OTHER'),
 ('CAT-UTIL','مستلزمات مرافق وخدمات','OTHER'),
 ('CAT-TRANSPORT','مستلزمات النقل والسيارات','OTHER')
ON CONFLICT(code) DO UPDATE SET name_ar=EXCLUDED.name_ar,category_kind=EXCLUDED.category_kind;

WITH seed(code,name_ar,cat,unit,expiry) AS (VALUES
 ('SUP-BEARING','رولمان بلي','CAT-MECHANICAL','PCS',FALSE),
 ('SUP-BELT','سيور نقل حركة','CAT-MECHANICAL','PCS',FALSE),
 ('SUP-CHAIN','جنزير صناعي','CAT-MECHANICAL','M',FALSE),
 ('SUP-SPROCKET','تروس وعجلات مسننة','CAT-MECHANICAL','PCS',FALSE),
 ('SUP-GEARBOX','علبة تروس وملحقاتها','CAT-MECHANICAL','PCS',FALSE),
 ('SUP-COUPLING','وصلات مرنة','CAT-MECHANICAL','PCS',FALSE),
 ('SUP-SEAL','جوانات وأويل سيل','CAT-MECHANICAL','PCS',FALSE),
 ('SUP-HYD-HOSE','خراطيم هيدروليك','CAT-MECHANICAL','M',FALSE),
 ('SUP-PNEU-HOSE','خراطيم هواء','CAT-MECHANICAL','M',FALSE),
 ('SUP-LUBE-GREASE','شحم تشحيم','CAT-FUEL','KG',FALSE),
 ('SUP-LUBE-OIL','زيت تشغيل وتشحيم','CAT-FUEL','L',FALSE),
 ('SUP-HYD-OIL','زيت هيدروليك','CAT-FUEL','L',FALSE),
 ('SUP-GEAR-OIL','زيت تروس','CAT-FUEL','L',FALSE),
 ('SUP-DIESEL','سولار','CAT-FUEL','L',FALSE),
 ('SUP-GASOLINE','بنزين','CAT-FUEL','L',FALSE),
 ('SUP-WELD-ROD','أقطاب لحام','CAT-MAINT-CONS','KG',FALSE),
 ('SUP-CUT-DISC','أقراص قطع وتجليخ','CAT-MAINT-CONS','PCS',FALSE),
 ('SUP-DRILL','بنط ومستلزمات تخريم','CAT-MAINT-CONS','PCS',FALSE),
 ('SUP-FASTENER','مسامير وصواميل وورد','CAT-MAINT-CONS','KG',FALSE),
 ('SUP-ABRASIVE','ورق صنفرة وأحجار جلخ','CAT-MAINT-CONS','PCS',FALSE),
 ('SUP-PAINT','دهانات ومواد حماية','CAT-MAINT-CONS','L',FALSE),
 ('SUP-THINNER','مذيبات ومواد تخفيف','CAT-MAINT-CONS','L',FALSE),
 ('SUP-ELEC-CABLE','كابلات وأسلاك كهرباء','CAT-ELECTRICAL','M',FALSE),
 ('SUP-ELEC-BREAKER','قواطع كهربائية','CAT-ELECTRICAL','PCS',FALSE),
 ('SUP-ELEC-CONTACTOR','كونتاكتور وريلاي','CAT-ELECTRICAL','PCS',FALSE),
 ('SUP-ELEC-SENSOR','حساسات ومفاتيح حدية','CAT-ELECTRICAL','PCS',FALSE),
 ('SUP-ELEC-FUSE','فيوزات وحوامل','CAT-ELECTRICAL','PCS',FALSE),
 ('SUP-ELEC-LAMP','لمبات وكشافات','CAT-ELECTRICAL','PCS',FALSE),
 ('SUP-ELEC-BATTERY','بطاريات','CAT-ELECTRICAL','PCS',FALSE),
 ('SUP-ELEC-PLC','وحدات تحكم PLC وملحقاتها','CAT-ELECTRICAL','PCS',FALSE),
 ('SUP-LAB-MOIST','مستهلكات قياس الرطوبة','CAT-LAB','PCS',FALSE),
 ('SUP-LAB-SAMPLE','أكياس وعبوات عينات','CAT-LAB','PCS',FALSE),
 ('SUP-LAB-GLASS','زجاجيات وأدوات معمل','CAT-LAB','PCS',FALSE),
 ('SUP-LAB-CHEM','كواشف ومحاليل معملية','CAT-LAB','L',TRUE),
 ('SUP-LAB-FILTER','فلاتر وأوراق ترشيح','CAT-LAB','BOX',FALSE),
 ('SUP-PPE-HELMET','خوذات واقية','CAT-SAFETY','PCS',FALSE),
 ('SUP-PPE-SHOES','أحذية سلامة','CAT-SAFETY','PAIR',FALSE),
 ('SUP-PPE-GLOVES','قفازات حماية','CAT-SAFETY','PAIR',FALSE),
 ('SUP-PPE-GLASSES','نظارات واقية','CAT-SAFETY','PCS',FALSE),
 ('SUP-PPE-MASK','كمامات وأقنعة تنفس','CAT-SAFETY','BOX',FALSE),
 ('SUP-PPE-EAR','سدادات وسماعات أذن','CAT-SAFETY','PAIR',FALSE),
 ('SUP-FIRE-EXT','طفايات حريق وملحقاتها','CAT-SAFETY','PCS',FALSE),
 ('SUP-FIRST-AID','مستلزمات إسعافات أولية','CAT-SAFETY','BOX',TRUE),
 ('SUP-CLEAN-DETERGENT','منظفات صناعية','CAT-CLEAN','L',TRUE),
 ('SUP-CLEAN-DISINFECT','مطهرات','CAT-CLEAN','L',TRUE),
 ('SUP-CLEAN-BROOM','أدوات نظافة','CAT-CLEAN','PCS',FALSE),
 ('SUP-PEST-CONTROL','مستلزمات مكافحة آفات','CAT-CLEAN','L',TRUE),
 ('SUP-WATER-FILTER','فلاتر مياه','CAT-UTIL','PCS',FALSE),
 ('SUP-AIR-FILTER','فلاتر هواء','CAT-UTIL','PCS',FALSE),
 ('SUP-PIPE','مواسير ووصلات مرافق','CAT-UTIL','M',FALSE),
 ('SUP-VALVE','محابس وصمامات','CAT-UTIL','PCS',FALSE),
 ('SUP-PUMP-SEAL','مستلزمات طلمبات','CAT-UTIL','PCS',FALSE),
 ('SUP-OFF-PAPER','ورق تصوير وطباعة','CAT-ADMIN','REAM',FALSE),
 ('SUP-OFF-TONER','أحبار وتونر','CAT-ADMIN','PCS',FALSE),
 ('SUP-OFF-STATIONERY','أدوات مكتبية','CAT-ADMIN','BOX',FALSE),
 ('SUP-IT-CABLE','كابلات وملحقات شبكات','CAT-IT','PCS',FALSE),
 ('SUP-IT-UPS-BAT','بطاريات UPS','CAT-IT','PCS',FALSE),
 ('SUP-IT-STORAGE','وسائط تخزين','CAT-IT','PCS',FALSE),
 ('SUP-IT-PERIPHERAL','ملحقات حاسب وطابعات','CAT-IT','PCS',FALSE),
 ('SUP-VEH-TIRE','إطارات','CAT-TRANSPORT','PCS',FALSE),
 ('SUP-VEH-BATTERY','بطاريات سيارات','CAT-TRANSPORT','PCS',FALSE),
 ('SUP-VEH-FILTER','فلاتر سيارات','CAT-TRANSPORT','PCS',FALSE),
 ('SUP-VEH-SPARE','قطع غيار سيارات','CAT-TRANSPORT','PCS',FALSE),
 ('SUP-VEH-TOOLS','عدد وأدوات ورشة سيارات','CAT-TRANSPORT','SET',FALSE)
)
INSERT INTO items(code,name_ar,category_id,base_unit_id,tracks_lot,tracks_expiry)
SELECT s.code,s.name_ar,c.id,u.id,FALSE,s.expiry
FROM seed s JOIN item_categories c ON c.code=s.cat JOIN units_of_measure u ON u.code=s.unit
ON CONFLICT(code) DO UPDATE SET name_ar=EXCLUDED.name_ar,category_id=EXCLUDED.category_id,
 base_unit_id=EXCLUDED.base_unit_id,tracks_expiry=EXCLUDED.tracks_expiry,is_active=TRUE;

CREATE TABLE IF NOT EXISTS asset_categories (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
 code VARCHAR(40) NOT NULL UNIQUE,
 name_ar VARCHAR(160) NOT NULL,
 asset_type VARCHAR(30) NOT NULL CHECK(asset_type IN ('PRODUCTION_LINE','MACHINE','VEHICLE','UTILITY','IT','OTHER')),
 default_useful_life_years NUMERIC(5,2) NOT NULL DEFAULT 5 CHECK(default_useful_life_years>0),
 depreciation_method VARCHAR(20) NOT NULL DEFAULT 'STRAIGHT_LINE'
   CHECK(depreciation_method IN ('STRAIGHT_LINE','DECLINING_BALANCE','UNDEPRECIATED')),
 is_depreciable BOOLEAN NOT NULL DEFAULT TRUE,
 is_active BOOLEAN NOT NULL DEFAULT TRUE,
 description TEXT
);
ALTER TABLE fixed_assets ADD COLUMN IF NOT EXISTS asset_category_id UUID REFERENCES asset_categories(id) ON DELETE RESTRICT;
ALTER TABLE fixed_assets ADD COLUMN IF NOT EXISTS barcode VARCHAR(100);
ALTER TABLE fixed_assets ADD COLUMN IF NOT EXISTS depreciation_start_date DATE;
ALTER TABLE fixed_assets ADD COLUMN IF NOT EXISTS useful_life_years NUMERIC(5,2) CHECK(useful_life_years IS NULL OR useful_life_years>0);
ALTER TABLE fixed_assets ADD COLUMN IF NOT EXISTS residual_value NUMERIC(18,6) NOT NULL DEFAULT 0 CHECK(residual_value>=0);
ALTER TABLE fixed_assets ADD COLUMN IF NOT EXISTS accumulated_depreciation NUMERIC(18,6) NOT NULL DEFAULT 0 CHECK(accumulated_depreciation>=0);
ALTER TABLE fixed_assets ADD COLUMN IF NOT EXISTS department_id UUID REFERENCES departments(id) ON DELETE RESTRICT;
ALTER TABLE fixed_assets ADD COLUMN IF NOT EXISTS custodian_employee_id UUID REFERENCES employees(id) ON DELETE RESTRICT;
CREATE UNIQUE INDEX IF NOT EXISTS uq_fixed_assets_barcode ON fixed_assets(barcode) WHERE barcode IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_fixed_assets_category ON fixed_assets(asset_category_id);

INSERT INTO asset_categories(code,name_ar,asset_type,default_useful_life_years) VALUES
 ('AST-LAND','الأراضي','OTHER',0.01),
 ('AST-BUILD','المباني والمنشآت','OTHER',30),
 ('AST-WAREHOUSE','المخازن والهناجر','OTHER',25),
 ('AST-ADMIN-BUILD','المباني الإدارية','OTHER',25),
 ('AST-PROD-LINE','خطوط إنتاج الأعلاف','PRODUCTION_LINE',15),
 ('AST-GRINDER','مطاحن ومجارش','MACHINE',10),
 ('AST-MIXER','خلاطات الأعلاف','MACHINE',12),
 ('AST-PELLET','مكابس التحبيب','MACHINE',12),
 ('AST-COOLER','مبردات ومفتتات','MACHINE',10),
 ('AST-SIFTER','غرابيل ومناخل','MACHINE',10),
 ('AST-CONVEYOR','سيور وناقلات','MACHINE',10),
 ('AST-ELEVATOR','رافعات وناقلات رأسية','MACHINE',12),
 ('AST-SCALE','موازين جرعات وتعبئة','MACHINE',8),
 ('AST-BAGGER','ماكينات تعبئة وخياطة','MACHINE',8),
 ('AST-BOILER','غلايات ومولدات بخار','UTILITY',15),
 ('AST-GENERATOR','مولدات كهرباء','UTILITY',12),
 ('AST-COMPRESSOR','ضواغط هواء','UTILITY',10),
 ('AST-TRANSFORMER','محولات ولوحات توزيع','UTILITY',20),
 ('AST-HVAC','تكييف وتهوية','UTILITY',10),
 ('AST-FIRE','أنظمة مكافحة الحريق','UTILITY',10),
 ('AST-WATER','محطات وخزانات مياه','UTILITY',15),
 ('AST-WASTE','أنظمة معالجة الصرف والمخلفات','UTILITY',15),
 ('AST-LAB','أجهزة المعمل والجودة','MACHINE',7),
 ('AST-FORKLIFT','أوناش شوكية ومعدات مناولة','VEHICLE',8),
 ('AST-TRUCK','شاحنات وسيارات نقل','VEHICLE',8),
 ('AST-CAR','سيارات إدارية','VEHICLE',5),
 ('AST-MOTORCYCLE','دراجات ومركبات خفيفة','VEHICLE',5),
 ('AST-SERVER','خوادم ومعدات مراكز البيانات','IT',5),
 ('AST-COMPUTER','أجهزة حاسب مكتبية ومحمولة','IT',4),
 ('AST-PRINTER','طابعات وماسحات ضوئية','IT',4),
 ('AST-NETWORK','شبكات وسويتشات وراوترات','IT',5),
 ('AST-CCTV','كاميرات وأنظمة مراقبة','IT',5),
 ('AST-SOFTWARE','برامج وتراخيص وأنظمة','IT',3),
 ('AST-OFFICE-FURN','أثاث وتجهيزات مكتبية','OTHER',7),
 ('AST-OFFICE-EQUIP','أجهزة مكتبية','OTHER',5),
 ('AST-TOOLS','عدد وأدوات ومعدات يدوية','OTHER',5),
 ('AST-MOLDS','قوالب واسطمبات ومعدات خاصة','MACHINE',7),
 ('AST-SECURITY','بوابات وأنظمة أمن','OTHER',8),
 ('AST-LEASEHOLD','تحسينات وتجهيزات مبانٍ مستأجرة','OTHER',5),
 ('AST-OTHER','أصول ثابتة أخرى','OTHER',5)
ON CONFLICT(code) DO UPDATE SET name_ar=EXCLUDED.name_ar,asset_type=EXCLUDED.asset_type,
 default_useful_life_years=EXCLUDED.default_useful_life_years,is_active=TRUE;

INSERT INTO permissions(code,name_ar,module_code) VALUES
 ('ASSET_CATEGORIES.READ','عرض تصنيفات الأصول','ASSETS'),
 ('ASSET_CATEGORIES.MANAGE','إدارة تصنيفات الأصول','ASSETS'),
 ('ASSETS.BARCODE.MANAGE','إدارة باركود الأصول','ASSETS')
ON CONFLICT(code) DO NOTHING;
