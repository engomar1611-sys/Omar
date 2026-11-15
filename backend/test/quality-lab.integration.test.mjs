import test from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import { buildApp } from '../src/app.mjs';

const enabled = Boolean(process.env.DATABASE_URL && process.env.BOOTSTRAP_ADMIN_USERNAME && process.env.BOOTSTRAP_ADMIN_PASSWORD);

test('quality lab specification, sample results and mandatory pass gate for raw material receipt', { skip: !enabled }, async () => {
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

    const company = (await pool.query('INSERT INTO companies(code,name_ar) VALUES($1,$2) RETURNING id', [code('QC'), 'شركة معمل جودة اختبار'])).rows[0];
    const plant = (await pool.query('INSERT INTO plants(company_id,code,name_ar) VALUES($1,$2,$3) RETURNING id', [company.id, code('PL'), 'مصنع معمل جودة'])).rows[0];
    const warehouse = (await pool.query('INSERT INTO warehouses(plant_id,code,name_ar) VALUES($1,$2,$3) RETURNING id', [plant.id, code('WH'), 'مخزن معمل جودة'])).rows[0];
    const unit = (await pool.query('INSERT INTO units_of_measure(code,name_ar) VALUES($1,$2) RETURNING id', [code('KG'), 'كيلوجرام'])).rows[0];
    const category = (await pool.query("INSERT INTO item_categories(code,name_ar,category_kind) VALUES($1,$2,'RAW_MATERIAL') RETURNING id", [code('RM'), 'خامة معمل جودة'])).rows[0];
    const item = (await pool.query('INSERT INTO items(code,name_ar,category_id,base_unit_id) VALUES($1,$2,$3,$4) RETURNING id', [code('SOY'), 'صويا معمل جودة', category.id, unit.id])).rows[0];
    const supplier = (await pool.query('INSERT INTO suppliers(code,name_ar) VALUES($1,$2) RETURNING id', [code('SUP'), 'مورد معمل جودة'])).rows[0];

    const po = await app.inject({
      method: 'POST', url: '/api/v1/purchases', headers,
      payload: { orderNo: code('PO'), supplierId: supplier.id, warehouseId: warehouse.id,
        lines: [{ itemId: item.id, quantity: 5, unitCost: 10 }] }
    });
    assert.equal(po.statusCode, 201, po.body);
    const poId = po.json().id;
    const poLine = (await pool.query('SELECT id FROM purchase_order_lines WHERE purchase_order_id=$1', [poId])).rows[0];
    const approvePO = await app.inject({ method: 'POST', url: '/api/v1/purchases/' + poId + '/approve', headers, payload: {} });
    assert.equal(approvePO.statusCode, 200, approvePO.body);

    const receipt = await app.inject({
      method: 'POST', url: '/api/v1/goods-receipts', headers,
      payload: { receiptNo: code('GR'), purchaseOrderId: poId,
        lines: [{ purchaseOrderLineId: poLine.id, quantity: 5, lotNo: 'QC-' + suffix }] }
    });
    assert.equal(receipt.statusCode, 201, receipt.body);
    const receiptId = receipt.json().id;
    const receiptLine = (await pool.query('SELECT id FROM goods_receipt_lines WHERE goods_receipt_id=$1', [receiptId])).rows[0];

    const spec = await app.inject({
      method: 'POST', url: '/api/v1/quality/specifications', headers,
      payload: { itemId: item.id, stage: 'RAW_MATERIAL', versionNo: 1, sampleQuantity: 0.25, frequencyKg: 1000,
        parameters: [
          { parameterCode: 'MOISTURE', name: 'نسبة الرطوبة', unit: '%', minimum: 0, maximum: 12, target: 10, required: true, method: 'Oven' },
          { parameterCode: 'PROTEIN', name: 'البروتين', unit: '%', minimum: 8, maximum: 20, target: 14, required: true, method: 'Lab' }
        ] }
    });
    assert.equal(spec.statusCode, 201, spec.body);

    const premature = await app.inject({
      method: 'POST', url: '/api/v1/goods-receipts/' + receiptId + '/quality', headers,
      payload: { inspections: [{ receiptLineId: receiptLine.id, result: 'PASS', acceptedQty: 5, rejectedQty: 0 }] }
    });
    assert.equal(premature.statusCode, 409, premature.body, 'active raw material specification requires a passed lab sample');

    const failedSample = await app.inject({
      method: 'POST', url: '/api/v1/quality/samples', headers,
      payload: { sampleNo: code('QCF'), sourceType: 'GOODS_RECEIPT', sourceId: receiptId, sourceLineId: receiptLine.id,
        itemId: item.id, warehouseId: warehouse.id, lotNo: 'QC-' + suffix, stage: 'RAW_MATERIAL', sampleQuantity: 0.25 }
    });
    assert.equal(failedSample.statusCode, 201, failedSample.body);
    const failedId = failedSample.json().sample.id;
    const failedResults = await app.inject({
      method: 'POST', url: '/api/v1/quality/samples/' + failedId + '/results', headers,
      payload: { results: [{ parameterCode: 'MOISTURE', numericValue: 13 }, { parameterCode: 'PROTEIN', numericValue: 14 }] }
    });
    assert.equal(failedResults.statusCode, 200, failedResults.body);
    const failedFinal = await app.inject({ method: 'POST', url: '/api/v1/quality/samples/' + failedId + '/finalize', headers, payload: {} });
    assert.equal(failedFinal.statusCode, 200, failedFinal.body);
    assert.equal(failedFinal.json().sample.status, 'FAILED');

    const passedSample = await app.inject({
      method: 'POST', url: '/api/v1/quality/samples', headers,
      payload: { sampleNo: code('QCP'), sourceType: 'GOODS_RECEIPT', sourceId: receiptId, sourceLineId: receiptLine.id,
        itemId: item.id, warehouseId: warehouse.id, lotNo: 'QC-' + suffix, stage: 'RAW_MATERIAL', sampleQuantity: 0.25 }
    });
    assert.equal(passedSample.statusCode, 201, passedSample.body);
    const passedId = passedSample.json().sample.id;
    const results = await app.inject({
      method: 'POST', url: '/api/v1/quality/samples/' + passedId + '/results', headers,
      payload: { results: [{ parameterCode: 'MOISTURE', numericValue: 11.5 }, { parameterCode: 'PROTEIN', numericValue: 14 }] }
    });
    assert.equal(results.statusCode, 200, results.body);
    const finalized = await app.inject({ method: 'POST', url: '/api/v1/quality/samples/' + passedId + '/finalize', headers, payload: {} });
    assert.equal(finalized.statusCode, 200, finalized.body);
    assert.equal(finalized.json().sample.status, 'PASSED');

    const lateFail = await app.inject({
      method: 'POST', url: '/api/v1/quality/samples', headers,
      payload: { sampleNo: code('QCLATE'), sourceType: 'GOODS_RECEIPT', sourceId: receiptId, sourceLineId: receiptLine.id,
        itemId: item.id, warehouseId: warehouse.id, lotNo: 'QC-' + suffix, stage: 'RAW_MATERIAL', sampleQuantity: 0.25 }
    });
    assert.equal(lateFail.statusCode, 201, lateFail.body);
    const lateFailResults = await app.inject({
      method: 'POST', url: '/api/v1/quality/samples/' + lateFail.json().sample.id + '/results', headers,
      payload: { results: [{ parameterCode: 'MOISTURE', numericValue: 13 }, { parameterCode: 'PROTEIN', numericValue: 14 }] }
    });
    assert.equal(lateFailResults.statusCode, 200, lateFailResults.body);
    const lateFailFinal = await app.inject({ method: 'POST', url: '/api/v1/quality/samples/' + lateFail.json().sample.id + '/finalize', headers, payload: {} });
    assert.equal(lateFailFinal.json().sample.status, 'FAILED');
    const blockedByLatest = await app.inject({
      method: 'POST', url: '/api/v1/goods-receipts/' + receiptId + '/quality', headers,
      payload: { inspections: [{ receiptLineId: receiptLine.id, result: 'PASS', acceptedQty: 5, rejectedQty: 0 }] }
    });
    assert.equal(blockedByLatest.statusCode, 409, blockedByLatest.body, 'a newer failed sample invalidates an older passed sample');

    const finalPass = await app.inject({
      method: 'POST', url: '/api/v1/quality/samples', headers,
      payload: { sampleNo: code('QCFINAL'), sourceType: 'GOODS_RECEIPT', sourceId: receiptId, sourceLineId: receiptLine.id,
        itemId: item.id, warehouseId: warehouse.id, lotNo: 'QC-' + suffix, stage: 'RAW_MATERIAL', sampleQuantity: 0.25 }
    });
    assert.equal(finalPass.statusCode, 201, finalPass.body);
    const finalPassResults = await app.inject({
      method: 'POST', url: '/api/v1/quality/samples/' + finalPass.json().sample.id + '/results', headers,
      payload: { results: [{ parameterCode: 'MOISTURE', numericValue: 11.5 }, { parameterCode: 'PROTEIN', numericValue: 14 }] }
    });
    assert.equal(finalPassResults.statusCode, 200, finalPassResults.body);
    const finalPassResult = await app.inject({ method: 'POST', url: '/api/v1/quality/samples/' + finalPass.json().sample.id + '/finalize', headers, payload: {} });
    assert.equal(finalPassResult.json().sample.status, 'PASSED');

    const quality = await app.inject({
      method: 'POST', url: '/api/v1/goods-receipts/' + receiptId + '/quality', headers,
      payload: { inspections: [{ receiptLineId: receiptLine.id, result: 'PASS', acceptedQty: 5, rejectedQty: 0 }] }
    });
    assert.equal(quality.statusCode, 200, quality.body);
    assert.equal(quality.json().status, 'ACCEPTED');
    const certificates = await app.inject({ method: 'GET', url: '/api/v1/quality/certificates?itemId=' + item.id + '&lotNo=' + encodeURIComponent('QC-' + suffix), headers });
    assert.equal(certificates.statusCode, 200, certificates.body);
    assert.equal(certificates.json().length, 0, 'raw material sample does not issue a finished-goods COA');
  } finally {
    await app.close();
    await pool.end();
  }
});
