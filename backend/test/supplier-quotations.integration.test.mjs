import test from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import { buildApp } from '../src/app.mjs';

const enabled = Boolean(process.env.DATABASE_URL && process.env.BOOTSTRAP_ADMIN_USERNAME && process.env.BOOTSTRAP_ADMIN_PASSWORD);

test('supplier quotations: complete line coverage, comparison, single award and conversion at awarded prices', { skip: !enabled }, async () => {
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

    const company = (await pool.query('INSERT INTO companies(code,name_ar) VALUES($1,$2) RETURNING id', [code('QC'), 'شركة عروض اختبار'])).rows[0];
    const plant = (await pool.query('INSERT INTO plants(company_id,code,name_ar) VALUES($1,$2,$3) RETURNING id', [company.id, code('PL'), 'مصنع عروض اختبار'])).rows[0];
    const warehouse = (await pool.query('INSERT INTO warehouses(plant_id,code,name_ar) VALUES($1,$2,$3) RETURNING id', [plant.id, code('WH'), 'مخزن عروض اختبار'])).rows[0];
    const unit = (await pool.query('INSERT INTO units_of_measure(code,name_ar) VALUES($1,$2) RETURNING id', [code('KG'), 'كيلوجرام'])).rows[0];
    const category = (await pool.query("INSERT INTO item_categories(code,name_ar,category_kind) VALUES($1,$2,'RAW_MATERIAL') RETURNING id", [code('RM'), 'خامة عروض اختبار'])).rows[0];
    const item = (await pool.query('INSERT INTO items(code,name_ar,category_id,base_unit_id) VALUES($1,$2,$3,$4) RETURNING id', [code('CORN'), 'ذرة عروض اختبار', category.id, unit.id])).rows[0];
    const supplierA = (await pool.query('INSERT INTO suppliers(code,name_ar) VALUES($1,$2) RETURNING id', [code('SA'), 'المورد ألف'])).rows[0];
    const supplierB = (await pool.query('INSERT INTO suppliers(code,name_ar) VALUES($1,$2) RETURNING id', [code('SB'), 'المورد باء'])).rows[0];

    const created = await app.inject({
      method: 'POST', url: '/api/v1/purchase-requests', headers,
      payload: { requestNo: code('REQ'), warehouseId: warehouse.id, lines: [{ itemId: item.id, quantity: 50 }] }
    });
    assert.equal(created.statusCode, 201, created.body);
    const requestId = created.json().id;
    const requestLine = (await pool.query('SELECT id FROM purchase_request_lines WHERE purchase_request_id=$1', [requestId])).rows[0];

    for (const action of ['submit', 'approve']) {
      const response = await app.inject({ method: 'POST', url: '/api/v1/purchase-requests/' + requestId + '/' + action, headers, payload: {} });
      assert.equal(response.statusCode, 200, response.body);
    }

    const incomplete = await app.inject({
      method: 'POST', url: '/api/v1/purchase-requests/' + requestId + '/supplier-quotes', headers,
      payload: { quoteNo: code('BAD'), supplierId: supplierA.id, lines: [] }
    });
    assert.equal(incomplete.statusCode, 400, incomplete.body);

    const quoteA = await app.inject({
      method: 'POST', url: '/api/v1/purchase-requests/' + requestId + '/supplier-quotes', headers,
      payload: { quoteNo: code('QA'), supplierId: supplierA.id, currencyCode: 'EGP', lines: [{ requestLineId: requestLine.id, quantity: 50, unitCost: 12.25 }] }
    });
    assert.equal(quoteA.statusCode, 201, quoteA.body);
    const quoteB = await app.inject({
      method: 'POST', url: '/api/v1/purchase-requests/' + requestId + '/supplier-quotes', headers,
      payload: { quoteNo: code('QB'), supplierId: supplierB.id, currencyCode: 'EGP', lines: [{ requestLineId: requestLine.id, quantity: 50, unitCost: 12.5 }] }
    });
    assert.equal(quoteB.statusCode, 201, quoteB.body);

    const comparison = await app.inject({ method: 'GET', url: '/api/v1/purchase-requests/' + requestId + '/quote-comparison', headers });
    assert.equal(comparison.statusCode, 200, comparison.body);
    assert.equal(comparison.json().length, 2);
    assert.equal(Number(comparison.json()[0].unit_cost), 12.25);

    const awarded = await app.inject({
      method: 'POST', url: '/api/v1/purchase-requests/' + requestId + '/supplier-quotes/' + quoteA.json().id + '/award',
      headers, payload: {}
    });
    assert.equal(awarded.statusCode, 200, awarded.body);
    assert.equal(awarded.json().status, 'AWARDED');

    const secondAward = await app.inject({
      method: 'POST', url: '/api/v1/purchase-requests/' + requestId + '/supplier-quotes/' + quoteB.json().id + '/award',
      headers, payload: {}
    });
    assert.equal(secondAward.statusCode, 409, secondAward.body);

    const converted = await app.inject({
      method: 'POST', url: '/api/v1/purchase-requests/' + requestId + '/convert-awarded-quote', headers,
      payload: { orderNo: code('PO') }
    });
    assert.equal(converted.statusCode, 201, converted.body);
    assert.equal(converted.json().purchaseOrder.supplier_id, supplierA.id);
    const orderLine = (await pool.query('SELECT ordered_qty,unit_cost FROM purchase_order_lines WHERE purchase_order_id=$1', [converted.json().purchaseOrder.id])).rows[0];
    assert.equal(Number(orderLine.ordered_qty), 50);
    assert.equal(Number(orderLine.unit_cost), 12.25);

    const repeated = await app.inject({
      method: 'POST', url: '/api/v1/purchase-requests/' + requestId + '/convert-awarded-quote', headers,
      payload: { orderNo: code('PO2') }
    });
    assert.equal(repeated.statusCode, 409, repeated.body);
  } finally {
    await app.close();
    await pool.end();
  }
});
