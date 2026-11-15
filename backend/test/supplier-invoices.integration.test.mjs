import test from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import { buildApp } from '../src/app.mjs';

const enabled = Boolean(process.env.DATABASE_URL && process.env.BOOTSTRAP_ADMIN_USERNAME && process.env.BOOTSTRAP_ADMIN_PASSWORD);

test('supplier invoice three-way match uses only quality-accepted receipt quantity and does not double-post AP', { skip: !enabled }, async () => {
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
  const app = buildApp({ logger: false, db: pool, jwtSecret: process.env.AUTH_JWT_SECRET });
  const suffix = Date.now().toString();
  const code = prefix => (prefix + suffix).slice(0, 40);
  const today = new Date().toISOString().slice(0, 10);
  const due = new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10);
  try {
    const login = await app.inject({
      method: 'POST', url: '/api/v1/auth/login',
      payload: { username: process.env.BOOTSTRAP_ADMIN_USERNAME, password: process.env.BOOTSTRAP_ADMIN_PASSWORD }
    });
    assert.equal(login.statusCode, 200, login.body);
    const headers = { authorization: 'Bearer ' + login.json().accessToken, 'content-type': 'application/json' };

    const company = (await pool.query('INSERT INTO companies(code,name_ar) VALUES($1,$2) RETURNING id', [code('IC'), 'شركة فواتير اختبار'])).rows[0];
    const plant = (await pool.query('INSERT INTO plants(company_id,code,name_ar) VALUES($1,$2,$3) RETURNING id', [company.id, code('PL'), 'مصنع فواتير اختبار'])).rows[0];
    const warehouse = (await pool.query('INSERT INTO warehouses(plant_id,code,name_ar) VALUES($1,$2,$3) RETURNING id', [plant.id, code('WH'), 'مخزن فواتير اختبار'])).rows[0];
    const unit = (await pool.query('INSERT INTO units_of_measure(code,name_ar) VALUES($1,$2) RETURNING id', [code('KG'), 'كيلوجرام'])).rows[0];
    const category = (await pool.query("INSERT INTO item_categories(code,name_ar,category_kind) VALUES($1,$2,'RAW_MATERIAL') RETURNING id", [code('RM'), 'خامة فواتير اختبار'])).rows[0];
    const item = (await pool.query('INSERT INTO items(code,name_ar,category_id,base_unit_id) VALUES($1,$2,$3,$4) RETURNING id', [code('CORN'), 'ذرة فواتير اختبار', category.id, unit.id])).rows[0];
    const supplier = (await pool.query('INSERT INTO suppliers(code,name_ar) VALUES($1,$2) RETURNING id', [code('SUP'), 'مورد فواتير اختبار'])).rows[0];

    const po = await app.inject({
      method: 'POST', url: '/api/v1/purchases', headers,
      payload: { orderNo: code('PO'), supplierId: supplier.id, warehouseId: warehouse.id,
        lines: [{ itemId: item.id, quantity: 10, unitCost: 5 }] }
    });
    assert.equal(po.statusCode, 201, po.body);
    const poId = po.json().id;
    const poLine = (await pool.query('SELECT id FROM purchase_order_lines WHERE purchase_order_id=$1', [poId])).rows[0];
    const approved = await app.inject({ method: 'POST', url: '/api/v1/purchases/' + poId + '/approve', headers, payload: {} });
    assert.equal(approved.statusCode, 200, approved.body);

    const receipt = await app.inject({
      method: 'POST', url: '/api/v1/goods-receipts', headers,
      payload: { receiptNo: code('GR'), purchaseOrderId: poId,
        lines: [{ purchaseOrderLineId: poLine.id, quantity: 10, lotNo: 'LOT-' + suffix }] }
    });
    assert.equal(receipt.statusCode, 201, receipt.body);
    const receiptLine = (await pool.query('SELECT id FROM goods_receipt_lines WHERE goods_receipt_id=$1', [receipt.json().id])).rows[0];
    const quality = await app.inject({
      method: 'POST', url: '/api/v1/goods-receipts/' + receipt.json().id + '/quality', headers,
      payload: { inspections: [{ receiptLineId: receiptLine.id, result: 'PARTIAL', acceptedQty: 8, rejectedQty: 2, parameters: { moisture: 11.5 } }] }
    });
    assert.equal(quality.statusCode, 200, quality.body);
    assert.equal(quality.json().status, 'PARTIAL');

    const wrongPrice = await app.inject({
      method: 'POST', url: '/api/v1/supplier-invoices', headers,
      payload: { supplierInvoiceNo: code('INV-WRONG'), supplierId: supplier.id, purchaseOrderId: poId,
        invoiceDate: today, dueDate: due, lines: [{ receiptLineId: receiptLine.id, quantity: 8, unitCost: 5.1 }] }
    });
    assert.equal(wrongPrice.statusCode, 409, wrongPrice.body);

    const invoice = await app.inject({
      method: 'POST', url: '/api/v1/supplier-invoices', headers,
      payload: { supplierInvoiceNo: code('INV'), supplierId: supplier.id, purchaseOrderId: poId,
        invoiceDate: today, dueDate: due, lines: [{ receiptLineId: receiptLine.id, quantity: 8, unitCost: 5 }] }
    });
    assert.equal(invoice.statusCode, 201, invoice.body);
    assert.equal(Number(invoice.json().invoice.total_amount), 40);
    const invoiceId = invoice.json().invoice.id;

    const overInvoice = await app.inject({
      method: 'POST', url: '/api/v1/supplier-invoices', headers,
      payload: { supplierInvoiceNo: code('INV-OVER'), supplierId: supplier.id, purchaseOrderId: poId,
        invoiceDate: today, dueDate: due, lines: [{ receiptLineId: receiptLine.id, quantity: 1, unitCost: 5 }] }
    });
    assert.equal(overInvoice.statusCode, 409, overInvoice.body);

    const submit = await app.inject({ method: 'POST', url: '/api/v1/supplier-invoices/' + invoiceId + '/submit', headers, payload: {} });
    assert.equal(submit.statusCode, 200, submit.body);
    const entriesBefore = await pool.query("SELECT COUNT(*)::int count FROM journal_entries WHERE source_type='GOODS_RECEIPT' AND source_id=$1", [receipt.json().id]);
    assert.equal(entriesBefore.rows[0].count, 1);

    const registered = await app.inject({ method: 'POST', url: '/api/v1/supplier-invoices/' + invoiceId + '/register', headers, payload: {} });
    assert.equal(registered.statusCode, 200, registered.body);
    assert.equal(registered.json().invoice.status, 'REGISTERED');
    const entriesAfter = await pool.query("SELECT COUNT(*)::int count FROM journal_entries WHERE source_type='GOODS_RECEIPT' AND source_id=$1", [receipt.json().id]);
    assert.equal(entriesAfter.rows[0].count, 1, 'supplier invoice registration must not duplicate the goods-receipt AP journal');

    const match = await app.inject({ method: 'GET', url: '/api/v1/supplier-invoices/' + poId + '/match', headers });
    assert.equal(match.statusCode, 200, match.body);
    assert.equal(Number(match.json()[0].invoiced_qty), 8);
    assert.equal(Number(match.json()[0].remaining_qty), 0);

    const schedule = await app.inject({ method: 'GET', url: '/api/v1/reports/supplier-invoice-due-schedule', headers });
    assert.equal(schedule.statusCode, 200, schedule.body);
    assert.ok(schedule.json().some(row => row.supplier_invoice_no === code('INV')));
  } finally {
    await app.close();
    await pool.end();
  }
});
