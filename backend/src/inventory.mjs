const auth=(app,p)=>({preHandler:[app.authenticate,app.requirePermission(p)]});
const fail=(rep,e)=>{if(e.code==='23505')return rep.code(409).send({error:'DUPLICATE'});if(e.code==='23503')return rep.code(409).send({error:'REFERENCED'});if(['23514','22P02'].includes(e.code))return rep.code(400).send({error:'INVALID_DATA'});if(e.code==='P0001')return rep.code(409).send({error:'BUSINESS_RULE',message:e.message});throw e;};
async function tx(db,fn){const c=await db.connect();try{await c.query('BEGIN');const v=await fn(c);await c.query('COMMIT');return v;}catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();}}
export async function inventoryRoutes(app,{db}){
 app.get('/api/v1/inventory/movements',{preHandler:[app.authenticate,app.requirePermission('INVENTORY.READ')]},async(req,rep)=>{
  try{return (await db.query(`SELECT m.*,i.code item_code,i.name_ar item_name,w.code warehouse_code
   FROM stock_movements m JOIN items i ON i.id=m.item_id JOIN warehouses w ON w.id=m.warehouse_id
   WHERE ($1::uuid IS NULL OR m.warehouse_id=$1) AND ($2::uuid IS NULL OR m.item_id=$2)
   ORDER BY m.created_at DESC LIMIT 1000`,[req.query?.warehouseId??null,req.query?.itemId??null])).rows;}catch(e){return fail(rep,e);}
 });
 app.post('/api/v1/inventory/adjustments',{preHandler:[app.authenticate,app.requirePermission('INVENTORY.ADJUST')]},async(req,rep)=>{
  const b=req.body??{};if(!b.adjustmentNo||typeof b.adjustmentNo!=='string'||!b.adjustmentNo.trim()||!b.warehouseId||typeof b.reason!=='string'||!b.reason.trim()||!Array.isArray(b.lines)||!b.lines.length||
   b.lines.some(x=>!x.itemId||!Number.isFinite(Number(x.quantityDelta))||Number(x.quantityDelta)===0||!Number.isFinite(Number(x.unitCost))||Number(x.unitCost)<0))return rep.code(400).send({error:'VALIDATION_ERROR'});
  try{const result=await tx(db,async c=>{
   const h=await c.query('INSERT INTO inventory_adjustments(adjustment_no,warehouse_id,reason,created_by) VALUES($1,$2,$3,$4) RETURNING *',[b.adjustmentNo.trim(),b.warehouseId,b.reason,req.authUser.user_id]);
   for(const l of b.lines)await c.query('INSERT INTO inventory_adjustment_lines(adjustment_id,item_id,lot_no,quantity_delta,unit_cost) VALUES($1,$2,$3,$4,$5)',[h.rows[0].id,l.itemId,l.lotNo??'',l.quantityDelta,l.unitCost]);
   return h.rows[0];
  });return rep.code(201).send(result);}catch(e){return fail(rep,e);}
 });
 app.post('/api/v1/inventory/adjustments/:id/approve',{preHandler:[app.authenticate,app.requirePermission('INVENTORY.ADJUST')]},async(req,rep)=>{
  try{const result=await tx(db,async c=>{
   const h=await c.query('SELECT * FROM inventory_adjustments WHERE id=$1 FOR UPDATE',[req.params.id]);
   if(!h.rowCount||h.rows[0].status!=='DRAFT')throw Object.assign(new Error('التسوية غير متاحة للاعتماد'),{code:'P0001'});
   const lines=await c.query('SELECT * FROM inventory_adjustment_lines WHERE adjustment_id=$1 ORDER BY id',[req.params.id]);
   let gain=0,loss=0;
   for(const l of lines.rows){
    const bal=await c.query('SELECT quantity,average_unit_cost,quality_status FROM inventory_balances WHERE warehouse_id=$1 AND item_id=$2 AND lot_no=$3 FOR UPDATE',[h.rows[0].warehouse_id,l.item_id,l.lot_no]);
    const old=bal.rowCount?Number(bal.rows[0].quantity):0,delta=Number(l.quantity_delta),cost=bal.rowCount?Number(bal.rows[0].average_unit_cost):Number(l.unit_cost);
    if(delta<0&&old+delta< -0.000001)throw Object.assign(new Error('التسوية ستؤدي إلى رصيد سالب'),{code:'P0001'});
    const qty=old+delta,avg=delta>0&&qty>0?((old*cost)+(delta*Number(l.unit_cost)))/qty:cost;
    await c.query(`INSERT INTO inventory_balances(warehouse_id,item_id,lot_no,quantity,average_unit_cost,quality_status)
     VALUES($1,$2,$3,$4,$5,'RELEASED') ON CONFLICT(warehouse_id,item_id,lot_no) DO UPDATE SET quantity=EXCLUDED.quantity,average_unit_cost=EXCLUDED.average_unit_cost,updated_at=NOW()`,
     [h.rows[0].warehouse_id,l.item_id,l.lot_no,qty,avg]);
    const movement=delta>0?'ADJUSTMENT_IN':'ADJUSTMENT_OUT';
    await c.query(`INSERT INTO stock_movements(movement_no,warehouse_id,item_id,lot_no,movement_type,quantity_in,quantity_out,unit_cost,reference_type,reference_id,created_by)
     VALUES($1,$2,$3,$4,$5,$6,$7,$8,'INVENTORY_ADJUSTMENT',$9,$10)`,
     [`ADJ-${req.params.id.slice(0,12)}-${l.id.slice(0,8)}`,h.rows[0].warehouse_id,l.item_id,l.lot_no,movement,Math.max(delta,0),Math.max(-delta,0),cost,req.params.id,req.authUser.user_id]);
    if(delta>0)gain+=delta*Number(l.unit_cost);else loss+=(-delta)*cost;
   }
   const periods=await c.query('SELECT status FROM accounting_periods WHERE CURRENT_DATE BETWEEN start_date AND end_date FOR UPDATE');
   if(periods.rowCount&&periods.rows.some(x=>x.status!=='OPEN'))throw Object.assign(new Error('الفترة المحاسبية مغلقة'),{code:'P0001'});
   const ac=await c.query("SELECT code,id FROM gl_accounts WHERE code IN ('1200','5400')");
   const inv=ac.rows.find(x=>x.code==='1200')?.id,other=ac.rows.find(x=>x.code==='5400')?.id;
   if((gain>0||loss>0)&&(!inv||!other))throw Object.assign(new Error('حساب المخزون أو فروق الجرد غير معرف'),{code:'P0001'});
   const net=gain-loss;
   if(Math.abs(net)>0.000001){
    const debit=net>0?inv:other,credit=net>0?other:inv,amount=Math.abs(net);
    const je=await c.query(`INSERT INTO journal_entries(entry_no,source_type,source_id,description,total_debit,total_credit,created_by)
      VALUES($1,'INVENTORY_ADJUSTMENT',$2,'تسوية مخزون',$3,$3,$4) RETURNING id`,[`J-ADJ-${req.params.id.slice(0,12)}`,req.params.id,amount,req.authUser.user_id]);
    await c.query('INSERT INTO journal_lines(journal_entry_id,account_id,debit,credit) VALUES($1,$2,$3,0),($1,$4,0,$3)',[je.rows[0].id,debit,amount,credit]);
   }
   await c.query(`UPDATE inventory_adjustments SET status='POSTED',approved_by=$1,approved_at=NOW() WHERE id=$2`,[req.authUser.user_id,req.params.id]);
   return {id:req.params.id,status:'POSTED',gain,loss};
  });return result;}catch(e){return fail(rep,e);}
 });
}
