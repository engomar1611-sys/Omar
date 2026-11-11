const auth=(app,p)=>({preHandler:[app.authenticate,app.requirePermission(p)]});
const fail=(reply,e)=>{if(e.code==='23505')return reply.code(409).send({error:'DUPLICATE'});if(e.code==='23503')return reply.code(409).send({error:'REFERENCED'});if(['23514','22P02'].includes(e.code))return reply.code(400).send({error:'INVALID_DATA'});if(e.code==='P0001')return reply.code(409).send({error:'BUSINESS_RULE',message:e.message});throw e;};
async function tx(db,fn){const c=await db.connect();try{await c.query('BEGIN');const v=await fn(c);await c.query('COMMIT');return v;}catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();}}
const valid=(v,n)=>typeof v==='string'&&v.trim().length>0&&v.trim().length<=n;
export async function formulationRoutes(app,{db}){
 app.get('/api/v1/formulations', {preHandler:[app.authenticate,app.requirePermission('FORMULATIONS.READ')]},async(req,rep)=>{
  try{return (await db.query(`SELECT f.*,p.code product_code,p.name_ar product_name,
    COALESCE(json_agg(json_build_object('itemId',l.item_id,'itemCode',i.code,'itemName',i.name_ar,'percentage',l.percentage,'sequenceNo',l.sequence_no))
    FILTER(WHERE l.id IS NOT NULL),'[]'::json) lines
    FROM formulations f JOIN feed_products p ON p.id=f.feed_product_id
    LEFT JOIN formulation_lines l ON l.formulation_id=f.id LEFT JOIN items i ON i.id=l.item_id
    WHERE ($1::uuid IS NULL OR f.feed_product_id=$1) GROUP BY f.id,p.code,p.name_ar ORDER BY p.code,f.version_no DESC`,[req.query?.feedProductId??null])).rows;}
  catch(e){return fail(rep,e);}
 });
 app.post('/api/v1/formulations',{preHandler:[app.authenticate,app.requirePermission('FORMULATIONS.MANAGE')]},async(req,rep)=>{
  const b=req.body??{};if(!b.feedProductId||!Number.isInteger(b.versionNo)||b.versionNo<1||!Array.isArray(b.lines)||!b.lines.length||
   b.lines.some(x=>!x.itemId||!Number.isFinite(Number(x.percentage))||Number(x.percentage)<=0||Number(x.percentage)>100))return rep.code(400).send({error:'VALIDATION_ERROR'});
  try{const result=await tx(db,async c=>{
   const h=await c.query(`INSERT INTO formulations(feed_product_id,version_no,status,effective_from,effective_to,notes)
    VALUES($1,$2,'DRAFT',$3,$4,$5) RETURNING *`,[b.feedProductId,b.versionNo,b.effectiveFrom??null,b.effectiveTo??null,b.notes??null]);
   for(let i=0;i<b.lines.length;i++)await c.query('INSERT INTO formulation_lines(formulation_id,item_id,percentage,sequence_no) VALUES($1,$2,$3,$4)',[h.rows[0].id,b.lines[i].itemId,b.lines[i].percentage,i+1]);
   return h.rows[0];
  });return rep.code(201).send(result);}catch(e){return fail(rep,e);}
 });
 app.put('/api/v1/formulations/:id/lines',{preHandler:[app.authenticate,app.requirePermission('FORMULATIONS.MANAGE')]},async(req,rep)=>{
  const lines=req.body?.lines;if(!Array.isArray(lines)||!lines.length||lines.some(x=>!x.itemId||!Number.isFinite(Number(x.percentage))||Number(x.percentage)<=0||Number(x.percentage)>100))return rep.code(400).send({error:'VALIDATION_ERROR'});
  try{await tx(db,async c=>{
   const h=await c.query('SELECT status FROM formulations WHERE id=$1 FOR UPDATE',[req.params.id]);
   if(!h.rowCount||h.rows[0].status!=='DRAFT')throw Object.assign(new Error('لا يمكن تعديل إلا تركيبة مسودة'),{code:'P0001'});
   await c.query('DELETE FROM formulation_lines WHERE formulation_id=$1',[req.params.id]);
   for(let i=0;i<lines.length;i++)await c.query('INSERT INTO formulation_lines(formulation_id,item_id,percentage,sequence_no) VALUES($1,$2,$3,$4)',[req.params.id,lines[i].itemId,lines[i].percentage,i+1]);
  });return {id:req.params.id,updated:true};}catch(e){return fail(rep,e);}
 });
 app.post('/api/v1/formulations/:id/submit',{preHandler:[app.authenticate,app.requirePermission('FORMULATIONS.MANAGE')]},async(req,rep)=>{
  try{const r=await db.query(`UPDATE formulations SET status='IN_REVIEW' WHERE id=$1 AND status='DRAFT' RETURNING *`,[req.params.id]);if(!r.rowCount)return rep.code(409).send({error:'INVALID_STATUS'});return r.rows[0];}catch(e){return fail(rep,e);}
 });
 app.post('/api/v1/formulations/:id/approve',{preHandler:[app.authenticate,app.requirePermission('FORMULATIONS.APPROVE')]},async(req,rep)=>{
  try{const r=await tx(db,async c=>{
   const h=await c.query('SELECT id,status FROM formulations WHERE id=$1 FOR UPDATE',[req.params.id]);
   if(!h.rowCount||h.rows[0].status!=='IN_REVIEW')throw Object.assign(new Error('يجب إرسال التركيبة للمراجعة أولاً'),{code:'P0001'});
   const sum=await c.query('SELECT COUNT(*)::int line_count,COALESCE(SUM(percentage),0) total FROM formulation_lines WHERE formulation_id=$1',[req.params.id]);
   if(!sum.rows[0].line_count||Math.abs(Number(sum.rows[0].total)-100)>0.000001)throw Object.assign(new Error('مجموع نسب التركيبة يجب أن يساوي 100% بالضبط'),{code:'P0001'});
   const approved=await c.query(`UPDATE formulations SET status='APPROVED',approved_by=$1,approved_at=NOW() WHERE id=$2 RETURNING *`,[req.authUser.user_id,req.params.id]);
   return approved.rows[0];
  });return r;}catch(e){return fail(rep,e);}
 });
}
