import test from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import { buildApp } from '../src/app.mjs';

const enabled = Boolean(process.env.DATABASE_URL && process.env.BOOTSTRAP_ADMIN_USERNAME && process.env.BOOTSTRAP_ADMIN_PASSWORD);

test('PostgreSQL inventory transfer: approval, lot/expiry preservation, weighted average, ledger pairing and negative-stock prevention', { skip: !enabled }, async () => {
 const pool=new pg.Pool({connectionString:process.env.DATABASE_URL});
 const app=buildApp({logger:false,db:pool,jwtSecret:process.env.AUTH_JWT_SECRET});
 const suffix=Date.now().toString(),code=p=>(p+suffix).slice(0,40),lot='TRF-LOT-'+suffix;
 try{
  const login=await app.inject({method:'POST',url:'/api/v1/auth/login',payload:{username:process.env.BOOTSTRAP_ADMIN_USERNAME,password:process.env.BOOTSTRAP_ADMIN_PASSWORD}});
  assert.equal(login.statusCode,200,login.body);
  const headers={authorization:'Bearer '+login.json().accessToken,'content-type':'application/json'};
  const userId=login.json().user.id;
  const company=(await pool.query('INSERT INTO companies(code,name_ar) VALUES($1,$2) RETURNING id',[code('TRCO'),'شركة تحويل اختبار'])).rows[0];
  const plant=(await pool.query('INSERT INTO plants(company_id,code,name_ar) VALUES($1,$2,$3) RETURNING id',[company.id,code('TRPL'),'مصنع تحويل اختبار'])).rows[0];
  const source=(await pool.query('INSERT INTO warehouses(plant_id,code,name_ar) VALUES($1,$2,$3) RETURNING id',[plant.id,code('TRS'),'مخزن مصدر'])).rows[0];
  const dest=(await pool.query('INSERT INTO warehouses(plant_id,code,name_ar) VALUES($1,$2,$3) RETURNING id',[plant.id,code('TRD'),'مخزن وجهة'])).rows[0];
  const unit=(await pool.query('INSERT INTO units_of_measure(code,name_ar) VALUES($1,$2) RETURNING id',[code('TRKG'),'كيلوجرام'])).rows[0];
  const category=(await pool.query("INSERT INTO item_categories(code,name_ar,category_kind) VALUES($1,$2,'RAW_MATERIAL') RETURNING id",[code('TRCAT'),'خامة تحويل'])).rows[0];
  const item=(await pool.query('INSERT INTO items(code,name_ar,category_id,base_unit_id,tracks_lot,tracks_expiry) VALUES($1,$2,$3,$4,TRUE,TRUE) RETURNING id',[code('TRITEM'),'ذرة تحويل',category.id,unit.id])).rows[0];
  await pool.query("INSERT INTO inventory_balances(warehouse_id,item_id,lot_no,expiry_date,quantity,average_unit_cost,quality_status) VALUES($1,$3,$4,'2027-12-31',10,5,'RELEASED'),($2,$3,$4,'2027-12-31',2,10,'RELEASED')",[source.id,dest.id,item.id,lot]);
  const draft=await app.inject({method:'POST',url:'/api/v1/inventory/transfers',headers,payload:{transferNo:code('TRF'),sourceWarehouseId:source.id,destinationWarehouseId:dest.id,reason:'نقل مخزون بين المخازن',lines:[{itemId:item.id,lotNo:lot,quantity:4}]}});
  assert.equal(draft.statusCode,201,draft.body);
  const id=draft.json().id;
  const before=await pool.query('SELECT quantity FROM inventory_balances WHERE warehouse_id=$1 AND item_id=$2 AND lot_no=$3',[source.id,item.id,lot]);
  assert.equal(Number(before.rows[0].quantity),10,'draft transfer must not change stock');
  const approved=await app.inject({method:'POST',url:'/api/v1/inventory/transfers/'+id+'/approve',headers,payload:{}});
  assert.equal(approved.statusCode,200,approved.body);
  assert.equal(approved.json().status,'POSTED');
  const balances=await pool.query('SELECT warehouse_id,quantity,average_unit_cost,quality_status,TO_CHAR(expiry_date,\'YYYY-MM-DD\') expiry FROM inventory_balances WHERE item_id=$1 AND lot_no=$2 ORDER BY warehouse_id',[item.id,lot]);
  const byWarehouse=new Map(balances.rows.map(x=>[x.warehouse_id,x]));
  assert.equal(Number(byWarehouse.get(source.id).quantity),6);
  assert.equal(Number(byWarehouse.get(dest.id).quantity),6);
  assert.ok(Math.abs(Number(byWarehouse.get(dest.id).average_unit_cost)-6.6666666667)<0.00001);
  assert.equal(byWarehouse.get(dest.id).quality_status,'RELEASED');
  assert.equal(String(byWarehouse.get(dest.id).expiry).slice(0,10),'2027-12-31');
  const movements=await pool.query("SELECT movement_type,quantity_in,quantity_out,unit_cost FROM stock_movements WHERE reference_type='INVENTORY_TRANSFER' AND reference_id=$1 ORDER BY movement_type",[id]);
  assert.equal(movements.rowCount,2);
  assert.deepEqual(movements.rows.map(x=>x.movement_type),['TRANSFER_IN','TRANSFER_OUT']);
  assert.equal(movements.rows.reduce((n,x)=>n+Number(x.quantity_in)-Number(x.quantity_out),0),0);
  const duplicate=await app.inject({method:'POST',url:'/api/v1/inventory/transfers/'+id+'/approve',headers,payload:{}});
  assert.equal(duplicate.statusCode,409,'a transfer cannot be posted twice');
  const shortage=await app.inject({method:'POST',url:'/api/v1/inventory/transfers',headers,payload:{transferNo:code('SHORT'),sourceWarehouseId:source.id,destinationWarehouseId:dest.id,reason:'اختبار منع السالب',lines:[{itemId:item.id,lotNo:lot,quantity:7}]}});
  assert.equal(shortage.statusCode,201,shortage.body);
  const rejected=await app.inject({method:'POST',url:'/api/v1/inventory/transfers/'+shortage.json().id+'/approve',headers,payload:{}});
  assert.equal(rejected.statusCode,409,rejected.body);
  const after=await pool.query('SELECT quantity FROM inventory_balances WHERE warehouse_id=$1 AND item_id=$2 AND lot_no=$3',[source.id,item.id,lot]);
  assert.equal(Number(after.rows[0].quantity),6,'failed transfer must roll back without negative stock');
  const list=await app.inject({method:'GET',url:'/api/v1/inventory/transfers',headers});
  assert.equal(list.statusCode,200,list.body);
  assert.ok(list.json().some(x=>x.id===id&&x.lines.length===1));
 }finally{await app.close();await pool.end();}
});
