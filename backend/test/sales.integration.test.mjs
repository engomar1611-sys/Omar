import test from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import { buildApp } from '../src/app.mjs';

const enabled = Boolean(
  process.env.DATABASE_URL &&
  process.env.BOOTSTRAP_ADMIN_USERNAME &&
  process.env.BOOTSTRAP_ADMIN_PASSWORD
);

test('PostgreSQL sales workflow: discounted invoice, collection allocation, partial delivery and two-stage return approval with per-return quality isolation', { skip: !enabled }, async () => {
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
  const tracedDb = {
    query: (...args) => pool.query(...args),
    connect: async () => {
      const client = await pool.connect();
      return {
        query: async (...args) => {
          try { return await client.query(...args); }
          catch (error) {
            console.error('SALES_INTEGRATION_SQL_ERROR', error.code, error.message, args[0]);
            throw error;
          }
        },
        release: () => client.release()
      };
    }
  };
  const app = buildApp({ logger: false, db: tracedDb, jwtSecret: process.env.AUTH_JWT_SECRET });
  const suffix = Date.now().toString();
  const code = (prefix) => (prefix + suffix).slice(0, 40);
  try {
    const login = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: {
        username: process.env.BOOTSTRAP_ADMIN_USERNAME,
        password: process.env.BOOTSTRAP_ADMIN_PASSWORD
      }
    });
    assert.equal(login.statusCode, 200, login.body);
    const headers = {
      authorization: 'Bearer ' + login.json().accessToken,
      'content-type': 'application/json'
    };
    const userId = login.json().user.id;

    const company = (await pool.query(
      'INSERT INTO companies(code,name_ar) VALUES($1,$2) RETURNING id',
      [code('SALCO'), 'شركة مبيعات اختبار']
    )).rows[0];
    const plant = (await pool.query(
      'INSERT INTO plants(company_id,code,name_ar) VALUES($1,$2,$3) RETURNING id',
      [company.id, code('SALPL'), 'مصنع مبيعات اختبار']
    )).rows[0];
    const warehouse = (await pool.query(
      'INSERT INTO warehouses(plant_id,code,name_ar) VALUES($1,$2,$3) RETURNING id',
      [plant.id, code('SALWH'), 'مخزن منتج تام اختبار']
    )).rows[0];
    const unit = (await pool.query(
      'INSERT INTO units_of_measure(code,name_ar) VALUES($1,$2) RETURNING id',
      [code('SALKG'), 'كيلوجرام']
    )).rows[0];
    const category = (await pool.query(
      "INSERT INTO item_categories(code,name_ar,category_kind) VALUES($1,$2,'FINISHED_GOOD') RETURNING id",
      [code('SALFG'), 'منتج تام اختبار']
    )).rows[0];
    const item = (await pool.query(
      'INSERT INTO items(code,name_ar,category_id,base_unit_id,tracks_lot) VALUES($1,$2,$3,$4,TRUE) RETURNING id',
      [code('SALITEM'), 'علف تسمين اختبار', category.id, unit.id]
    )).rows[0];
    const customer = (await pool.query(
      'INSERT INTO customers(code,name_ar,credit_limit) VALUES($1,$2,1000) RETURNING id,code',
      [code('CUST'), 'عميل مبيعات اختبار']
    )).rows[0];
    const lotNo = 'SALLOT-' + suffix;
    await pool.query(
      `INSERT INTO inventory_balances(warehouse_id,item_id,lot_no,quantity,average_unit_cost,quality_status)
       VALUES($1,$2,$3,20,5,'RELEASED')`,
      [warehouse.id, item.id, lotNo]
    );

    const dueDate = new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10);
    const invoice = await app.inject({
      method: 'POST',
      url: '/api/v1/sales/invoices',
      headers,
      payload: {
        invoiceNo: code('INV-SAL'),
        customerId: customer.id,
        warehouseId: warehouse.id,
        dueDate,
        discountAmount: 10,
        lines: [{ itemId: item.id, lotNo, quantity: 10, unitPrice: 12 }]
      }
    });
    assert.equal(invoice.statusCode, 201, invoice.body);
    const invoiceId = invoice.json().id;
    assert.equal(Number(invoice.json().subtotal), 120);
    assert.equal(Number(invoice.json().totalAmount), 110);
    assert.equal(Number(invoice.json().costAmount), 50);
    assert.equal(invoice.json().status, 'POSTED');

    const invoiceLine = (await pool.query(
      'SELECT id,quantity FROM sales_invoice_lines WHERE sales_invoice_id=$1',
      [invoiceId]
    )).rows[0];
    const afterSale = await pool.query(
      'SELECT quantity FROM inventory_balances WHERE warehouse_id=$1 AND item_id=$2 AND lot_no=$3',
      [warehouse.id, item.id, lotNo]
    );
    assert.equal(Number(afterSale.rows[0].quantity), 10);



    const saleJournal = await pool.query(
      "SELECT total_debit,total_credit FROM journal_entries WHERE source_type='SALES_INVOICE' AND source_id=$1 AND status='POSTED'",
      [invoiceId]
    );
    assert.equal(saleJournal.rowCount, 1);
    assert.equal(Number(saleJournal.rows[0].total_debit), 160);
    assert.equal(Number(saleJournal.rows[0].total_credit), 160);

    const receipt = await app.inject({
      method: 'POST',
      url: '/api/v1/accounting/receipts',
      headers,
      payload: {
        receiptNo: code('RCPT'),
        customerId: customer.id,
        amount: 40,
        paymentMethod: 'CASH',
        allocations: [{ invoiceId, amount: 40 }]
      }
    });
    assert.equal(receipt.statusCode, 201, receipt.body);
    assert.equal(Number(receipt.json().allocated), 40);
    const invoiceAfterReceipt = await pool.query(
      'SELECT status FROM sales_invoices WHERE id=$1',
      [invoiceId]
    );
    assert.equal(invoiceAfterReceipt.rows[0].status, 'PARTIALLY_PAID');

    const excessReceipt = await app.inject({
      method: 'POST',
      url: '/api/v1/accounting/receipts',
      headers,
      payload: {
        receiptNo: code('RCPTX'),
        customerId: customer.id,
        amount: 80,
        paymentMethod: 'CASH',
        allocations: [{ invoiceId, amount: 80 }]
      }
    });
    assert.equal(excessReceipt.statusCode, 409, 'allocation above invoice balance must be rejected');

    const delivery = await app.inject({
      method: 'POST',
      url: '/api/v1/sales/deliveries',
      headers,
      payload: {
        deliveryNo: code('DLV'),
        invoiceId,
        driverName: 'سائق اختبار',
        lines: [{ invoiceLineId: invoiceLine.id, quantity: 10 }]
      }
    });
    assert.equal(delivery.statusCode, 201, delivery.body);
    const deliveryId = delivery.json().id;
    const deliveryLine = (await pool.query(
      'SELECT id FROM sales_delivery_lines WHERE sales_delivery_id=$1',
      [deliveryId]
    )).rows[0];

    const ready = await app.inject({
      method: 'POST', url: '/api/v1/sales/deliveries/' + deliveryId + '/ready',
      headers, payload: {}
    });
    assert.equal(ready.statusCode, 200, ready.body);
    const dispatched = await app.inject({
      method: 'POST', url: '/api/v1/sales/deliveries/' + deliveryId + '/dispatch',
      headers, payload: {}
    });
    assert.equal(dispatched.statusCode, 200, dispatched.body);
    assert.equal(dispatched.json().status, 'SHIPPED');

    const partial = await app.inject({
      method: 'POST',
      url: '/api/v1/sales/deliveries/' + deliveryId + '/confirm-delivery',
      headers,
      payload: { lines: [{ lineId: deliveryLine.id, deliveredQty: 6 }] }
    });
    assert.equal(partial.statusCode, 200, partial.body);
    assert.equal(partial.json().status, 'PARTIALLY_DELIVERED');
    assert.equal(Number(partial.json().remainingQty), 4);

    const complete = await app.inject({
      method: 'POST',
      url: '/api/v1/sales/deliveries/' + deliveryId + '/confirm-delivery',
      headers,
      payload: { lines: [{ lineId: deliveryLine.id, deliveredQty: 4 }] }
    });
    assert.equal(complete.statusCode, 200, complete.body);
    assert.equal(complete.json().status, 'DELIVERED');
    assert.equal(Number(complete.json().deliveredQty), 10);

    const salesReturn = await app.inject({
      method: 'POST',
      url: '/api/v1/sales/returns',
      headers,
      payload: {
        returnNo: code('SRET'),
        invoiceId,
        warehouseId: warehouse.id,
        reason: 'مرتجع عميل للاختبار',
        lines: [{ invoiceLineId: invoiceLine.id, quantity: 2 }]
      }
    });
    assert.equal(salesReturn.statusCode, 201, salesReturn.body);
    const returnId = salesReturn.json().id;

    const beforeWarehouseApproval = await pool.query(
      'SELECT quantity FROM inventory_balances WHERE warehouse_id=$1 AND item_id=$2 AND lot_no=$3',
      [warehouse.id, item.id, lotNo]
    );
    assert.equal(Number(beforeWarehouseApproval.rows[0].quantity), 10);

    const warehouseApproval = await app.inject({
      method: 'POST',
      url: '/api/v1/sales/returns/' + returnId + '/warehouse-approve',
      headers, payload: {}
    });
    assert.equal(warehouseApproval.statusCode, 200, warehouseApproval.body);
    assert.equal(warehouseApproval.json().status, 'PENDING_ACCOUNTING');

    const beforeAccountingApproval = await pool.query(
      'SELECT quantity FROM inventory_balances WHERE warehouse_id=$1 AND item_id=$2 AND lot_no=$3',
      [warehouse.id, item.id, lotNo]
    );
    assert.equal(Number(beforeAccountingApproval.rows[0].quantity), 10,
      'warehouse approval alone must not add returned goods to stock');

    const accountingApproval = await app.inject({
      method: 'POST',
      url: '/api/v1/sales/returns/' + returnId + '/accounting-approve',
      headers, payload: {}
    });
    assert.equal(accountingApproval.statusCode, 200, accountingApproval.body);
    assert.equal(accountingApproval.json().status, 'APPROVED');
    assert.equal(Number(accountingApproval.json().grossAmount), 24);
    assert.equal(Number(accountingApproval.json().discountAmount), 2);
    assert.equal(Number(accountingApproval.json().amount), 22);
    assert.equal(Number(accountingApproval.json().cost), 10);

    const balanceAfterFirstReturn = await app.inject({
      method: 'GET', url: '/api/v1/inventory/balances?warehouseId=' + warehouse.id, headers
    });
    assert.equal(balanceAfterFirstReturn.statusCode, 200, balanceAfterFirstReturn.body);
    const firstReturnedLot = balanceAfterFirstReturn.json().find(row => row.item_id === item.id && row.lot_no === lotNo);
    assert.ok(firstReturnedLot);
    assert.equal(Number(firstReturnedLot.quantity), 12);
    assert.equal(Number(firstReturnedLot.quality_held_qty), 2);
    assert.equal(Number(firstReturnedLot.available_quantity), 10,
      'pending return quantity must not block the original ten released units');

    const secondReturn = await app.inject({
      method: 'POST',
      url: '/api/v1/sales/returns',
      headers,
      payload: {
        returnNo: code('SRET2'),
        invoiceId,
        warehouseId: warehouse.id,
        reason: 'مرتجع ثانٍ من نفس التشغيلة',
        lines: [{ invoiceLineId: invoiceLine.id, quantity: 1 }]
      }
    });
    assert.equal(secondReturn.statusCode, 201, secondReturn.body);
    const secondReturnId = secondReturn.json().id;
    const secondWarehouseApproval = await app.inject({
      method: 'POST', url: '/api/v1/sales/returns/' + secondReturnId + '/warehouse-approve',
      headers, payload: {}
    });
    assert.equal(secondWarehouseApproval.statusCode, 200, secondWarehouseApproval.body);
    const secondAccountingApproval = await app.inject({
      method: 'POST', url: '/api/v1/sales/returns/' + secondReturnId + '/accounting-approve',
      headers, payload: {}
    });
    assert.equal(secondAccountingApproval.statusCode, 200, secondAccountingApproval.body);
    assert.equal(Number(secondAccountingApproval.json().grossAmount), 12);
    assert.equal(Number(secondAccountingApproval.json().discountAmount), 1);
    assert.equal(Number(secondAccountingApproval.json().amount), 11);

    const firstQualityInspection = await app.inject({
      method: 'POST', url: '/api/v1/quality/sales-returns/' + returnId + '/inspect',
      headers, payload: { result: 'PASS' }
    });
    assert.equal(firstQualityInspection.statusCode, 200, firstQualityInspection.body);
    assert.equal(firstQualityInspection.json().qualityStatus, 'RELEASED');

    const returnedBalance = await pool.query(
      `SELECT b.quantity,b.quality_status,
        COALESCE(SUM(h.held_qty) FILTER (WHERE h.status IN ('PENDING_QC','QUARANTINED')),0) held_qty
       FROM inventory_balances b LEFT JOIN inventory_quality_holds h
         ON h.warehouse_id=b.warehouse_id AND h.item_id=b.item_id AND h.lot_no=b.lot_no
       WHERE b.warehouse_id=$1 AND b.item_id=$2 AND b.lot_no=$3
       GROUP BY b.warehouse_id,b.item_id,b.lot_no`,
      [warehouse.id, item.id, lotNo]
    );
    assert.equal(Number(returnedBalance.rows[0].quantity), 13);
    assert.equal(returnedBalance.rows[0].quality_status, 'RELEASED',
      'inspecting a return must not change the original lot quality status');
    assert.equal(Number(returnedBalance.rows[0].held_qty), 1,
      'passing one return must leave the other return held for inspection');

    const balances = await app.inject({
      method: 'GET', url: '/api/v1/inventory/balances?warehouseId=' + warehouse.id, headers
    });
    assert.equal(balances.statusCode, 200, balances.body);
    const displayedLot = balances.json().find(row => row.item_id === item.id && row.lot_no === lotNo);
    assert.ok(displayedLot);
    assert.equal(Number(displayedLot.available_quantity), 12);
    assert.equal(Number(displayedLot.quality_held_qty), 1);

    const duplicateInspection = await app.inject({
      method: 'POST', url: '/api/v1/quality/sales-returns/' + returnId + '/inspect',
      headers, payload: { result: 'PASS' }
    });
    assert.equal(duplicateInspection.statusCode, 409,
      'a return inspection cannot release or reclassify its quantity twice');

    const cannotSellHeldReturn = await app.inject({
      method: 'POST', url: '/api/v1/sales/invoices', headers,
      payload: {
        invoiceNo: code('INV-HOLD'),
        customerId: customer.id,
        warehouseId: warehouse.id,
        lines: [{ itemId: item.id, lotNo, quantity: 13, unitPrice: 1 }]
      }
    });
    assert.equal(cannotSellHeldReturn.statusCode, 409,
      'sales must not consume quantities held for another return inspection');

    const returnJournal = await pool.query(
      "SELECT total_debit,total_credit FROM journal_entries WHERE source_type='SALES_RETURN' AND source_id=$1 AND status='POSTED'",
      [returnId]
    );
    assert.equal(returnJournal.rowCount, 1);
    assert.equal(Number(returnJournal.rows[0].total_debit), 32);
    assert.equal(Number(returnJournal.rows[0].total_credit), 32);

    const duplicateApproval = await app.inject({
      method: 'POST',
      url: '/api/v1/sales/returns/' + returnId + '/accounting-approve',
      headers, payload: {}
    });
    assert.equal(duplicateApproval.statusCode, 409, 'return must not be posted twice');

    const statement = await app.inject({
      method: 'GET',
      url: '/api/v1/reports/customer-statement?customerCode=' + encodeURIComponent(customer.code),
      headers
    });
    assert.equal(statement.statusCode, 200, statement.body);
    assert.ok(statement.json().some(row => row.transaction_type === 'SALES_INVOICE'));
    assert.ok(statement.json().some(row => row.transaction_type === 'CASH_RECEIPT'));
    assert.ok(statement.json().some(row => row.transaction_type === 'SALES_RETURN'));
    const netReturnCredits = statement.json().filter(row => row.transaction_type === 'SALES_RETURN')
      .reduce((sum,row)=>sum+Number(row.credit),0);
    assert.equal(netReturnCredits,33,'customer statement must reflect invoice discount on approved returns');

    const aging = await app.inject({
      method: 'GET',
      url: '/api/v1/reports/customer-aging?customerCode=' + encodeURIComponent(customer.code),
      headers
    });
    assert.equal(aging.statusCode, 200, aging.body);
    assert.equal(aging.json().length, 1);
    assert.equal(Number(aging.json()[0].outstanding), 37);
    assert.equal(String(aging.json()[0].due_date).slice(0, 10), dueDate);
    assert.equal(aging.json()[0].aging_bucket, 'غير مستحق');

    const movements = await pool.query(
      "SELECT quantity_in,quantity_out FROM stock_movements WHERE reference_type='SALES_RETURN' AND reference_id=$1",
      [returnId]
    );
    assert.equal(movements.rowCount, 1);
    assert.deepEqual([Number(movements.rows[0].quantity_in), Number(movements.rows[0].quantity_out)], [2, 0]);

    const allJournals = await pool.query(
      "SELECT total_debit,total_credit FROM journal_entries WHERE source_id IN ($1,$2,$3) AND source_type IN ('SALES_INVOICE','CASH_RECEIPT','SALES_RETURN')",
      [invoiceId, receipt.json().receipt.id, returnId]
    );
    assert.equal(allJournals.rowCount, 3);
    for (const row of allJournals.rows) {
      assert.equal(Number(row.total_debit), Number(row.total_credit));
    }
    const creditCustomer = (await pool.query(
      'INSERT INTO customers(code,name_ar,credit_limit) VALUES($1,$2,30) RETURNING id',
      [code('CL-CUST'), 'عميل حد ائتماني اختبار']
    )).rows[0];
    const creditInvoice = await app.inject({
      method:'POST',url:'/api/v1/sales/invoices',headers,
      payload:{invoiceNo:code('CL-INV1'),customerId:creditCustomer.id,warehouseId:warehouse.id,
        lines:[{itemId:item.id,lotNo,quantity:1,unitPrice:20}]}
    });
    assert.equal(creditInvoice.statusCode,201,creditInvoice.body);
    const creditReceipt = await app.inject({
      method:'POST',url:'/api/v1/accounting/receipts',headers,
      payload:{receiptNo:code('CL-RC'),customerId:creditCustomer.id,amount:15,paymentMethod:'CASH',
        allocations:[{invoiceId:creditInvoice.json().id,amount:15}]}
    });
    assert.equal(creditReceipt.statusCode,201,creditReceipt.body);
    const reverseCreditReceipt = await app.inject({
      method:'POST',url:'/api/v1/accounting/receipts/'+creditReceipt.json().receipt.id+'/reverse',
      headers,payload:{reason:'اختبار إعادة احتساب الحد الائتماني بعد عكس التحصيل'}
    });
    assert.equal(reverseCreditReceipt.statusCode,200,reverseCreditReceipt.body);
    const creditLimitMustCountReversedReceipt = await app.inject({
      method:'POST',url:'/api/v1/sales/invoices',headers,
      payload:{invoiceNo:code('CL-INV2'),customerId:creditCustomer.id,warehouseId:warehouse.id,
        lines:[{itemId:item.id,lotNo,quantity:1,unitPrice:15}]}
    });
    assert.equal(creditLimitMustCountReversedReceipt.statusCode,409,
      'reversed receipts must not reduce customer credit exposure');

    const creditInvoiceLine = (await pool.query(
      'SELECT id FROM sales_invoice_lines WHERE sales_invoice_id=$1',[creditInvoice.json().id]
    )).rows[0];
    const creditReturn = await app.inject({
      method:'POST',url:'/api/v1/sales/returns',headers,
      payload:{returnNo:code('CL-RET'),invoiceId:creditInvoice.json().id,warehouseId:warehouse.id,
        lines:[{invoiceLineId:creditInvoiceLine.id,quantity:0.5}]}
    });
    assert.equal(creditReturn.statusCode,201,creditReturn.body);
    const creditReturnWarehouse = await app.inject({
      method:'POST',url:'/api/v1/sales/returns/'+creditReturn.json().id+'/warehouse-approve',headers,payload:{}
    });
    assert.equal(creditReturnWarehouse.statusCode,200,creditReturnWarehouse.body);
    const creditReturnAccounting = await app.inject({
      method:'POST',url:'/api/v1/sales/returns/'+creditReturn.json().id+'/accounting-approve',headers,payload:{}
    });
    assert.equal(creditReturnAccounting.statusCode,200,creditReturnAccounting.body);
    assert.equal(Number(creditReturnAccounting.json().amount),10);
    const invoiceAfterApprovedReturn = await app.inject({
      method:'POST',url:'/api/v1/sales/invoices',headers,
      payload:{invoiceNo:code('CL-INV3'),customerId:creditCustomer.id,warehouseId:warehouse.id,
        lines:[{itemId:item.id,lotNo,quantity:1,unitPrice:15}]}
    });
    assert.equal(invoiceAfterApprovedReturn.statusCode,201,
      'approved customer returns must reduce credit exposure by their posted receivable amount');

  } finally {
    await app.close();
    await pool.end();
  }
});
