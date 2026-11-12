import test from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import { buildApp } from '../src/app.mjs';

const enabled = Boolean(process.env.DATABASE_URL && process.env.BOOTSTRAP_ADMIN_USERNAME && process.env.BOOTSTRAP_ADMIN_PASSWORD);

test('PostgreSQL production workflow: formulation, FEFO, actual costing and finished-goods release', { skip: !enabled }, async () => {
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
  const app = buildApp({ logger: false, db: pool, jwtSecret: process.env.AUTH_JWT_SECRET });
  const suffix = Date.now().toString();
  const code = (prefix) => (prefix + suffix).slice(0, 40);
  try {
    const login = await app.inject({
      method: 'POST', url: '/api/v1/auth/login',
      payload: { username: process.env.BOOTSTRAP_ADMIN_USERNAME, password: process.env.BOOTSTRAP_ADMIN_PASSWORD }
    });
    assert.equal(login.statusCode, 200, login.body);
    const headers = { authorization: 'Bearer ' + login.json().accessToken, 'content-type': 'application/json' };
    const userId = login.json().user.id;

    const company = (await pool.query('INSERT INTO companies(code,name_ar) VALUES($1,$2) RETURNING id',[code('ITC'), 'شركة اختبار تكامل'])).rows[0];
    const plant = (await pool.query('INSERT INTO plants(company_id,code,name_ar) VALUES($1,$2,$3) RETURNING id',[company.id,code('PL'), 'مصنع اختبار'])).rows[0];
    const warehouse = (await pool.query('INSERT INTO warehouses(plant_id,code,name_ar) VALUES($1,$2,$3) RETURNING id',[plant.id,code('WH'), 'مخزن اختبار'])).rows[0];
    const uom = (await pool.query('INSERT INTO units_of_measure(code,name_ar) VALUES($1,$2) RETURNING id',[code('KG'), 'كيلوجرام'])).rows[0];
    const rawCategory = (await pool.query("INSERT INTO item_categories(code,name_ar,category_kind) VALUES($1,$2,'RAW_MATERIAL') RETURNING id",[code('RAW'), 'خامة اختبار'])).rows[0];
    const fgCategory = (await pool.query("INSERT INTO item_categories(code,name_ar,category_kind) VALUES($1,$2,'FINISHED_GOOD') RETURNING id",[code('FG'), 'منتج نهائي اختبار'])).rows[0];
    const raw = (await pool.query('INSERT INTO items(code,name_ar,category_id,base_unit_id,tracks_lot,tracks_expiry) VALUES($1,$2,$3,$4,TRUE,TRUE) RETURNING id',[code('CORN'), 'ذرة اختبار',rawCategory.id,uom.id])).rows[0];
    const finished = (await pool.query('INSERT INTO items(code,name_ar,category_id,base_unit_id,tracks_lot) VALUES($1,$2,$3,$4,TRUE) RETURNING id',[code('FEED'), 'علف اختبار',fgCategory.id,uom.id])).rows[0];
    const feedType = (await pool.query('INSERT INTO feed_types(code,name_ar) VALUES($1,$2) RETURNING id',[code('POULTRY'), 'دواجن اختبار'])).rows[0];
    const product = (await pool.query('INSERT INTO feed_products(code,name_ar,feed_type_id,item_id) VALUES($1,$2,$3,$4) RETURNING id',[code('P'), 'علف تسمين اختبار',feedType.id,finished.id])).rows[0];

    await pool.query(`INSERT INTO inventory_balances(warehouse_id,item_id,lot_no,expiry_date,quantity,average_unit_cost,quality_status)
      VALUES($1,$2,'EARLY',$3,3,5,'RELEASED'),($1,$2,'LATE',$4,20,7,'RELEASED')`,
      [warehouse.id,raw.id,'2026-12-01','2027-01-01']);

    const adjustment = await app.inject({method:'POST',url:'/api/v1/inventory/adjustments',headers,payload:{
      adjustmentNo:code('ADJ'),warehouseId:warehouse.id,reason:'مطابقة جرد اختبار',
      lines:[{itemId:finished.id,lotNo:'ADJLOT-'+suffix,quantityDelta:2,unitCost:8}]
    }});
    assert.equal(adjustment.statusCode,201,adjustment.body);
    const adjustmentId=adjustment.json().id;
    const draftBalances=await pool.query('SELECT quantity FROM inventory_balances WHERE warehouse_id=$1 AND item_id=$2 AND lot_no=$3',[warehouse.id,finished.id,'ADJLOT-'+suffix]);
    assert.equal(draftBalances.rowCount,0,'draft adjustment must not mutate stock');
    const adjustmentList=await app.inject({method:'GET',url:'/api/v1/inventory/adjustments',headers});
    assert.equal(adjustmentList.statusCode,200,adjustmentList.body);
    assert.ok(adjustmentList.json().some(x=>x.id===adjustmentId&&x.lines.length===1));
    const approvedAdjustment=await app.inject({method:'POST',url:'/api/v1/inventory/adjustments/'+adjustmentId+'/approve',headers,payload:{}});
    assert.equal(approvedAdjustment.statusCode,200,approvedAdjustment.body);
    assert.equal(approvedAdjustment.json().status,'POSTED');
    const postedBalance=await pool.query('SELECT quantity,quality_status FROM inventory_balances WHERE warehouse_id=$1 AND item_id=$2 AND lot_no=$3',[warehouse.id,finished.id,'ADJLOT-'+suffix]);
    assert.equal(Number(postedBalance.rows[0].quantity),2);
    assert.equal(postedBalance.rows[0].quality_status,'PENDING_QC');

    const formulation = await app.inject({method:'POST',url:'/api/v1/formulations',headers,payload:{
      feedProductId:product.id,versionNo:1,lines:[{itemId:raw.id,percentage:100}]
    }});
    assert.equal(formulation.statusCode,201,formulation.body);
    const formulationId = formulation.json().id;
    const submitted = await app.inject({method:'POST',url:'/api/v1/formulations/'+formulationId+'/submit',headers,payload:{}});
    assert.equal(submitted.statusCode,200,submitted.body);
    const approved = await app.inject({method:'POST',url:'/api/v1/formulations/'+formulationId+'/approve',headers,payload:{}});
    assert.equal(approved.statusCode,200,approved.body);

    const created = await app.inject({method:'POST',url:'/api/v1/production/orders',headers,payload:{
      orderNo:code('PO'),feedProductId:product.id,formulationId,warehouseId:warehouse.id,plannedQty:10
    }});
    assert.equal(created.statusCode,201,created.body);
    const orderId = created.json().id;
    const released = await app.inject({method:'POST',url:'/api/v1/production/orders/'+orderId+'/release',headers,payload:{}});
    assert.equal(released.statusCode,200,released.body);
    const completed = await app.inject({method:'POST',url:'/api/v1/production/orders/'+orderId+'/complete',headers,payload:{actualQty:10,outputLotNo:code('LOT')}});
    assert.equal(completed.statusCode,200,completed.body);

    const consumed = await pool.query('SELECT lot_no,quantity FROM production_consumptions WHERE production_order_id=$1 ORDER BY lot_no',[orderId]);
    assert.deepEqual(consumed.rows.map(x=>[x.lot_no,Number(x.quantity)]),[['EARLY',3],['LATE',7]]);
    const rawBalances = await pool.query('SELECT lot_no,quantity FROM inventory_balances WHERE warehouse_id=$1 AND item_id=$2 ORDER BY lot_no',[warehouse.id,raw.id]);
    assert.deepEqual(rawBalances.rows.map(x=>[x.lot_no,Number(x.quantity)]),[['EARLY',0],['LATE',13]]);

    const costs = await app.inject({method:'POST',url:'/api/v1/production/orders/'+orderId+'/costs',headers,payload:{
      components:[{componentCode:'LABOR',description:'أجور اختبار',amount:10},{componentCode:'ENERGY',description:'طاقة اختبار',amount:2},{componentCode:'OVERHEAD',description:'صناعي غير مباشر',amount:3},{componentCode:'PACKAGING',description:'تعبئة',amount:4},{componentCode:'WASTE',description:'هالك',amount:1}]
    }});
    assert.equal(costs.statusCode,200,costs.body);
    assert.equal(Number(costs.json().unit_production_cost),8.4);
    const costJournal = await pool.query("SELECT id,total_debit,total_credit FROM journal_entries WHERE source_type='PRODUCTION_COST' AND source_id=$1 AND status='POSTED'",[orderId]);
    assert.equal(costJournal.rowCount,1);
    assert.equal(Number(costJournal.rows[0].total_debit),20);
    assert.equal(Number(costJournal.rows[0].total_credit),20);
    const costJournalLines = await pool.query('SELECT a.code,SUM(l.debit) debit,SUM(l.credit) credit FROM journal_lines l JOIN gl_accounts a ON a.id=l.account_id WHERE l.journal_entry_id=$1 GROUP BY a.code ORDER BY a.code',[costJournal.rows[0].id]);
    assert.deepEqual(costJournalLines.rows.map(x=>[x.code,Number(x.debit),Number(x.credit)]),[['1200',20,0],['5100',0,10],['5200',0,2],['5300',0,4],['5410',0,4]]);
    const duplicateCosts = await app.inject({method:'POST',url:'/api/v1/production/orders/'+orderId+'/costs',headers,payload:{
      components:[{componentCode:'LABOR',description:'أجور اختبار',amount:10}]
    }});
    assert.equal(duplicateCosts.statusCode,409);
    const productionDetails = await app.inject({method:'GET',url:'/api/v1/production/orders/'+orderId+'/details',headers});
    assert.equal(productionDetails.statusCode,200,productionDetails.body);
    assert.equal(productionDetails.json().order.id,orderId);
    assert.equal(productionDetails.json().consumptions.length,2);
    assert.equal(Number(productionDetails.json().consumptions.reduce((s,x)=>s+Number(x.extended_cost),0)),64);
    assert.equal(productionDetails.json().output.lot_no,completed.json().outputLotNo || (await pool.query('SELECT lot_no FROM production_outputs WHERE production_order_id=$1',[orderId])).rows[0].lot_no);
    assert.equal(productionDetails.json().costComponents.length,5);
    assert.equal(productionDetails.json().journalEntries.length,1);
    assert.equal(productionDetails.json().journalEntries[0].lines.length,6);
    assert.equal(Number(productionDetails.json().journalEntries[0].total_debit),20);

    const failed = await app.inject({method:'POST',url:'/api/v1/production/orders/'+orderId+'/quality',headers,payload:{result:'FAIL',notes:'فشل اختبار'}});
    assert.equal(failed.statusCode,200,failed.body);
    assert.equal(failed.json().availableForSale,false);
    const releasedAgain = await app.inject({method:'POST',url:'/api/v1/production/orders/'+orderId+'/quality',headers,payload:{result:'PASS',notes:'اجتاز إعادة الفحص'}});
    assert.equal(releasedAgain.statusCode,200,releasedAgain.body);
    assert.equal(releasedAgain.json().availableForSale,true);

    const finalBalance = await pool.query('SELECT quantity,average_unit_cost,quality_status FROM inventory_balances WHERE warehouse_id=$1 AND item_id=$2 AND lot_no=$3',[warehouse.id,finished.id,completed.json().outputLotNo || (await pool.query('SELECT lot_no FROM production_outputs WHERE production_order_id=$1',[orderId])).rows[0].lot_no]);
    assert.equal(Number(finalBalance.rows[0].quantity),10);
    assert.equal(Number(finalBalance.rows[0].average_unit_cost),8.4);
    assert.equal(finalBalance.rows[0].quality_status,'RELEASED');

    const productionLoss=await app.inject({method:'POST',url:'/api/v1/production/losses',headers,payload:{
      productionOrderId:orderId,lossType:'DAMAGE',quantity:1,reason:'تلف أثناء التداول — اختبار'
    }});
    assert.equal(productionLoss.statusCode,201,productionLoss.body);
    assert.equal(productionLoss.json().status,'PENDING_APPROVAL');
    const beforeLossApproval=await pool.query('SELECT quantity FROM inventory_balances WHERE warehouse_id=$1 AND item_id=$2 AND lot_no=$3',[warehouse.id,finished.id,finalBalance.rows[0] ? (await pool.query('SELECT lot_no FROM production_outputs WHERE production_order_id=$1',[orderId])).rows[0].lot_no : '']);
    assert.equal(Number(beforeLossApproval.rows[0].quantity),10,'pending loss must not reduce stock');
    const productionLossList=await app.inject({method:'GET',url:'/api/v1/production/losses',headers});
    assert.equal(productionLossList.statusCode,200,productionLossList.body);
    assert.ok(productionLossList.json().some(x=>x.id===productionLoss.json().id));
    const approvedLoss=await app.inject({method:'POST',url:'/api/v1/production/losses/'+productionLoss.json().id+'/approve',headers,payload:{}});
    assert.equal(approvedLoss.statusCode,200,approvedLoss.body);
    assert.equal(approvedLoss.json().status,'POSTED');
    assert.equal(Number(approvedLoss.json().totalCost),8.4);
    const duplicateLossApproval=await app.inject({method:'POST',url:'/api/v1/production/losses/'+productionLoss.json().id+'/approve',headers,payload:{}});
    assert.equal(duplicateLossApproval.statusCode,409);
    const afterLossApproval=await pool.query('SELECT quantity FROM inventory_balances WHERE warehouse_id=$1 AND item_id=$2 AND lot_no=$3',[warehouse.id,finished.id,(await pool.query('SELECT lot_no FROM production_outputs WHERE production_order_id=$1',[orderId])).rows[0].lot_no]);
    assert.equal(Number(afterLossApproval.rows[0].quantity),9);
    const lossJournal=await pool.query("SELECT total_debit,total_credit FROM journal_entries WHERE source_type='PRODUCTION_LOSS' AND source_id=$1",[productionLoss.json().id]);
    assert.equal(lossJournal.rowCount,1);
    assert.equal(Number(lossJournal.rows[0].total_debit),8.4);
    assert.equal(Number(lossJournal.rows[0].total_credit),8.4);
    const lossReport=await app.inject({method:'GET',url:'/api/v1/reports/production-losses',headers});
    assert.equal(lossReport.statusCode,200,lossReport.body);
    const lossReportRow=lossReport.json().find(x=>x.id===productionLoss.json().id);
    assert.ok(lossReportRow);
    assert.equal(lossReportRow.status,'POSTED');
    assert.equal(Number(lossReportRow.posted_loss_value),8.4);
    const detailsAfterLoss=await app.inject({method:'GET',url:'/api/v1/production/orders/'+orderId+'/details',headers});
    assert.equal(detailsAfterLoss.statusCode,200,detailsAfterLoss.body);
    assert.equal(detailsAfterLoss.json().losses.length,1);
    assert.equal(detailsAfterLoss.json().losses[0].entry_no,'J-LOSS-'+productionLoss.json().id.slice(0,12));

    const customer = await app.inject({method:'POST',url:'/api/v1/customers',headers,payload:{code:code('CUS'),nameAr:'عميل اختبار تكامل',creditLimit:0}});
    assert.equal(customer.statusCode,201,customer.body);
    const invoice = await app.inject({method:'POST',url:'/api/v1/sales/invoices',headers,payload:{
      invoiceNo:code('SI'),customerId:customer.json().id,warehouseId:warehouse.id,lines:[{itemId:finished.id,quantity:2,unitPrice:20}]
    }});
    assert.equal(invoice.statusCode,201,invoice.body);
    assert.equal(Number(invoice.json().totalAmount),40);
    const invoiceList = await app.inject({method:'GET',url:'/api/v1/sales/invoices',headers});
    assert.equal(invoiceList.statusCode,200,invoiceList.body);
    const invoiceRow = invoiceList.json().find(x=>x.id===invoice.json().id);
    assert.equal(invoiceRow.lines.length,1);
    assert.equal(Number(invoiceRow.lines[0].quantity),2);

    const delivery = await app.inject({method:'POST',url:'/api/v1/sales/deliveries',headers,payload:{
      deliveryNo:code('DEL'),invoiceId:invoice.json().id,driverName:'سائق اختبار',vehicleNo:'TEST-01',
      lines:[{invoiceLineId:invoiceRow.lines[0].id,quantity:2}]
    }});
    assert.equal(delivery.statusCode,201,delivery.body);
    const deliveryReady = await app.inject({method:'POST',url:'/api/v1/sales/deliveries/'+delivery.json().id+'/ready',headers,payload:{}});
    assert.equal(deliveryReady.statusCode,200,deliveryReady.body);
    const deliveryDispatched = await app.inject({method:'POST',url:'/api/v1/sales/deliveries/'+delivery.json().id+'/dispatch',headers,payload:{}});
    assert.equal(deliveryDispatched.statusCode,200,deliveryDispatched.body);
    const deliveryList = await app.inject({method:'GET',url:'/api/v1/sales/deliveries',headers});
    const deliveryRow = deliveryList.json().find(x=>x.id===delivery.json().id);
    const partialDelivery = await app.inject({method:'POST',url:'/api/v1/sales/deliveries/'+delivery.json().id+'/confirm-delivery',headers,payload:{
      lines:[{lineId:deliveryRow.lines[0].id,deliveredQty:1}]
    }});
    assert.equal(partialDelivery.statusCode,200,partialDelivery.body);
    assert.equal(partialDelivery.json().status,'PARTIALLY_DELIVERED');
    const finalDeliveryList = await app.inject({method:'GET',url:'/api/v1/sales/deliveries',headers});
    const finalDeliveryLine = finalDeliveryList.json().find(x=>x.id===delivery.json().id).lines[0];
    const finalDelivery = await app.inject({method:'POST',url:'/api/v1/sales/deliveries/'+delivery.json().id+'/confirm-delivery',headers,payload:{
      lines:[{lineId:finalDeliveryLine.id,deliveredQty:1}]
    }});
    assert.equal(finalDelivery.statusCode,200,finalDelivery.body);
    assert.equal(finalDelivery.json().status,'DELIVERED');

    const receipt = await app.inject({method:'POST',url:'/api/v1/accounting/receipts',headers,payload:{
      receiptNo:code('RC'),customerId:customer.json().id,amount:10,paymentMethod:'CASH',allocations:[{invoiceId:invoice.json().id,amount:10}]
    }});
    assert.equal(receipt.statusCode,201,receipt.body);
    const invoiceAfterReceipt = await pool.query('SELECT status FROM sales_invoices WHERE id=$1',[invoice.json().id]);
    assert.equal(invoiceAfterReceipt.rows[0].status,'PARTIALLY_PAID');
    const receiptList = await app.inject({method:'GET',url:'/api/v1/accounting/receipts',headers});
    assert.equal(receiptList.statusCode,200,receiptList.body);
    assert.ok(receiptList.json().some(x=>x.id===receipt.json().receipt.id));

    const returnCreated = await app.inject({method:'POST',url:'/api/v1/sales/returns',headers,payload:{
      returnNo:code('SR'),invoiceId:invoice.json().id,warehouseId:warehouse.id,reason:'اختبار مرتجع',
      lines:[{invoiceLineId:invoiceRow.lines[0].id,quantity:1}]
    }});
    assert.equal(returnCreated.statusCode,201,returnCreated.body);
    const warehouseApproved = await app.inject({method:'POST',url:'/api/v1/sales/returns/'+returnCreated.json().id+'/warehouse-approve',headers,payload:{}});
    assert.equal(warehouseApproved.statusCode,200,warehouseApproved.body);
    const accountingApproved = await app.inject({method:'POST',url:'/api/v1/sales/returns/'+returnCreated.json().id+'/accounting-approve',headers,payload:{}});
    assert.equal(accountingApproved.statusCode,200,accountingApproved.body);
    const returnQc = await app.inject({method:'POST',url:'/api/v1/quality/sales-returns/'+returnCreated.json().id+'/inspect',headers,payload:{result:'PASS'}});
    assert.equal(returnQc.statusCode,200,returnQc.body);
    const returnList = await app.inject({method:'GET',url:'/api/v1/sales/returns',headers});
    assert.equal(returnList.statusCode,200,returnList.body);
    assert.ok(returnList.json().some(x=>x.id===returnCreated.json().id));

    const expenseAccounts = await app.inject({method:'GET',url:'/api/v1/accounting/accounts',headers});
    assert.equal(expenseAccounts.statusCode,200,expenseAccounts.body);
    const expenseAccount = expenseAccounts.json().find(x=>x.code==='5400');
    assert.ok(expenseAccount);
    const expense = await app.inject({method:'POST',url:'/api/v1/accounting/expenses',headers,payload:{
      expenseNo:code('EX'),accountId:expenseAccount.id,amount:3,paymentMethod:'CASH',description:'مصروف اختبار تكامل'
    }});
    assert.equal(expense.statusCode,201,expense.body);
    const expenseList = await app.inject({method:'GET',url:'/api/v1/accounting/expenses',headers});
    assert.equal(expenseList.statusCode,200,expenseList.body);
    assert.ok(expenseList.json().some(x=>x.id===expense.json().id));
    for(const reportPath of ['/api/v1/reports/trial-balance','/api/v1/reports/inventory-valuation','/api/v1/reports/production-costs','/api/v1/reports/sales-summary']){
      const report = await app.inject({method:'GET',url:reportPath,headers});
      assert.equal(report.statusCode,200,reportPath+' '+report.body);
      assert.ok(Array.isArray(report.json()),reportPath);
    }

    const supplier = await app.inject({method:'POST',url:'/api/v1/suppliers',headers,payload:{code:code('SUP'),nameAr:'مورد اختبار تكامل'}});
    assert.equal(supplier.statusCode,201,supplier.body);
    const purchase = await app.inject({method:'POST',url:'/api/v1/purchases',headers,payload:{
      orderNo:code('PUR'),supplierId:supplier.json().id,warehouseId:warehouse.id,lines:[{itemId:raw.id,quantity:5,unitCost:4}]
    }});
    assert.equal(purchase.statusCode,201,purchase.body);
    const purchaseApproved = await app.inject({method:'POST',url:'/api/v1/purchases/'+purchase.json().id+'/approve',headers,payload:{}});
    assert.equal(purchaseApproved.statusCode,200,purchaseApproved.body);
    const purchaseList = await app.inject({method:'GET',url:'/api/v1/purchases',headers});
    const purchaseRow = purchaseList.json().find(x=>x.id===purchase.json().id);
    assert.equal(purchaseRow.lines.length,1);
    const goodsReceipt = await app.inject({method:'POST',url:'/api/v1/goods-receipts',headers,payload:{
      receiptNo:code('GR'),purchaseOrderId:purchase.json().id,
      lines:[{purchaseOrderLineId:purchaseRow.lines[0].id,quantity:5,lotNo:'BUYLOT-'+suffix,expiryDate:'2027-03-01'}]
    }});
    assert.equal(goodsReceipt.statusCode,201,goodsReceipt.body);
    const receiptDetails = await app.inject({method:'GET',url:'/api/v1/goods-receipts',headers});
    const goodsReceiptRow = receiptDetails.json().find(x=>x.id===goodsReceipt.json().id);
    const goodsQc = await app.inject({method:'POST',url:'/api/v1/goods-receipts/'+goodsReceipt.json().id+'/quality',headers,payload:{
      inspections:[{receiptLineId:goodsReceiptRow.lines[0].id,acceptedQty:5,rejectedQty:0,result:'PASS'}]
    }});
    assert.equal(goodsQc.statusCode,200,goodsQc.body);
    const supplierPayment = await app.inject({method:'POST',url:'/api/v1/accounting/supplier-payments',headers,payload:{
      paymentNo:code('SP'),supplierId:supplier.json().id,amount:10,paymentMethod:'CASH',allocations:[{purchaseOrderId:purchase.json().id,amount:10}]
    }});
    assert.equal(supplierPayment.statusCode,201,supplierPayment.body);
    const supplierPaymentList = await app.inject({method:'GET',url:'/api/v1/accounting/supplier-payments',headers});
    assert.equal(supplierPaymentList.statusCode,200,supplierPaymentList.body);
    assert.ok(supplierPaymentList.json().some(x=>x.id===supplierPayment.json().id));
    const purchaseReturn = await app.inject({method:'POST',url:'/api/v1/purchases/returns',headers,payload:{
      returnNo:code('PR'),supplierId:supplier.json().id,warehouseId:warehouse.id,reason:'اختبار مردود مشتريات',
      lines:[{itemId:raw.id,lotNo:'BUYLOT-'+suffix,quantity:1}]
    }});
    assert.equal(purchaseReturn.statusCode,201,purchaseReturn.body);
    assert.equal(purchaseReturn.json().status,'PENDING_WAREHOUSE');
    const beforeReturnApproval = await pool.query("SELECT quantity FROM inventory_balances WHERE warehouse_id=$1 AND item_id=$2 AND lot_no=$3",[warehouse.id,raw.id,'BUYLOT-'+suffix]);
    assert.equal(Number(beforeReturnApproval.rows[0].quantity),5);
    const purchaseReturnWarehouse = await app.inject({method:'POST',url:'/api/v1/purchases/returns/'+purchaseReturn.json().returnId+'/warehouse-approve',headers,payload:{}});
    assert.equal(purchaseReturnWarehouse.statusCode,200,purchaseReturnWarehouse.body);
    assert.equal(purchaseReturnWarehouse.json().status,'PENDING_ACCOUNTING');
    const afterWarehouseApproval = await pool.query("SELECT quantity FROM inventory_balances WHERE warehouse_id=$1 AND item_id=$2 AND lot_no=$3",[warehouse.id,raw.id,'BUYLOT-'+suffix]);
    assert.equal(Number(afterWarehouseApproval.rows[0].quantity),4);
    const purchaseReturnAccounting = await app.inject({method:'POST',url:'/api/v1/purchases/returns/'+purchaseReturn.json().returnId+'/accounting-approve',headers,payload:{}});
    assert.equal(purchaseReturnAccounting.statusCode,200,purchaseReturnAccounting.body);
    assert.equal(purchaseReturnAccounting.json().status,'POSTED');
    const duplicatePurchaseReturnApproval = await app.inject({method:'POST',url:'/api/v1/purchases/returns/'+purchaseReturn.json().returnId+'/accounting-approve',headers,payload:{}});
    assert.equal(duplicatePurchaseReturnApproval.statusCode,409);
    const purchaseReturnList = await app.inject({method:'GET',url:'/api/v1/purchases/returns',headers});
    assert.equal(purchaseReturnList.statusCode,200,purchaseReturnList.body);
    assert.ok(purchaseReturnList.json().some(x=>x.id===purchaseReturn.json().returnId));
    const purchaseReturnReversal = await app.inject({method:'POST',url:'/api/v1/purchases/returns/'+purchaseReturn.json().returnId+'/reverse',headers,payload:{reason:'اختبار عكس مردود المشتريات'}});
    assert.equal(purchaseReturnReversal.statusCode,200,purchaseReturnReversal.body);
    const restoredPurchaseLot = await pool.query('SELECT quantity,quality_status FROM inventory_balances WHERE warehouse_id=$1 AND item_id=$2 AND lot_no=$3',[warehouse.id,raw.id,'BUYLOT-'+suffix]);
    assert.equal(Number(restoredPurchaseLot.rows[0].quantity),5);
    assert.equal(restoredPurchaseLot.rows[0].quality_status,'RELEASED');
    const supplierPaymentReversal = await app.inject({method:'POST',url:'/api/v1/accounting/supplier-payments/'+supplierPayment.json().id+'/reverse',headers,payload:{reason:'اختبار عكس سند صرف المورد'}});
    assert.equal(supplierPaymentReversal.statusCode,200,supplierPaymentReversal.body);
    const reversedPayment = await pool.query('SELECT status FROM supplier_payments WHERE id=$1',[supplierPayment.json().id]);
    assert.equal(reversedPayment.rows[0].status,'REVERSED');
    const periods = await app.inject({method:'GET',url:'/api/v1/accounting/periods',headers});
    assert.equal(periods.statusCode,200,periods.body);
    const roleCreated = await app.inject({method:'POST',url:'/api/v1/admin/roles',headers,payload:{
      code:code('SALES_CLERK').toUpperCase(),nameAr:'موظف مبيعات اختبار',permissionCodes:['SALES.READ','SALES.MANAGE']
    }});
    assert.equal(roleCreated.statusCode,201,roleCreated.body);
    const permissions = await app.inject({method:'GET',url:'/api/v1/admin/permissions',headers});
    assert.equal(permissions.statusCode,200,permissions.body);
    const managedUser = await app.inject({method:'POST',url:'/api/v1/admin/users',headers,payload:{
      username:code('sales.user').toLowerCase(),displayName:'موظف مبيعات اختبار',password:'test-password-123456789',roleIds:[roleCreated.json().id]
    }});
    assert.equal(managedUser.statusCode,201,managedUser.body);
    const usersList = await app.inject({method:'GET',url:'/api/v1/admin/users',headers});
    assert.equal(usersList.statusCode,200,usersList.body);
    assert.ok(usersList.json().some(x=>x.id===managedUser.json().id));
    const roleList = await app.inject({method:'GET',url:'/api/v1/admin/roles',headers});
    assert.equal(roleList.statusCode,200,roleList.body);
    const employeeLogin = await app.inject({method:'POST',url:'/api/v1/auth/login',payload:{username:managedUser.json().username,password:'test-password-123456789'}});
    assert.equal(employeeLogin.statusCode,200,employeeLogin.body);
    const employeeHeaders={authorization:'Bearer '+employeeLogin.json().accessToken,'content-type':'application/json'};
    const employeeMe=await app.inject({method:'GET',url:'/api/v1/auth/me',headers:employeeHeaders});
    assert.equal(employeeMe.statusCode,200,employeeMe.body);
    assert.ok(employeeMe.json().permissions.includes('SALES.MANAGE'));
    const rolePermissionUpdate=await app.inject({method:'PUT',url:'/api/v1/admin/roles/'+roleCreated.json().id+'/permissions',headers,payload:{permissionCodes:['SALES.READ']}});
    assert.equal(rolePermissionUpdate.statusCode,200,rolePermissionUpdate.body);
    const updatedMe=await app.inject({method:'GET',url:'/api/v1/auth/me',headers:employeeHeaders});
    assert.deepEqual(updatedMe.json().permissions,['SALES.READ']);
    const reset=await app.inject({method:'POST',url:'/api/v1/admin/users/'+managedUser.json().id+'/reset-password',headers,payload:{password:'another-test-password-123456'}});
    assert.equal(reset.statusCode,200,reset.body);
    const revokedSession=await app.inject({method:'GET',url:'/api/v1/auth/me',headers:employeeHeaders});
    assert.equal(revokedSession.statusCode,401);
    const selfDeactivate=await app.inject({method:'PUT',url:'/api/v1/admin/users/'+userId+'/status',headers,payload:{active:false}});
    assert.equal(selfDeactivate.statusCode,409);
    assert.equal(userId.length,36);
  } finally {
    await app.close();
    await pool.end();
  }
});
