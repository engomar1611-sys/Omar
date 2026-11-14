import test from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import { buildApp } from '../src/app.mjs';

const enabled = Boolean(
  process.env.DATABASE_URL &&
  process.env.BOOTSTRAP_ADMIN_USERNAME &&
  process.env.BOOTSTRAP_ADMIN_PASSWORD
);

test('PostgreSQL sales workflow: discounted invoice, collection allocation, partial delivery and two-stage return approval', { skip: !enabled }, async () => {
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
  const app = buildApp({ logger: false, db: pool, jwtSecret: process.env.AUTH_JWT_SECRET });
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

    const invoice = await app.inject({
      method: 'POST',
      url: '/api/v1/sales/invoices',
      headers,
      payload: {
        invoiceNo: code('INV-SAL'),
        customerId: customer.id,
        warehouseId: warehouse.id,
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
    assert.equal(Number(accountingApproval.json().amount), 24);
    assert.equal(Number(accountingApproval.json().cost), 10);

    const returnedBalance = await pool.query(
      'SELECT quantity,quality_status FROM inventory_balances WHERE warehouse_id=$1 AND item_id=$2 AND lot_no=$3',
      [warehouse.id, item.id, lotNo]
    );
    assert.equal(Number(returnedBalance.rows[0].quantity), 12);
    assert.equal(returnedBalance.rows[0].quality_status, 'PENDING_QC',
      'returned goods must remain unavailable until quality release');

    const returnJournal = await pool.query(
      "SELECT total_debit,total_credit FROM journal_entries WHERE source_type='SALES_RETURN' AND source_id=$1 AND status='POSTED'",
      [returnId]
    );
    assert.equal(returnJournal.rowCount, 1);
    assert.equal(Number(returnJournal.rows[0].total_debit), 34);
    assert.equal(Number(returnJournal.rows[0].total_credit), 34);

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

    const aging = await app.inject({
      method: 'GET',
      url: '/api/v1/reports/customer-aging?customerCode=' + encodeURIComponent(customer.code),
      headers
    });
    assert.equal(aging.statusCode, 200, aging.body);
    assert.equal(aging.json().length, 1);
    assert.equal(Number(aging.json()[0].outstanding), 46);

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
  } finally {
    await app.close();
    await pool.end();
  }
});
