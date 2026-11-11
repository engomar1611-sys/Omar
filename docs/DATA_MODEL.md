# نموذج البيانات الأولي — NEW FEED ERP

هذا نموذج نطاقي مبدئي؛ أسماء الجداول والحقول النهائية تخضع للتصميم التفصيلي ومراجعة القيود.

## البيانات الأساسية
- companies, plants, warehouses, warehouse_locations
- users, roles, permissions, user_roles, role_permissions
- units_of_measure, unit_conversions
- item_categories, items, item_units
- feed_types (ديناميكي)، product_families, finished_products
- suppliers, customers, carriers, vehicles, employees
- cost_centers, chart_of_accounts, fiscal_years, fiscal_periods

## المشتريات والمخزون
- purchase_requests, purchase_request_lines
- supplier_quotes, purchase_orders, purchase_order_lines
- goods_receipts, goods_receipt_lines
- supplier_invoices, supplier_invoice_lines, supplier_returns
- stock_lots, inventory_balances, inventory_reservations
- inventory_transactions, inventory_transaction_lines
- stock_counts, stock_count_lines, stock_transfers
- quality_holds

## التركيبات والإنتاج
- formulations, formulation_versions, formulation_lines
- nutrition_specs, formulation_approvals
- production_orders, production_order_inputs, production_order_outputs
- production_steps, production_consumptions, production_losses
- production_lots, batch_genealogy
- machine_assets, production_line_configs, downtime_events

## الجودة
- quality_plans, quality_tests, quality_test_results
- samples, inspection_lots, nonconformance_reports
- release_approvals, certificates_of_analysis

## المبيعات والتوزيع
- sales_quotes, sales_orders, sales_order_lines
- delivery_orders, delivery_lines, shipment_runs
- sales_invoices, sales_invoice_lines, customer_returns
- receipts, receipt_allocations, customer_credit_limits

## الحسابات والتكاليف
- journal_entries, journal_lines
- cash_accounts, bank_accounts, cash_receipts, cash_payments
- supplier_payment_allocations, customer_receipt_allocations
- cost_centers, cost_elements, overhead_allocations
- product_cost_runs, production_cost_details, inventory_valuations
- fixed_assets, depreciation_runs

## الصيانة والحوكمة
- maintenance_work_orders, preventive_maintenance_plans, spare_parts
- approval_workflows, approval_steps, approval_actions
- attachments, audit_logs, notifications
- system_settings, integration_events, migration_history

## علاقات وضوابط أساسية
- كل صنف مخزني له وحدة أساسية وتحويلات وحدات معتمدة.
- كل دفعة خامة/منتج نهائي لها رقم تشغيلة ومصدر وتواريخ مهمة وحالة جودة.
- كل حركة مخزون تشير إلى مستند مصدر وسطور المصدر، وتُرحّل مرة واحدة فقط.
- كل أمر إنتاج يشير إلى نسخة تركيبة ثابتة، ويحتفظ بالكميات المخططة والفعلية.
- كل فاتورة أو سند مالي مرحّل ينتج قيوداً متوازنة مرتبطة بالمستند.
- المرتجع لا يعيد الكمية إلى المتاح للبيع قبل الفحص والاعتماد.
- لا تحذف السجلات المالية أو المخزنية المرحّلة؛ استخدم مستندات عكسية مترابطة.
- جميع الكميات والأموال تستخدم أنواعاً عشرية دقيقة، مع قواعد تقريب محددة.

## عناصر تحتاج تفصيلاً
تحديد استراتيجية costing، تعدد المخازن والمواقع، إدارة الصلاحية، الأبعاد المحاسبية، سياسة الاحتفاظ بسجل التغييرات، وحجم البيانات المتوقع.
