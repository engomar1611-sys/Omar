import test from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import { buildApp } from '../src/app.mjs';

const enabled = Boolean(
  process.env.DATABASE_URL &&
  process.env.BOOTSTRAP_ADMIN_USERNAME &&
  process.env.BOOTSTRAP_ADMIN_PASSWORD
);

test('PostgreSQL procurement workflow: request, approval, order, receipt, QC quarantine and weighted average', { skip: !enabled }, async () => {
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
      [code('ITC'), 'شركة مشتريات اختبار']
    )).rows[0];
    const plant = (await pool.query(
      'INSERT INTO plants(company_id,code,name_ar) VALUES($1,$2,$3) RETURNING id',
      [company.id, code('PL'), 'مصنع اختبار']
    )).rows[0];
    const warehouse = (await pool.query(
      'INSERT INTO warehouses(plant_id,code,name_ar) VALUES($1,$2,$3) RETURNING id',
      [plant.id, code('WH'), 'مخزن خامات اختبار']
    )).rows[0];
    const unit = (await pool.query(
      'INSERT INTO units_of_measure(code,name_ar) VALUES($1,$2) RETURNING id',
      [code('KG'), 'كيلوجرام']
    )).rows[0];
    const category = (await pool.query(
      "INSERT INTO item_categories(code,name_ar,category_kind) VALUES($1,$2,'RAW_MATERIAL') RETURNING id",
      [code('RAW'), 'خامة مشتريات اختبار']
    )).rows[0];
    const item = (await pool.query(
      'INSERT INTO items(code,name_ar,category_id,base_unit_id,tracks_lot,tracks_expiry) VALUES($1,$2,$3,$4,TRUE,TRUE) RETURNING id',
      [code('CORN'), 'ذرة صفراء اختبار', category.id, unit.id]
    )).rows[0];
    const supplier = (await pool.query(
      'INSERT INTO suppliers(code,name_ar) VALUES($1,$2) RETURNING id',
      [code('SUP'), 'مورد اختبار']
    )).rows[0];

    const request = await app.inject({
      method: 'POST',
      url: '/api/v1/purchase-requests',
      headers,
      payload: {
        requestNo: code('REQ'),
        warehouseId: warehouse.id,
        reason: 'اختبار دورة طلب الشراء',
        lines: [{ itemId: item.id, quantity: 10 }]
      }
    });
    assert.equal(request.statusCode, 201, request.body);
    const requestId = request.json().id;
    const requestLine = (await pool.query(
      'SELECT id FROM purchase_request_lines WHERE purchase_request_id=$1',
      [requestId]
    )).rows[0];

    const submitted = await app.inject({
      method: 'POST', url: '/api/v1/purchase-requests/' + requestId + '/submit',
      headers, payload: {}
    });
    assert.equal(submitted.statusCode, 200, submitted.body);
    assert.equal(submitted.json().status, 'PENDING_APPROVAL');

    const approved = await app.inject({
      method: 'POST', url: '/api/v1/purchase-requests/' + requestId + '/approve',
      headers, payload: {}
    });
    assert.equal(approved.statusCode, 200, approved.body);
    assert.equal(approved.json().status, 'APPROVED');

    const converted = await app.inject({
      method: 'POST', url: '/api/v1/purchase-requests/' + requestId + '/convert',
      headers,
      payload: {
        orderNo: code('PO'),
        supplierId: supplier.id,
        lines: [{ requestLineId: requestLine.id, unitCost: 5 }]
      }
    });
    assert.equal(converted.statusCode, 201, converted.body);
    const orderId = converted.json().purchaseOrder.id;
    assert.equal(converted.json().lineCount, 1);
    const orderLine = (await pool.query(
      'SELECT id FROM purchase_order_lines WHERE purchase_order_id=$1',
      [orderId]
    )).rows[0];

    const approvedOrder = await app.inject({
      method: 'POST', url: '/api/v1/purchases/' + orderId + '/approve',
      headers, payload: {}
    });
    assert.equal(approvedOrder.statusCode, 200, approvedOrder.body);
    assert.equal(approvedOrder.json().status, 'APPROVED');

    const receipt = await app.inject({
      method: 'POST', url: '/api/v1/goods-receipts',
      headers,
      payload: {
        receiptNo: code('GRN'),
        purchaseOrderId: orderId,
        lines: [{
          purchaseOrderLineId: orderLine.id,
          quantity: 10,
          lotNo: 'LOT-' + suffix,
          expiryDate: '2027-12-31'
        }]
      }
    });
    assert.equal(receipt.statusCode, 201, receipt.body);
    const receiptId = receipt.json().id;
    const receiptLine = (await pool.query(
      'SELECT id FROM goods_receipt_lines WHERE goods_receipt_id=$1',
      [receiptId]
    )).rows[0];

    const beforeQc = await pool.query(
      'SELECT quantity FROM inventory_balances WHERE warehouse_id=$1 AND item_id=$2 AND lot_no=$3',
      [warehouse.id, item.id, 'LOT-' + suffix]
    );
    assert.equal(beforeQc.rowCount, 0, 'receipt must remain outside available stock before QC approval');

    const qc = await app.inject({
      method: 'POST',
      url: '/api/v1/goods-receipts/' + receiptId + '/quality',
      headers,
      payload: {
        inspections: [{
          receiptLineId: receiptLine.id,
          result: 'PARTIAL',
          acceptedQty: 8,
          rejectedQty: 2,
          parameters: { moisturePercent: 11.5 },
          notes: 'قبول جزئي للاختبار'
        }]
      }
    });
    assert.equal(qc.statusCode, 200, qc.body);
    assert.equal(qc.json().status, 'PARTIAL');
    assert.equal(Number(qc.json().acceptedQty), 8);
    assert.equal(Number(qc.json().rejectedQty), 2);

    const balance = await pool.query(
      "SELECT quantity,average_unit_cost,quality_status,TO_CHAR(expiry_date,'YYYY-MM-DD') AS expiry_date FROM inventory_balances WHERE warehouse_id=$1 AND item_id=$2 AND lot_no=$3",
      [warehouse.id, item.id, 'LOT-' + suffix]
    );
    assert.equal(balance.rowCount, 1);
    assert.equal(Number(balance.rows[0].quantity), 8);
    assert.equal(Number(balance.rows[0].average_unit_cost), 5);
    assert.equal(balance.rows[0].quality_status, 'RELEASED');
    assert.equal(String(balance.rows[0].expiry_date).slice(0, 10), '2027-12-31');

    const inspection = await pool.query(
      'SELECT accepted_qty,rejected_qty,result FROM quality_inspections WHERE goods_receipt_line_id=$1',
      [receiptLine.id]
    );
    assert.equal(inspection.rowCount, 1);
    assert.deepEqual(
      [Number(inspection.rows[0].accepted_qty), Number(inspection.rows[0].rejected_qty), inspection.rows[0].result],
      [8, 2, 'PARTIAL']
    );

    const movement = await pool.query(
      "SELECT quantity_in,quantity_out,unit_cost,movement_type FROM stock_movements WHERE reference_type='GOODS_RECEIPT' AND reference_id=$1",
      [receiptId]
    );
    assert.equal(movement.rowCount, 1);
    assert.deepEqual(
      [Number(movement.rows[0].quantity_in), Number(movement.rows[0].quantity_out), Number(movement.rows[0].unit_cost), movement.rows[0].movement_type],
      [8, 0, 5, 'PURCHASE_RECEIPT']
    );

    const journal = await pool.query(
      "SELECT total_debit,total_credit FROM journal_entries WHERE source_type='GOODS_RECEIPT' AND source_id=$1 AND status='POSTED'",
      [receiptId]
    );
    assert.equal(journal.rowCount, 1);
    assert.equal(Number(journal.rows[0].total_debit), 40);
    assert.equal(Number(journal.rows[0].total_credit), 40);

    const duplicateQc = await app.inject({
      method: 'POST',
      url: '/api/v1/goods-receipts/' + receiptId + '/quality',
      headers,
      payload: {
        inspections: [{
          receiptLineId: receiptLine.id,
          result: 'PASS',
          acceptedQty: 10,
          rejectedQty: 0
        }]
      }
    });
    assert.equal(duplicateQc.statusCode, 409, 'receipt QC approval must not be posted twice');

    const overReceipt = await app.inject({
      method: 'POST',
      url: '/api/v1/goods-receipts',
      headers,
      payload: {
        receiptNo: code('GRN2'),
        purchaseOrderId: orderId,
        lines: [{ purchaseOrderLineId: orderLine.id, quantity: 1, lotNo: 'OVER-' + suffix }]
      }
    });
    assert.equal(overReceipt.statusCode, 409, 'receiving more than the ordered quantity must be rejected');

    const listed = await app.inject({
      method: 'GET', url: '/api/v1/goods-receipts', headers
    });
    assert.equal(listed.statusCode, 200, listed.body);
    assert.ok(listed.json().some(row => row.id === receiptId && row.lines.length === 1));

    const purchaseReturn = await app.inject({
      method: 'POST', url: '/api/v1/purchases/returns', headers,
      payload: { returnNo: code('PR'), supplierId: supplier.id, purchaseOrderId: orderId,
        warehouseId: warehouse.id, reason: 'مرتجع مورد للاختبار',
        lines: [{ itemId: item.id, lotNo: 'LOT-' + suffix, quantity: 2 }] }
    });
    assert.equal(purchaseReturn.statusCode, 201, purchaseReturn.body);
    const warehouseReturn = await app.inject({
      method: 'POST', url: '/api/v1/purchases/returns/' + purchaseReturn.json().returnId + '/warehouse-approve',
      headers, payload: {}
    });
    assert.equal(warehouseReturn.statusCode, 200, warehouseReturn.body);
    const accountingReturn = await app.inject({
      method: 'POST', url: '/api/v1/purchases/returns/' + purchaseReturn.json().returnId + '/accounting-approve',
      headers, payload: {}
    });
    assert.equal(accountingReturn.statusCode, 200, accountingReturn.body);
    assert.equal(Number(accountingReturn.json().total), 10);

    const overpay = await app.inject({
      method: 'POST', url: '/api/v1/accounting/supplier-payments', headers,
      payload: { paymentNo: code('SPX'), supplierId: supplier.id, amount: 31, paymentMethod: 'CASH',
        allocations: [{ purchaseOrderId: orderId, amount: 31 }] }
    });
    assert.equal(overpay.statusCode, 409, overpay.body, 'payment must not exceed payable after accepted returns');

    const payment = await app.inject({
      method: 'POST', url: '/api/v1/accounting/supplier-payments', headers,
      payload: { paymentNo: code('SP'), supplierId: supplier.id, amount: 10, paymentMethod: 'CASH',
        allocations: [{ purchaseOrderId: orderId, amount: 10 }] }
    });
    assert.equal(payment.statusCode, 201, payment.body);

    const aging = await app.inject({
      method: 'GET', url: '/api/v1/reports/supplier-aging?asOf=' + new Date().toISOString().slice(0, 10), headers
    });
    assert.equal(aging.statusCode, 200, aging.body);
    const agingRow = aging.json().find(x => x.purchase_order_id === orderId);
    assert.ok(agingRow);
    assert.equal(Number(agingRow.received_amount), 40);
    assert.equal(Number(agingRow.returned_amount), 10);
    assert.equal(Number(agingRow.paid_amount), 10);
    assert.equal(Number(agingRow.outstanding), 20);
  } finally {
    await app.close();
    await pool.end();
  }
});
