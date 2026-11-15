import test from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import { buildApp } from '../src/app.mjs';

const enabled = Boolean(process.env.DATABASE_URL && process.env.BOOTSTRAP_ADMIN_USERNAME && process.env.BOOTSTRAP_ADMIN_PASSWORD);

test('sales quotation to reserved order, invoice, and partial delivery fulfillment', { skip: !enabled }, async () => {
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
  const app = buildApp({ logger: false, db: pool, jwtSecret: process.env.AUTH_JWT_SECRET });
  const suffix = Date.now().toString();
  const code = prefix => (prefix + suffix).slice(0, 40);
  try {
    const login = await app.inject({
      method: 'POST', url: '/api/v1/auth/login',
      payload: { username: process.env.BOOTSTRAP_ADMIN_USERNAME, password: process.env.BOOTSTRAP_ADMIN_PASSWORD }
    });
    assert.equal(login.statusCode, 200, login.body);
    const headers = { authorization: 'Bearer ' + login.json().accessToken, 'content-type': 'application/json' };

    const company = (await pool.query('INSERT INTO companies(code,name_ar) VALUES($1,$2) RETURNING id', [code('SC'), 'شركة مبيعات اختبار'])).rows[0];
    const plant = (await pool.query('INSERT INTO plants(company_id,code,name_ar) VALUES($1,$2,$3) RETURNING id', [company.id, code('PL'), 'مصنع مبيعات اختبار'])).rows[0];
    const warehouse = (await pool.query('INSERT INTO warehouses(plant_id,code,name_ar) VALUES($1,$2,$3) RETURNING id', [plant.id, code('WH'), 'مخزن مبيعات اختبار'])).rows[0];
    const unit = (await pool.query('INSERT INTO units_of_measure(code,name_ar) VALUES($1,$2) RETURNING id', [code('KG'), 'كيلوجرام'])).rows[0];
    const category = (await pool.query("INSERT INTO item_categories(code,name_ar,category_kind) VALUES($1,$2,'FINISHED_GOOD') RETURNING id", [code('FG'), 'منتج تام اختبار'])).rows[0];
    const item = (await pool.query('INSERT INTO items(code,name_ar,category_id,base_unit_id) VALUES($1,$2,$3,$4) RETURNING id', [code('FEED'), 'علف اختبار', category.id, unit.id])).rows[0];
    const customer = (await pool.query('INSERT INTO customers(code,name_ar,credit_limit) VALUES($1,$2,0) RETURNING id', [code('CUS'), 'عميل اختبار'])).rows[0];
    await pool.query(`
      INSERT INTO inventory_balances(warehouse_id,item_id,lot_no,expiry_date,quantity,average_unit_cost,quality_status)
      VALUES($1,$2,$3,'2027-12-31',10,5,'RELEASED')
    `, [warehouse.id,item.id,'LOT-'+suffix]);

    const quote = await app.inject({
      method: 'POST', url: '/api/v1/sales/quotations', headers,
      payload: { quoteNo: code('SQ'), customerId: customer.id, warehouseId: warehouse.id, discountAmount: 10,
        lines: [{ itemId: item.id, quantity: 10, unitPrice: 12 }] }
    });
    assert.equal(quote.statusCode, 201, quote.body);
    const quoteId = quote.json().quotation.id;
    for (const action of ['submit','approve']) {
      const response = await app.inject({ method: 'POST', url: '/api/v1/sales/quotations/' + quoteId + '/' + action, headers, payload: {} });
      assert.equal(response.statusCode, 200, response.body);
    }

    const order = await app.inject({
      method: 'POST', url: '/api/v1/sales/quotations/' + quoteId + '/convert-to-order', headers,
      payload: { orderNo: code('SO') }
    });
    assert.equal(order.statusCode, 201, order.body);
    const orderId = order.json().salesOrder.id;
    const reserved = await pool.query("SELECT SUM(reserved_qty) qty FROM sales_order_reservations WHERE sales_order_id=$1 AND status='RESERVED'", [orderId]);
    assert.equal(Number(reserved.rows[0].qty), 10);

    const bypass = await app.inject({
      method: 'POST', url: '/api/v1/sales/invoices', headers,
      payload: { invoiceNo: code('DIRECT'), customerId: customer.id, warehouseId: warehouse.id,
        lines: [{ itemId: item.id, quantity: 1, unitPrice: 12 }] }
    });
    assert.equal(bypass.statusCode, 409, bypass.body, 'direct invoice cannot consume another sales order reservation');

    const invoice = await app.inject({
      method: 'POST', url: '/api/v1/sales/invoices', headers,
      payload: { invoiceNo: code('INV'), salesOrderId: orderId }
    });
    assert.equal(invoice.statusCode, 201, invoice.body);
    assert.equal(Number(invoice.json().totalAmount), 110);
    assert.equal(Number(invoice.json().costAmount), 50);
    const invoiceHeader = await pool.query('SELECT sales_order_id,status FROM sales_invoices WHERE id=$1', [invoice.json().id]);
    assert.equal(invoiceHeader.rows[0].sales_order_id, orderId);
    assert.equal(invoiceHeader.rows[0].status, 'POSTED');
    const invoiceLines = await pool.query('SELECT id,quantity,sales_order_line_id FROM sales_invoice_lines WHERE sales_invoice_id=$1', [invoice.json().id]);
    assert.equal(invoiceLines.rowCount, 1);
    assert.equal(Number(invoiceLines.rows[0].quantity), 10);
    assert.ok(invoiceLines.rows[0].sales_order_line_id);

    const balance = await pool.query('SELECT quantity FROM inventory_balances WHERE warehouse_id=$1 AND item_id=$2 AND lot_no=$3', [warehouse.id,item.id,'LOT-'+suffix]);
    assert.equal(Number(balance.rows[0].quantity), 0);
    const consumed = await pool.query("SELECT COUNT(*)::int count FROM sales_order_reservations WHERE sales_order_id=$1 AND status='CONSUMED'", [orderId]);
    assert.equal(consumed.rows[0].count, 1);

    const reversed = await app.inject({
      method: 'POST', url: '/api/v1/sales/invoices/' + invoice.json().id + '/reverse', headers,
      payload: { reason: 'اختبار عكس فاتورة أمر البيع' }
    });
    assert.equal(reversed.statusCode, 200, reversed.body);
    const reopened = await pool.query('SELECT status FROM sales_orders WHERE id=$1', [orderId]);
    assert.equal(reopened.rows[0].status, 'OPEN');
    const restoredReservation = await pool.query("SELECT COUNT(*)::int count FROM sales_order_reservations WHERE sales_order_id=$1 AND status='RESERVED'", [orderId]);
    assert.equal(restoredReservation.rows[0].count, 1);
    const restoredBalance = await pool.query('SELECT quantity FROM inventory_balances WHERE warehouse_id=$1 AND item_id=$2 AND lot_no=$3', [warehouse.id,item.id,'LOT-'+suffix]);
    assert.equal(Number(restoredBalance.rows[0].quantity), 10);

    const reissued = await app.inject({
      method: 'POST', url: '/api/v1/sales/invoices', headers,
      payload: { invoiceNo: code('INV2'), salesOrderId: orderId }
    });
    assert.equal(reissued.statusCode, 201, reissued.body);
    const finalInvoiceLines = await pool.query('SELECT id,quantity FROM sales_invoice_lines WHERE sales_invoice_id=$1', [reissued.json().id]);
    assert.equal(finalInvoiceLines.rowCount, 1);
    const finalBalance = await pool.query('SELECT quantity FROM inventory_balances WHERE warehouse_id=$1 AND item_id=$2 AND lot_no=$3', [warehouse.id,item.id,'LOT-'+suffix]);
    assert.equal(Number(finalBalance.rows[0].quantity), 0);

    const delivery = await app.inject({
      method: 'POST', url: '/api/v1/sales/deliveries', headers,
      payload: { deliveryNo: code('DEL'), invoiceId: reissued.json().id,
        lines: [{ invoiceLineId: finalInvoiceLines.rows[0].id, quantity: 10 }] }
    });
    assert.equal(delivery.statusCode, 201, delivery.body);
    const deliveryId = delivery.json().id;
    const deliveryLine = (await pool.query('SELECT id FROM sales_delivery_lines WHERE sales_delivery_id=$1', [deliveryId])).rows[0];
    const ready = await app.inject({ method: 'POST', url: '/api/v1/sales/deliveries/' + deliveryId + '/ready', headers, payload: {} });
    assert.equal(ready.statusCode, 200, ready.body);
    const dispatched = await app.inject({ method: 'POST', url: '/api/v1/sales/deliveries/' + deliveryId + '/dispatch', headers, payload: {} });
    assert.equal(dispatched.statusCode, 200, dispatched.body);

    const firstReceipt = await app.inject({
      method: 'POST', url: '/api/v1/sales/deliveries/' + deliveryId + '/confirm-delivery', headers,
      payload: { lines: [{ lineId: deliveryLine.id, deliveredQty: 4 }] }
    });
    assert.equal(firstReceipt.statusCode, 200, firstReceipt.body);
    let orderState = await pool.query('SELECT status FROM sales_orders WHERE id=$1', [orderId]);
    assert.equal(orderState.rows[0].status, 'PARTIALLY_DELIVERED');
    let orderLineState = await pool.query('SELECT delivered_qty FROM sales_order_lines WHERE sales_order_id=$1', [orderId]);
    assert.equal(Number(orderLineState.rows[0].delivered_qty), 4);

    const finalReceipt = await app.inject({
      method: 'POST', url: '/api/v1/sales/deliveries/' + deliveryId + '/confirm-delivery', headers,
      payload: { lines: [{ lineId: deliveryLine.id, deliveredQty: 6 }] }
    });
    assert.equal(finalReceipt.statusCode, 200, finalReceipt.body);
    orderState = await pool.query('SELECT status FROM sales_orders WHERE id=$1', [orderId]);
    assert.equal(orderState.rows[0].status, 'DELIVERED');
    orderLineState = await pool.query('SELECT delivered_qty FROM sales_order_lines WHERE sales_order_id=$1', [orderId]);
    assert.equal(Number(orderLineState.rows[0].delivered_qty), 10);
  } finally {
    await app.close();
    await pool.end();
  }
});
