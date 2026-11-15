# NEW FEED ERP — Module Gap Audit
Date: 2026-11-16
Base: main @ 75cf20a2699bc077d5feff824ae5960b1ba9cd35

## Scope and method
This audit compares docs/REQUIREMENTS.md with the registered backend routes and current migrations in the main branch. A module is considered implemented only to the extent evidenced by routes and database support; this is not a factory UAT sign-off.

## Confirmed implemented foundations
- Identity, users, roles, permissions, sessions and login throttling.
- Master data: suppliers, customers, items, units/conversions, categories, barcodes, warehouses/locations, feed types and feed products.
- Purchasing requests, purchase orders, goods receipts and raw-material quality inspection.
- Inventory balances/movements, weighted-average cost, adjustments, transfers, cycle counts and source-linked quality holds.
- Formulations with approval and material requirements.
- Production orders, work centers/scheduling, material issue/reversal, completion, process loss and production-cost components.
- Sales invoices, receipts/allocations, sales returns, supplier payments/returns and delivery dispatch/confirmation.
- General ledger, trial balance, periods/locking, expenses, supplier/customer statements and aging, income statement, balance sheet, cost centers.
- HR employee records, shifts, attendance, leave, advances and payroll.
- Maintenance assets, plans, work orders, parts, downtime and costing.
- Printing assets, item/asset barcode printing and sales invoice rendering.
- Windows employee app and Windows server installer build workflows.

## Missing or materially incomplete against requirements

### P0 — Core commercial workflows
1. Sales quotations and sales orders are not exposed as separate resources. Current sales API has invoices and deliveries, but no quotation/order lifecycle, approval, stock reservation, conversion to invoice, or order-level fulfillment balance.
2. Supplier quotation collection/comparison is absent. Purchase requests can be approved and converted, but no supplier RFQ, quotation entry, comparison matrix, or award workflow is exposed.
3. Purchase invoice matching is incomplete as a distinct workflow. Goods receipts and purchase orders exist, but a supplier invoice register, three-way match (PO/receipt/invoice), additional landed-cost allocation, and invoice/payment reconciliation are not evidenced as a complete module.

### P1 — Factory operations and quality
4. Transportation/distribution management is absent as a separate module: vehicles, drivers, trip planning, load manifests, route/transport cost, fuel/maintenance linkage and delivery proof.
5. Quality is partial. Receiving quality and finished-goods inspection exist, but configurable sampling plans, in-process checks, laboratory measurements/specifications, certificates of analysis, and per-feed-product acceptance limits are not evidenced as complete workflows.
6. Production stage tracking and actual machine/scale data integration are incomplete. Work centers and scheduling exist, but no verified machine telemetry, weighbridge/scale integration, stage-by-stage execution capture or downtime linkage from production events is evidenced.
7. Production costing supports selected components (labor, energy, overhead, packaging, waste), but no complete evidence of actual consumption capture for labor-hours, energy meter readings, packaging quantities, by-product valuation, or variance close-out by batch.

### P1 — Finance and controls
8. Treasury/banking is incomplete as a standalone workflow: no evidenced bank-account master, bank statement import, bank reconciliation, cheque register, cash transfer workflow or bank fee/interest posting.
9. The general-ledger and core statements exist, but a full subledger-to-GL reconciliation dashboard and controlled month-end checklist are not evidenced.
10. Document attachments and controlled document versioning are not evidenced as a common capability across purchase, quality, production, sales and maintenance records.

### P2 — HR and administration
11. Attendance exists as manually recorded entries; biometric/time-clock integration and shift exception/late/absence automation are not evidenced.
12. Payroll exists, but statutory/local payroll rules, configurable earning/deduction components, social insurance/tax handling and payslip delivery require business-policy confirmation and acceptance tests.
13. Dashboard/KPI pages and role-specific operational work queues need acceptance review; route existence alone does not establish complete operational dashboards.

## Cross-cutting acceptance gaps
- Trusted HTTPS certificate, DNS/Caddy installation and employee-device trust remain deployment tasks.
- Authenticode signing and a tested rollback path remain open.
- Real Windows Server/client install, upgrade and uninstall tests remain open.
- Printer, barcode scanner, weighing scale and other factory peripherals remain untested on target hardware.
- Backup restore must be demonstrated against a separate database/server.
- End-to-end factory UAT, 10–30 concurrent users, permissions by role, inventory/GL reconciliation and full reversal scenarios remain open.

## Build pipeline status at audit time
For main commit 75cf20a2699bc077d5feff824ae5960b1ba9cd35:
- Backend CI run 43766391134: success. PostgreSQL 16 migrations, first-admin bootstrap, unit/integration tests, API container and Windows test bundle all completed successfully.
- Windows Installers run 43766391169: success. Desktop tests, full source package, employee EXE build, server EXE build and both artifact uploads completed successfully.
- These are automated build/test results, not field installation or factory acceptance.

## Recommended implementation order
1. Sales quotations/orders + reservations + delivery allocation + invoice conversion, with full inventory/GL regression tests.
2. Supplier RFQ/quotations + comparison/award + PO conversion; then supplier invoice matching and landed-cost allocation.
3. Treasury/bank accounts + receipts/payments + bank reconciliation.
4. Quality sampling plans + in-process/lab results + certificates of analysis + product-specific specifications.
5. Fleet/trips/load manifests/transport costs linked to delivery.
6. Production stage execution, actual labor/energy/packaging capture and equipment integrations.
7. Common attachments/versioning, operational dashboards, and HR statutory rules after owner policy confirmation.

## Audit limitations
This document records route/schema evidence from main. It does not assert that every existing workflow is defect-free. The next engineering pass must review each posting path for locked-period enforcement, idempotency, reversals, source-document traceability, held-stock exclusion and subledger/GL consistency, then add regression coverage before merging fixes.
