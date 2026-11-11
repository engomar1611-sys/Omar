const auth=(app,p)=>({preHandler:[app.authenticate,app.requirePermission(p)]});
const bad=(r)=>r.code(400).send({error:'VALIDATION_ERROR'});
const fail=(r,e)=>{if(e.code==='23505')return r.code(409).send({error:'DUPLICATE'});if(e.code==='23503')return r.code(409).send({error:'REFERENCED'});if(['23514','22P02'].includes(e.code))return r.code(400).send({error:'INVALID_DATA'});if(e.code==='P0001')return r.code(409).send({error:'BUSINESS_RULE',message:e.message});throw e;};
async function tx(db,fn){const c=await db.connect();try{await c.query('BEGIN');const v=await fn(c);await c.query('COMMIT');return v;}catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();}}
const textOk=(v,n)=>typeof v==='string'&&v.trim().length>0&&v.trim().length<=n;
const positive=v=>Number.isFinite(Number(v))&&Number(v)>0;
export async function procurementRoutes(app,{db}){
 app.get('/api/v1/purchase-requests',auth(app,'PURCHASE_REQUESTS.READ'),async(_q,r)=>{
  try{return (await db.query(`SELECT p.*,w.code warehouse_code,u.username requester,
   COALESCE(json_agg(json_build_object('lineId',l.id,'itemId',l.item_id,'itemCode',i.code,'itemName',i.name_ar,'quantity',l.requested_qty,'notes',l.notes))
   FILTER(WHERE l.id IS NOT NULL),'[]'::json) lines
   FROM purchase_requests p JOIN warehouses w ON w.id=p.warehouse_id JOIN users u ON u.id=p.requested_by
   LEFT JOIN purchase_request_lines l ON l.purchase_request_id=p.id LEFT JOIN items i ON i.id=l.item_id
   GROUP BY p.id,w.code,u.username ORDER BY p.request_date DESC,p.request_no DESC`)).rows;}catch(e){return fail(r,e);}
 });
 app.post('/api/v1/purchase-requests',auth(app,'PURCHASE_REQUESTS.MANAGE'),async(req,r)=>{
  const b=req.body??{};if(!textOk(b.requestNo,40)||!b.warehouseId||!Array.isArray(b.lines)||!b.lines.length||b.lines.some(x=>!x.itemId||!positive(x.quantity)))return bad(r);
  try{const out=await tx(db,async c=>{
   const h=await c.query(`INSERT INTO purchase_requests(request_no,requested_by,needed_by,warehouse_id,reason)
    VALUES($1,$2,$3,$4,$5) RETURNING *`,[b.requestNo.trim(),req.authUser.user_id,b.neededBy??null,b.warehouseId,b.reason??null]);
   for(let i=0;i<b.lines.length;i++)await c.query('INSERT INTO purchase_request_lines(purchase_request_id,line_no,item_id,requested_qty,notes) VALUES($1,$2,$3,$4,$5)',[h.rows[0].id,i+1,b.lines[i].itemId,b.lines[i].quantity,b.lines[i].notes??null]);
   return h.rows[0];
  });return r.code(201).send(out);}catch(e){return fail(r,e);}
 });
 app.post('/api/v1/purchase-requests/:id/submit',auth(app,'PURCHASE_REQUESTS.MANAGE'),async(req,r)=>{
  try{const x=await db.query(`UPDATE purchase_requests SET status='PENDING_APPROVAL' WHERE id=$1 AND status='DRAFT' RETURNING *`,[req.params.id]);if(!x.rowCount)return r.code(409).send({error:'INVALID_STATUS'});return x.rows[0];}catch(e){return fail(r,e);}
 });
 app.post('/api/v1/purchase-requests/:id/approve',auth(app,'PURCHASE_REQUESTS.APPROVE'),async(req,r)=>{
  try{const x=await db.query(`UPDATE purchase_requests SET status='APPROVED',approved_by=$1,approved_at=NOW()
   WHERE id=$2 AND status='PENDING_APPROVAL' RETURNING *`,[req.authUser.user_id,req.params.id]);if(!x.rowCount)return r.code(409).send({error:'INVALID_STATUS'});return x.rows[0];}catch(e){return fail(r,e);}
 });
 app.post('/api/v1/purchase-requests/:id/convert',auth(app,'PURCHASE_REQUESTS.CONVERT'),async(req,r)=>{
  const b=req.body??{};if(!textOk(b.orderNo,40)||!b.supplierId||!Array.isArray(b.lines))return bad(r);
  try{const out=await tx(db,async c=>{
   const h=await c.query("SELECT * FROM purchase_requests WHERE id=$1 FOR UPDATE",[req.params.id]);
   if(!h.rowCount||h.rows[0].status!=='APPROVED'||h.rows[0].purchase_order_id)throw Object.assign(new Error('يجب اعتماد الطلب ولم يسبق تحويله'),{code:'P0001'});
   const requested=await c.query('SELECT * FROM purchase_request_lines WHERE purchase_request_id=$1 ORDER BY line_no',[req.params.id]);
   if(b.lines.length!==requested.rowCount)throw Object.assign(new Error('يجب تحديد تكلفة كل بند من الطلب مرة واحدة'),{code:'P0001'});
   const costs=new Map(b.lines.map(x=>[x.requestLineId,x.unitCost]));
   for(const l of requested.rows)if(!costs.has(l.id)||!Number.isFinite(Number(costs.get(l.id)))||Number(costs.get(l.id))<0)throw Object.assign(new Error('تكلفة بند غير صحيحة أو مفقودة'),{code:'P0001'});
   const s=await c.query('SELECT id FROM suppliers WHERE id=$1 AND is_active=TRUE',[b.supplierId]);if(!s.rowCount)throw Object.assign(new Error('المورد غير موجود أو غير نشط'),{code:'P0001'});
   const po=await c.query(`INSERT INTO purchase_orders(order_no,supplier_id,warehouse_id,expected_date,notes,created_by)
    VALUES($1,$2,$3,$4,$5,$6) RETURNING *`,[b.orderNo.trim(),b.supplierId,h.rows[0].warehouse_id,h.rows[0].needed_by,b.notes??h.rows[0].reason,req.authUser.user_id]);
   for(let i=0;i<requested.rows.length;i++){const l=requested.rows[i];await c.query('INSERT INTO purchase_order_lines(purchase_order_id,line_no,item_id,ordered_qty,unit_cost) VALUES($1,$2,$3,$4,$5)',[po.rows[0].id,i+1,l.item_id,l.requested_qty,costs.get(l.id)]);}
   await c.query("UPDATE purchase_requests SET status='ORDERED',purchase_order_id=$1 WHERE id=$2",[po.rows[0].id,req.params.id]);
   return {requestId:req.params.id,purchaseOrder:po.rows[0],lineCount:requested.rowCount};
  });return r.code(201).send(out);}catch(e){return fail(r,e);}
 });
}
