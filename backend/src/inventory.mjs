const auth=(app,p)=>({preHandler:[app.authenticate,app.requirePermission(p)]});
const fail=(rep,e)=>{if(e.code==='23505')return rep.code(409).send({error:'DUPLICATE'});if(e.code==='23503')return rep.code(409).send({error:'REFERENCED'});if(['23514','22P02'].includes(e.code))return rep.code(400).send({error:'INVALID_DATA'});if(e.code==='P0001')return rep.code(409).send({error:'BUSINESS_RULE',message:e.message});throw e;};
async function tx(db,fn){const c=await db.connect();try{await c.query('BEGIN');const v=await fn(c);await c.query('COMMIT');return v;}catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();}}
export async function inventoryRoutes(app,{db}){
 app.get('/api/v1/inventory/adjustments',{preHandler:[app.authenticate,app.requirePermission('INVENTORY.READ')]},async(req,rep)=>{
  try{return (await db.query(`SELECT a.*,w.code warehouse_code,w.name_ar warehouse_name,u.display_name created_by_name,
    approver.display_name approved_by_name,
    COALESCE(json_agg(json_build_object('id',l.id,'itemId',l.item_id,'itemCode',i.code,'itemName',i.name_ar,
      'lotNo',l.lot_no,'quantityDelta',l.quantity_delta,'unitCost',l.unit_cost)
      ORDER BY i.code,l.lot_no) FILTER(WHERE l.id IS NOT NULL),'[]'::json) lines
    FROM inventory_adjustments a JOIN warehouses w ON w.id=a.warehouse_id
    LEFT JOIN users u ON u.id=a.created_by LEFT JOIN users approver ON approver.id=a.approved_by
    LEFT JOIN inventory_adjustment_lines l ON l.adjustment_id=a.id LEFT JOIN items i ON i.id=l.item_id
    GROUP BY a.id,w.code,w.name_ar,u.display_name,approver.display_name ORDER BY a.created_at DESC LIMIT 500`)).rows;}
  catch(e){return fail(rep,e);}
 });
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
 app.post('/api/v1/inventory/adjustments/:id/approve',{preHandler:[app.authenticate,app.requirePermission('INVENTORY.ADJUST.APPROVE')]},async(req,rep)=>{
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
     VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(warehouse_id,item_id,lot_no) DO UPDATE SET quantity=EXCLUDED.quantity,average_unit_cost=EXCLUDED.average_unit_cost,updated_at=NOW()`,
     [h.rows[0].warehouse_id,l.item_id,l.lot_no,qty,avg,bal.rowCount?bal.rows[0].quality_status:'PENDING_QC']);
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
 app.get('/api/v1/inventory/transfers',{preHandler:[app.authenticate,app.requirePermission('INVENTORY.READ')]},async(req,rep)=>{
  try{return (await db.query(`SELECT t.*,sw.code source_warehouse_code,dw.code destination_warehouse_code,
    COALESCE(json_agg(json_build_object('id',l.id,'itemId',l.item_id,'itemCode',i.code,'itemName',i.name_ar,
      'lotNo',l.lot_no,'quantity',l.quantity)
      ORDER BY i.code,l.lot_no) FILTER(WHERE l.id IS NOT NULL),'[]'::json) lines
    FROM inventory_transfers t JOIN warehouses sw ON sw.id=t.source_warehouse_id
    JOIN warehouses dw ON dw.id=t.destination_warehouse_id
    LEFT JOIN inventory_transfer_lines l ON l.transfer_id=t.id LEFT JOIN items i ON i.id=l.item_id
    GROUP BY t.id,sw.code,dw.code ORDER BY t.created_at DESC LIMIT 500`)).rows;}
  catch(e){return fail(rep,e);}
 });
 app.post('/api/v1/inventory/transfers',{preHandler:[app.authenticate,app.requirePermission('INVENTORY.TRANSFER')]},async(req,rep)=>{
  const b=req.body??{};
  if(!b.transferNo||typeof b.transferNo!=='string'||!b.transferNo.trim()||!b.sourceWarehouseId||!b.destinationWarehouseId||
    b.sourceWarehouseId===b.destinationWarehouseId||!Array.isArray(b.lines)||!b.lines.length||
    b.lines.some(x=>!x.itemId||!Number.isFinite(Number(x.quantity))||Number(x.quantity)<=0))
    return rep.code(400).send({error:'VALIDATION_ERROR'});
  try{
   const result=await tx(db,async c=>{
    const h=await c.query(`INSERT INTO inventory_transfers(transfer_no,source_warehouse_id,destination_warehouse_id,reason,created_by)
     VALUES($1,$2,$3,$4,$5) RETURNING *`,[b.transferNo.trim(),b.sourceWarehouseId,b.destinationWarehouseId,String(b.reason??''),req.authUser.user_id]);
    for(const l of b.lines)await c.query(`INSERT INTO inventory_transfer_lines(transfer_id,item_id,lot_no,quantity)
     VALUES($1,$2,$3,$4)`,[h.rows[0].id,l.itemId,l.lotNo??'',l.quantity]);
    return h.rows[0];
   });
   return rep.code(201).send(result);
  }catch(e){return fail(rep,e);}
 });
 app.post('/api/v1/inventory/transfers/:id/approve',{preHandler:[app.authenticate,app.requirePermission('INVENTORY.TRANSFER.APPROVE')]},async(req,rep)=>{
  try{
   const result=await tx(db,async c=>{
    const h=await c.query('SELECT * FROM inventory_transfers WHERE id=$1 FOR UPDATE',[req.params.id]);
    if(!h.rowCount||h.rows[0].status!=='DRAFT')throw Object.assign(new Error('التحويل غير متاح للاعتماد'),{code:'P0001'});
    const lines=await c.query('SELECT * FROM inventory_transfer_lines WHERE transfer_id=$1 ORDER BY item_id,lot_no FOR UPDATE',[req.params.id]);
    if(!lines.rowCount)throw Object.assign(new Error('التحويل لا يحتوي على أصناف'),{code:'P0001'});
    for(const l of lines.rows){
     const locked=await c.query(`SELECT warehouse_id,quantity,average_unit_cost,expiry_date,quality_status FROM inventory_balances
      WHERE warehouse_id IN ($1,$2) AND item_id=$3 AND lot_no=$4 ORDER BY warehouse_id FOR UPDATE`,
      [h.rows[0].source_warehouse_id,h.rows[0].destination_warehouse_id,l.item_id,l.lot_no]);
     const s=locked.rows.find(x=>x.warehouse_id===h.rows[0].source_warehouse_id);
     const d=locked.rows.find(x=>x.warehouse_id===h.rows[0].destination_warehouse_id);
     if(!s||Number(s.quantity)+0.000001<Number(l.quantity))
      throw Object.assign(new Error('الرصيد غير كافٍ لإتمام التحويل'),{code:'P0001'});
     const qty=Number(l.quantity),cost=Number(s.average_unit_cost);
     if(d&&String(d.expiry_date??'')!==String(s.expiry_date??''))
      throw Object.assign(new Error('لا يمكن دمج نفس التشغيلة بتاريخي صلاحية مختلفين'),{code:'P0001'});
     const oldQty=d?Number(d.quantity):0;
     const oldCost=d?Number(d.average_unit_cost):0;
     const newQty=oldQty+qty,newCost=newQty>0?((oldQty*oldCost)+(qty*cost))/newQty:cost;
     const qualityStatus=!d?s.quality_status:(d.quality_status===s.quality_status?s.quality_status:
      (d.quality_status==='QUARANTINED'||s.quality_status==='QUARANTINED'?'QUARANTINED':'PENDING_QC'));
     await c.query('UPDATE inventory_balances SET quantity=quantity-$4,updated_at=NOW() WHERE warehouse_id=$1 AND item_id=$2 AND lot_no=$3',
      [h.rows[0].source_warehouse_id,l.item_id,l.lot_no,qty]);
     await c.query(`INSERT INTO inventory_balances(warehouse_id,item_id,lot_no,expiry_date,quantity,average_unit_cost,quality_status)
      VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(warehouse_id,item_id,lot_no) DO UPDATE
      SET quantity=EXCLUDED.quantity,average_unit_cost=EXCLUDED.average_unit_cost,expiry_date=EXCLUDED.expiry_date,
       quality_status=EXCLUDED.quality_status,updated_at=NOW()`,
      [h.rows[0].destination_warehouse_id,l.item_id,l.lot_no,s.expiry_date,newQty,newCost,qualityStatus]);
     await c.query(`INSERT INTO stock_movements(movement_no,warehouse_id,item_id,lot_no,movement_type,quantity_in,quantity_out,unit_cost,reference_type,reference_id,created_by)
      VALUES($1,$2,$3,$4,'TRANSFER_OUT',0,$5,$6,'INVENTORY_TRANSFER',$7,$8),
            ($9,$10,$3,$4,'TRANSFER_IN',$5,0,$6,'INVENTORY_TRANSFER',$7,$8)`,
      [`TRF-O-${req.params.id.slice(0,12)}-${l.id.slice(0,8)}`,h.rows[0].source_warehouse_id,l.item_id,l.lot_no,qty,cost,req.params.id,req.authUser.user_id,
       `TRF-I-${req.params.id.slice(0,12)}-${l.id.slice(0,8)}`,h.rows[0].destination_warehouse_id]);
    }
    await c.query(`UPDATE inventory_transfers SET status='POSTED',approved_by=$1,approved_at=NOW() WHERE id=$2`,[req.authUser.user_id,req.params.id]);
    return {id:req.params.id,status:'POSTED',lineCount:lines.rowCount};
   });
   return result;
  }catch(e){return fail(rep,e);}
 });

 app.get('/api/v1/inventory/counts',{preHandler:[app.authenticate,app.requirePermission('INVENTORY.READ')]},async(req,rep)=>{
  try{return (await db.query(`SELECT c.*,w.code warehouse_code,
   COALESCE(json_agg(json_build_object('id',l.id,'itemId',l.item_id,'itemCode',i.code,'itemName',i.name_ar,
    'lotNo',l.lot_no,'expectedQty',l.expected_qty,'countedQty',l.counted_qty,'unitCost',l.unit_cost)
    ORDER BY i.code,l.lot_no) FILTER(WHERE l.id IS NOT NULL),'[]'::json) lines
   FROM inventory_counts c JOIN warehouses w ON w.id=c.warehouse_id
   LEFT JOIN inventory_count_lines l ON l.count_id=c.id LEFT JOIN items i ON i.id=l.item_id
   GROUP BY c.id,w.code ORDER BY c.created_at DESC LIMIT 300`)).rows;}
  catch(e){return fail(rep,e);}
 });
 app.post('/api/v1/inventory/counts',{preHandler:[app.authenticate,app.requirePermission('INVENTORY.COUNT')]},async(req,rep)=>{
  const b=req.body??{};
  if(typeof b.countNo!=='string'||!b.countNo.trim()||!b.warehouseId)return rep.code(400).send({error:'VALIDATION_ERROR'});
  try{
   const out=await tx(db,async c=>{
    const h=await c.query(`INSERT INTO inventory_counts(count_no,warehouse_id,count_date,reason,created_by)
     VALUES($1,$2,COALESCE($3::date,CURRENT_DATE),$4,$5) RETURNING *`,
     [b.countNo.trim(),b.warehouseId,b.countDate??null,String(b.reason??''),req.authUser.user_id]);
    await c.query(`INSERT INTO inventory_count_lines(count_id,item_id,lot_no,expected_qty,unit_cost)
     SELECT $1,item_id,lot_no,quantity,average_unit_cost FROM inventory_balances WHERE warehouse_id=$2
     ON CONFLICT(count_id,item_id,lot_no) DO NOTHING`,[h.rows[0].id,b.warehouseId]);
    return h.rows[0];
   });
   return rep.code(201).send(out);
  }catch(e){return fail(rep,e);}
 });
 app.post('/api/v1/inventory/counts/:id/lines',{preHandler:[app.authenticate,app.requirePermission('INVENTORY.COUNT')]},async(req,rep)=>{
  const b=req.body??{};
  if(!b.itemId||!Number.isFinite(Number(b.unitCost))||Number(b.unitCost)<0||!Number.isFinite(Number(b.countedQty))||Number(b.countedQty)<0)
   return rep.code(400).send({error:'VALIDATION_ERROR'});
  try{
   const out=await tx(db,async c=>{
    const h=await c.query("SELECT * FROM inventory_counts WHERE id=$1 FOR UPDATE",[req.params.id]);
    if(!h.rowCount||h.rows[0].status!=='DRAFT')throw Object.assign(new Error('الجرد غير قابل للتعديل'),{code:'P0001'});
    const existing=await c.query('SELECT 1 FROM inventory_count_lines WHERE count_id=$1 AND item_id=$2 AND lot_no=$3',[req.params.id,b.itemId,b.lotNo??'']);
    if(existing.rowCount)throw Object.assign(new Error('الصنف والتشغيلة موجودان بالفعل في الجرد'),{code:'P0001'});
    const r=await c.query(`INSERT INTO inventory_count_lines(count_id,item_id,lot_no,expected_qty,counted_qty,unit_cost)
     VALUES($1,$2,$3,0,$4,$5) RETURNING *`,[req.params.id,b.itemId,b.lotNo??'',b.countedQty,b.unitCost]);
    return r.rows[0];
   });return rep.code(201).send(out);
  }catch(e){return fail(rep,e);}
 });
 app.put('/api/v1/inventory/counts/:id/lines/:lineId',{preHandler:[app.authenticate,app.requirePermission('INVENTORY.COUNT')]},async(req,rep)=>{
  const qty=Number(req.body?.countedQty);
  if(!Number.isFinite(qty)||qty<0)return rep.code(400).send({error:'VALIDATION_ERROR'});
  try{
   const out=await tx(db,async c=>{
    const h=await c.query("SELECT status FROM inventory_counts WHERE id=$1 FOR UPDATE",[req.params.id]);
    if(!h.rowCount||h.rows[0].status!=='DRAFT')throw Object.assign(new Error('الجرد غير قابل للتعديل'),{code:'P0001'});
    const r=await c.query('UPDATE inventory_count_lines SET counted_qty=$1 WHERE id=$2 AND count_id=$3 RETURNING *',[qty,req.params.lineId,req.params.id]);
    if(!r.rowCount)throw Object.assign(new Error('بند الجرد غير موجود'),{code:'P0001'});
    return r.rows[0];
   });return out;
  }catch(e){return fail(rep,e);}
 });
 app.post('/api/v1/inventory/counts/:id/submit',{preHandler:[app.authenticate,app.requirePermission('INVENTORY.COUNT')]},async(req,rep)=>{
  try{
   const out=await tx(db,async c=>{
    const h=await c.query("SELECT status FROM inventory_counts WHERE id=$1 FOR UPDATE",[req.params.id]);
    if(!h.rowCount||h.rows[0].status!=='DRAFT')throw Object.assign(new Error('الجرد غير قابل للإرسال'),{code:'P0001'});
    const missing=await c.query('SELECT COUNT(*)::int n FROM inventory_count_lines WHERE count_id=$1 AND counted_qty IS NULL',[req.params.id]);
    if(missing.rows[0].n)throw Object.assign(new Error('يجب تسجيل الكمية الفعلية لكل بنود الجرد'),{code:'P0001'});
    await c.query("UPDATE inventory_counts SET status='COUNTED',submitted_by=$1,submitted_at=NOW() WHERE id=$2",[req.authUser.user_id,req.params.id]);
    return {id:req.params.id,status:'COUNTED'};
   });return out;
  }catch(e){return fail(rep,e);}
 });
 app.post('/api/v1/inventory/counts/:id/approve',{preHandler:[app.authenticate,app.requirePermission('INVENTORY.COUNT.APPROVE')]},async(req,rep)=>{
  try{
   const out=await tx(db,async c=>{
    const h=await c.query("SELECT * FROM inventory_counts WHERE id=$1 FOR UPDATE",[req.params.id]);
    if(!h.rowCount||h.rows[0].status!=='COUNTED')throw Object.assign(new Error('الجرد غير جاهز للاعتماد'),{code:'P0001'});
    const lines=await c.query('SELECT * FROM inventory_count_lines WHERE count_id=$1 ORDER BY item_id,lot_no FOR UPDATE',[req.params.id]);
    const period=await c.query('SELECT status FROM accounting_periods WHERE $1::date BETWEEN start_date AND end_date FOR UPDATE',[h.rows[0].count_date]);
    if(period.rowCount&&period.rows.some(x=>x.status!=='OPEN'))throw Object.assign(new Error('الفترة المحاسبية مغلقة'),{code:'P0001'});
    const accounts=await c.query("SELECT code,id FROM gl_accounts WHERE code IN ('1200','5400') AND is_active=TRUE");
    const inventoryAccount=accounts.rows.find(x=>x.code==='1200')?.id,varianceAccount=accounts.rows.find(x=>x.code==='5400')?.id;
    let gain=0,loss=0,changed=0;
    for(const l of lines.rows){
     const bal=await c.query('SELECT quantity,average_unit_cost,expiry_date,quality_status FROM inventory_balances WHERE warehouse_id=$1 AND item_id=$2 AND lot_no=$3 FOR UPDATE',[h.rows[0].warehouse_id,l.item_id,l.lot_no]);
     const current=bal.rowCount?Number(bal.rows[0].quantity):0,expected=Number(l.expected_qty),counted=Number(l.counted_qty);
     if(Math.abs(current-expected)>0.000001)throw Object.assign(new Error('تغير رصيد الصنف بعد أخذ لقطة الجرد؛ أعد الجرد لهذا المخزن'),{code:'P0001'});
     const delta=counted-expected;if(Math.abs(delta)<0.000001)continue;
     const cost=bal.rowCount?Number(bal.rows[0].average_unit_cost):Number(l.unit_cost);
     const expiry=bal.rowCount?bal.rows[0].expiry_date:null;
     const quality=bal.rowCount?bal.rows[0].quality_status:'PENDING_QC';
     const newQty=counted,newAvg=delta>0&&newQty>0?((current*cost)+(delta*Number(l.unit_cost)))/newQty:cost;
     await c.query(`INSERT INTO inventory_balances(warehouse_id,item_id,lot_no,expiry_date,quantity,average_unit_cost,quality_status)
      VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(warehouse_id,item_id,lot_no) DO UPDATE
      SET quantity=EXCLUDED.quantity,average_unit_cost=EXCLUDED.average_unit_cost,updated_at=NOW()`,
      [h.rows[0].warehouse_id,l.item_id,l.lot_no,expiry,newQty,newAvg,quality]);
     const movement=delta>0?'ADJUSTMENT_IN':'ADJUSTMENT_OUT';
     await c.query(`INSERT INTO stock_movements(movement_no,warehouse_id,item_id,lot_no,movement_type,quantity_in,quantity_out,unit_cost,reference_type,reference_id,created_by)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,'INVENTORY_COUNT',$9,$10)`,
      [`CNT-${req.params.id.slice(0,12)}-${l.id.slice(0,8)}`,h.rows[0].warehouse_id,l.item_id,l.lot_no,movement,Math.max(delta,0),Math.max(-delta,0),cost,req.params.id,req.authUser.user_id]);
     if(delta>0)gain+=delta*Number(l.unit_cost);else loss+=(-delta)*cost;
     changed++;
    }
    if((gain>0||loss>0)&&(!inventoryAccount||!varianceAccount))throw Object.assign(new Error('حساب المخزون أو فروق الجرد غير معرف'),{code:'P0001'});
    const net=gain-loss;
    if(Math.abs(net)>0.000001){
     const debit=net>0?inventoryAccount:varianceAccount,credit=net>0?varianceAccount:inventoryAccount,amount=Math.abs(net);
     const je=await c.query(`INSERT INTO journal_entries(entry_no,entry_date,source_type,source_id,description,total_debit,total_credit,created_by)
      VALUES($1,$2,'INVENTORY_COUNT',$3,'فروق جرد مخزون',$4,$4,$5) RETURNING id`,
      [`J-CNT-${req.params.id.slice(0,12)}`,h.rows[0].count_date,req.params.id,amount,req.authUser.user_id]);
     await c.query('INSERT INTO journal_lines(journal_entry_id,account_id,debit,credit) VALUES($1,$2,$3,0),($1,$4,0,$3)',[je.rows[0].id,debit,amount,credit]);
    }
    await c.query("UPDATE inventory_counts SET status='POSTED',approved_by=$1,approved_at=NOW() WHERE id=$2",[req.authUser.user_id,req.params.id]);
    return {id:req.params.id,status:'POSTED',changedLines:changed,inventoryGain:gain,inventoryLoss:loss};
   });return out;
  }catch(e){return fail(rep,e);}
 });

}
