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
      components:[{componentCode:'LABOR',description:'أجور اختبار',amount:10},{componentCode:'ENERGY',description:'طاقة اختبار',amount:2}]
    }});
    assert.equal(costs.statusCode,200,costs.body);
    assert.equal(Number(costs.json().unit_production_cost),7.6);
    const costJournal = await pool.query("SELECT id,total_debit,total_credit FROM journal_entries WHERE source_type='PRODUCTION_COST' AND source_id=$1 AND status='POSTED'",[orderId]);
    assert.equal(costJournal.rowCount,1);
    assert.equal(Number(costJournal.rows[0].total_debit),12);
    assert.equal(Number(costJournal.rows[0].total_credit),12);
    const costJournalLines = await pool.query('SELECT a.code,l.debit,l.credit FROM journal_lines l JOIN gl_accounts a ON a.id=l.account_id WHERE l.journal_entry_id=$1 ORDER BY a.code',[costJournal.rows[0].id]);
    assert.deepEqual(costJournalLines.rows.map(x=>[x.code,Number(x.debit),Number(x.credit)]),[['1200',12,0],['5100',0,10],['5200',0,2]]);
    const duplicateCosts = await app.inject({method:'POST',url:'/api/v1/production/orders/'+orderId+'/costs',headers,payload:{
      components:[{componentCode:'LABOR',description:'أجور اختبار',amount:10}]
    }});
    assert.equal(duplicateCosts.statusCode,409);
    const failed = await app.inject({method:'POST',url:'/api/v1/production/orders/'+orderId+'/quality',headers,payload:{result:'FAIL',notes:'فشل اختبار'}});
    assert.equal(failed.statusCode,200,failed.body);
    assert.equal(failed.json().availableForSale,false);
    const releasedAgain = await app.inject({method:'POST',url:'/api/v1/production/orders/'+orderId+'/quality',headers,payload:{result:'PASS',notes:'اجتاز إعادة الفحص'}});
    assert.equal(releasedAgain.statusCode,200,releasedAgain.body);
    assert.equal(releasedAgain.json().availableForSale,true);

    const finalBalance = await pool.query('SELECT quantity,average_unit_cost,quality_status FROM inventory_balances WHERE warehouse_id=$1 AND item_id=$2 AND lot_no=$3',[warehouse.id,finished.id,completed.json().outputLotNo || (await pool.query('SELECT lot_no FROM production_outputs WHERE production_order_id=$1',[orderId])).rows[0].lot_no]);
    assert.equal(Number(finalBalance.rows[0].quantity),10);
    assert.equal(Number(finalBalance.rows[0].average_unit_cost),7.6);
    assert.equal(finalBalance.rows[0].quality_status,'RELEASED');
    assert.equal(userId.length,36);
  } finally {
    await app.close();
    await pool.end();
  }
});
