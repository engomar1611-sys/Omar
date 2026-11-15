-- 023: card terminal transaction metadata and Egyptian bank directory.
CREATE TABLE IF NOT EXISTS payment_banks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code VARCHAR(40) NOT NULL UNIQUE,
  name_ar VARCHAR(180) NOT NULL,
  name_en VARCHAR(180) NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
INSERT INTO payment_banks(code,name_ar,name_en) VALUES
 ('CBE','البنك المركزي المصري','Central Bank of Egypt'),
 ('AAIB','البنك العربي الأفريقي الدولي','Arab African International Bank'),
 ('ARB','البنك العربي','Arab Bank'),
 ('BDC','بنك القاهرة','Banque du Caire'),
 ('BM','بنك مصر','Banque Misr'),
 ('ALEX','بنك الإسكندرية','Bank of Alexandria'),
 ('CIB','البنك التجاري الدولي','Commercial International Bank'),
 ('EGB','البنك المصري الخليجي','Egyptian Gulf Bank'),
 ('NBE','البنك الأهلي المصري','National Bank of Egypt'),
 ('QNB','بنك قطر الوطني الأهلي','QNB Alahli'),
 ('SAIB','بنك الشركة المصرفية العربية الدولية','Societe Arabe Internationale de Banque'),
 ('EBE','بنك تنمية الصادرات','Export Development Bank of Egypt'),
 ('AIB','البنك العربي الدولي','Arab International Bank'),
 ('FIBE','بنك فيصل الإسلامي المصري','Faisal Islamic Bank of Egypt'),
 ('ABK','البنك الأهلي الكويتي - مصر','Al Ahli Bank of Kuwait Egypt'),
 ('HDB','بنك التعمير والإسكان','Housing and Development Bank'),
 ('NBK','بنك الكويت الوطني - مصر','National Bank of Kuwait Egypt'),
 ('EALB','البنك العقاري المصري العربي','Egyptian Arab Land Bank'),
 ('SCB','بنك قناة السويس','Suez Canal Bank'),
 ('AUB','البنك الأهلي المتحد','Ahli United Bank'),
 ('UB','المصرف المتحد','The United Bank'),
 ('HSBC','إتش إس بي سي مصر','HSBC Bank Egypt'),
 ('ADCB','أبوظبي التجاري - مصر','Abu Dhabi Commercial Bank Egypt'),
 ('FABM','بنك أبوظبي الأول مصر','First Abu Dhabi Bank Misr'),
 ('CITI','سيتي بنك مصر','Citibank Egypt'),
 ('CAE','كريدي أجريكول مصر','Credit Agricole Egypt'),
 ('MASHREQ','بنك المشرق مصر','Mashreq Egypt'),
 ('ENBD','الإمارات دبي الوطني مصر','Emirates NBD Egypt'),
 ('NXT','بنك NXT','Bank NXT'),
 ('ABC','بنك المؤسسة العربية المصرفية','Arab Banking Corporation'),
 ('MID','ميد بنك','MIDBANK'),
 ('IDB','بنك التنمية الصناعية','Industrial Development Bank'),
 ('ADIB','مصرف أبوظبي الإسلامي - مصر','Abu Dhabi Islamic Bank Egypt'),
 ('ALBARAKA','بنك البركة مصر','Al Baraka Bank Egypt'),
 ('ATTIJARI','التجاري وفا بنك مصر','Attijariwafa Bank Egypt'),
 ('AGRI','البنك الزراعي المصري','Agricultural Bank of Egypt')
ON CONFLICT(code) DO UPDATE SET name_ar=EXCLUDED.name_ar,name_en=EXCLUDED.name_en,is_active=TRUE;

ALTER TABLE sale_payments ADD COLUMN IF NOT EXISTS bank_id UUID REFERENCES payment_banks(id);
ALTER TABLE sale_payments ADD COLUMN IF NOT EXISTS transaction_reference VARCHAR(100);
ALTER TABLE sale_payments ADD COLUMN IF NOT EXISTS card_last_four VARCHAR(4);
ALTER TABLE sale_payments ADD COLUMN IF NOT EXISTS terminal_amount NUMERIC(20,6);
ALTER TABLE sale_payments ADD COLUMN IF NOT EXISTS terminal_captured_at TIMESTAMPTZ;
CREATE INDEX IF NOT EXISTS ix_sale_payments_transaction_reference ON sale_payments(transaction_reference) WHERE transaction_reference IS NOT NULL;
