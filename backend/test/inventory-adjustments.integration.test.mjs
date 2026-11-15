import test from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import { buildApp } from '../src/app.mjs';

const enabled=Boolean(process.env.DATABASE_URL&&process.env.BOOTSTRAP_ADMIN_USERNAME&&process.env.BOOTSTRAP_ADMIN_PASSWORD);
test('PostgreSQL inventory adjustment: positive quantity remains held until inspection, quarantine and reinspection are audited', {skip:!enabled}, async()=>{
 const pool=new pg.Pool({connectionString:process.env.DATABASE_URL});
 const app=buildApp({logger:false,db:pool,jwtSecret:process.env.AUTH_JWT_SECRET});
 const suffix=Date.now().toString(),code=p=>(p+suffix).slice(0,40),lot='ADJ-QC-'+suffix;
 try{
  const login=await app.inject({method:'POST',url:'/api/v1/auth/login',payload:{
   username:process.env.BOOTSTRAP_ADMIN_USERNAME,password:process.env.BOOTSTRAP_ADMIN_PASSWORD
  }});
  assert.equal(login.statusCode,200,login.body);
  const headers={authorization:'Bearer '+login.json().accessToken,'content-type':'application/json'};
  const company=(await pool.query('INSERT INTO companies(code,name_ar) VALUES($1,$2) RETURNING id',[code('AQCO'),'شركة تسوية جودة'])).rows[0];
  const plant=(await pool.query('INSERT INTO plants(company_id,code,name_ar) VALUES($1,$2,$3) RETURNING id',[company.id,code('AQPL'),'مصنع تسوية'])).rows[0];
  const warehouse=(await pool.query('INSERT INTO warehouses(plant_id,code,name_ar) VALUES($1,$2,$3) RETURNING id',[plant.id,code('AQWH'),'مخزن تسوية'])).rows[0];
  const unit=(await pool.query('INSERT INTO units_of_measure(code,name_ar) VALUES($1,$2) RETURNING id',[code('AQKG'),'كيلوجرام'])).rows[0];
  const category=(await pool.query("INSERT INTO item_categories(code,name_ar,category_kind) VALUES($1,$2,'RAW_MATERIAL') RETURNING id",[code('AQCAT'),'خامات تسوية'])).rows[0];
  const item=(await pool.query('INSERT INTO items(code,name_ar,category_id,base_unit_id,tracks_lot) VALUES($1,$2,$3,$4,TRUE) RETURNING id',[code('AQITEM'),'خامة تسوية جديدة',category.id,unit.id])).rows[0];

  const created=await app.inject({method:'POST',url:'/api/v1/inventory/adjustments',headers,payload:{
   adjustmentNo:code('ADJ-QC'),warehouseId:warehouse.id,reason:'إضافة رصيد جديد يحتاج فحص الجودة',
   lines:[{itemId:item.id,lotNo:lot,quantityDelta:5,unitCost:4}]
  }});
  assert.equal(created.statusCode,201,created.body);
  const adjustmentId=created.json().id;
  const adjustmentLine=(await pool.query('SELECT id FROM inventory_adjustment_lines WHERE adjustment_id=$1',[adjustmentId])).rows[0];
  const approved=await app.inject({method:'POST',url:'/api/v1/inventory/adjustments/'+adjustmentId+'/approve',headers,payload:{}});
  assert.equal(approved.statusCode,200,approved.body);
  assert.equal(approved.json().status,'POSTED');

  const balance=(await pool.query('SELECT quantity,quality_status FROM inventory_balances WHERE warehouse_id=$1 AND item_id=$2 AND lot_no=$3',[warehouse.id,item.id,lot])).rows[0];
  assert.equal(Number(balance.quantity),5);
  assert.equal(balance.quality_status,'RELEASED');
  const hold=(await pool.query(`SELECT id,status,held_qty FROM inventory_quality_holds
   WHERE source_type='INVENTORY_ADJUSTMENT' AND source_id=$1 AND source_line_id=$2`,[adjustmentId,adjustmentLine.id])).rows[0];
  assert.ok(hold);
  assert.equal(hold.status,'PENDING_QC');
  assert.equal(Number(hold.held_qty),5);

  const before=await app.inject({method:'GET',url:'/api/v1/inventory/balances?warehouseId='+warehouse.id,headers});
  assert.equal(before.statusCode,200,before.body);
  let row=before.json().find(x=>x.item_id===item.id);
  assert.equal(Number(row.available_quantity),0);
  assert.equal(Number(row.quality_held_qty),5);

  const failInspection=await app.inject({method:'POST',url:'/api/v1/quality/inventory-holds/'+hold.id+'/inspect',headers,
   payload:{result:'FAIL',parameters:{moisture:18.5},notes:'الرطوبة أعلى من الحد المسموح'}});
  assert.equal(failInspection.statusCode,200,failInspection.body);
  assert.equal(failInspection.json().inventoryStatus,'QUARANTINED');

  const stillHeld=await app.inject({method:'GET',url:'/api/v1/inventory/balances?warehouseId='+warehouse.id,headers});
  row=stillHeld.json().find(x=>x.item_id===item.id);
  assert.equal(Number(row.available_quantity),0);
  assert.equal(Number(row.quality_held_qty),5);

  const passInspection=await app.inject({method:'POST',url:'/api/v1/quality/inventory-holds/'+hold.id+'/inspect',headers,
   payload:{result:'PASS',parameters:{moisture:11.2,protein:21.4},notes:'اجتازت إعادة الفحص'}});
  assert.equal(passInspection.statusCode,200,passInspection.body);
  assert.equal(passInspection.json().inventoryStatus,'RELEASED');

  const after=await app.inject({method:'GET',url:'/api/v1/inventory/balances?warehouseId='+warehouse.id,headers});
  row=after.json().find(x=>x.item_id===item.id);
  assert.equal(Number(row.available_quantity),5);
  assert.equal(Number(row.quality_held_qty),0);

  const history=await pool.query('SELECT attempt_no,result,inventory_status FROM inventory_quality_inspections WHERE quality_hold_id=$1 ORDER BY attempt_no',[hold.id]);
  assert.deepEqual(history.rows.map(x=>[x.attempt_no,x.result,x.inventory_status]),[
   [1,'FAIL','QUARANTINED'],[2,'PASS','RELEASED']
  ]);
  const list=await app.inject({method:'GET',url:'/api/v1/quality/inventory-holds',headers});
  assert.equal(list.statusCode,200,list.body);
  assert.ok(!list.json().some(x=>x.id===hold.id),'released holds must leave the pending/quarantine work queue');
  const duplicate=await app.inject({method:'POST',url:'/api/v1/quality/inventory-holds/'+hold.id+'/inspect',headers,payload:{result:'PASS'}});
  assert.equal(duplicate.statusCode,409,duplicate.body);

  const movement=await pool.query("SELECT quantity_in,quantity_out FROM stock_movements WHERE reference_type='INVENTORY_ADJUSTMENT' AND reference_id=$1",[adjustmentId]);
  assert.equal(movement.rowCount,1);
  assert.equal(Number(movement.rows[0].quantity_in),5);
  const journal=await pool.query("SELECT id,total_debit,total_credit FROM journal_entries WHERE source_type='INVENTORY_ADJUSTMENT' AND source_id=$1 AND status='POSTED'",[adjustmentId]);
  assert.equal(journal.rowCount,1);
  assert.equal(Number(journal.rows[0].total_debit),20);
  assert.equal(Number(journal.rows[0].total_credit),20);
 }finally{
  await app.close();
  await pool.end();
 }
});
