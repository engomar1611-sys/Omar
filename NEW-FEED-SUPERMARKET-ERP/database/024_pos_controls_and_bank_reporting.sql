-- 024: POS discount/void controls and bank transaction reporting.
INSERT INTO permissions(code,description) VALUES
 ('bank.report','عرض تقرير عمليات البطاقات والبنوك'),
 ('sales.void.invoice','إلغاء فاتورة بيع مكتملة مع عكس المخزون والقيد'),
 ('sales.void.line','طلب إلغاء/استرجاع صنف من فاتورة مكتملة')
ON CONFLICT(code) DO NOTHING;

INSERT INTO role_permissions(role_id,permission_id)
SELECT r.id,p.id FROM roles r CROSS JOIN permissions p
WHERE r.code='SUPER_ADMIN' AND p.code IN ('bank.report','sales.void.invoice','sales.void.line')
ON CONFLICT DO NOTHING;

INSERT INTO role_permissions(role_id,permission_id)
SELECT r.id,p.id FROM roles r CROSS JOIN permissions p
WHERE r.code IN ('ACCOUNTANT','BRANCH_MANAGER') AND p.code='bank.report'
ON CONFLICT DO NOTHING;

-- Complete the CBE-listed 36-bank IPN directory already used by POS bank search.
-- CBE source: https://www.cbe.org.eg/en/payment-systems-and-services/instant-payment-network
INSERT INTO payment_banks(code,name_ar,name_en) VALUES
 ('AIBANK','بنك الاستثمار العربي','Arab Investment Bank'),
 ('BLOM','بنك بلوم مصر','BLOM Bank Egypt'),
 ('AUDI','بنك عوده مصر','Bank Audi Egypt'),
 ('NBG','بنك الإسكندرية الوطني اليوناني','National Bank of Greece Egypt')
ON CONFLICT(code) DO UPDATE SET name_ar=EXCLUDED.name_ar,name_en=EXCLUDED.name_en,is_active=true;
