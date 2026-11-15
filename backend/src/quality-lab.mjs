const auth=(app,p)=>({preHandler:[app.authenticate,app.requirePermission(p)]});
const invalid=(reply,error='VALIDATION_ERROR')=>reply.code(400).send({error});
const conflict=(reply,error='BUSINESS_RULE')=>reply.code(409).send({error});
const textOk=(v,n=160)=>typeof v==='string'&&v.trim().length>0&&v.trim().length<=n;
const stages=['RAW_MATERIAL','IN_PROCESS','FINISHED_GOOD'];
const sourceTypes=['GOODS_RECEIPT','PRODUCTION_ORDER'];
const finiteOrNull=v=>v==null||v===''?null:(Number.isFinite(Number(v))?Number(v):NaN);
async function tx(db,fn){
 const c=await db.connect();
 try{await c.query('BEGIN');const out=await fn(c);await c.query('COMMIT');return out;}
 catch(e){await c.query('ROLLBACK');throw e;}
 finally{c.release();}
}
const fail=(reply,e)=>{
 if(e.code==='23505')return conflict(reply,'DUPLICATE');
 if(e.code==='23503')return conflict(reply,'INVALID_REFERENCE');
 if(['23514','22P02','22007'].includes(e.code))return invalid(reply,'INVALID_DATA');
 if(e.code==='P0001')return conflict(reply,e.message);
 throw e;
};

export async function qualityLabRoutes(app,{db}){
 app.get('/api/v1/quality/specifications',auth(app,'QUALITY.SAMPLES.READ'),async(req,reply)=>{
  try{return (await db.query(`
   SELECT s.*,i.code item_code,i.name_ar item_name,
    COALESCE(json_agg(json_build_object('id',p.id,'parameterCode',p.parameter_code,'name',p.name_ar,'unit',p.unit,
      'minimum',p.minimum_value,'maximum',p.maximum_value,'target',p.target_value,'required',p.required,'method',p.test_method))
      FILTER(WHERE p.id IS NOT NULL),'[]'::json) parameters
   FROM quality_specifications s JOIN items i ON i.id=s.item_id
   LEFT JOIN quality_specification_parameters p ON p.specification_id=s.id
   GROUP BY s.id,i.code,i.name_ar ORDER BY s.item_id,s.stage,s.version_no DESC
  `)).rows;}catch(e){return fail(reply,e);}
 });

 app.post('/api/v1/quality/specifications',auth(app,'QUALITY.SPECS.MANAGE'),async(req,reply)=>{
  const b=req.body??{};
  if(!b.itemId||!stages.includes(b.stage)||!Number.isInteger(Number(b.versionNo))||Number(b.versionNo)<1||
    !Array.isArray(b.parameters)||!b.parameters.length||
    (b.sampleQuantity!=null&&!Number.isFinite(Number(b.sampleQuantity)))||
    (b.frequencyKg!=null&&!Number.isFinite(Number(b.frequencyKg))||Number(b.frequencyKg)<0))return invalid(reply);
  const codes=new Set();
  for(const p of b.parameters){
   if(!p||!textOk(p.parameterCode,40)||!textOk(p.name,160)||codes.has(p.parameterCode))return invalid(reply,'INVALID_PARAMETER');
   codes.add(p.parameterCode);
   const min=finiteOrNull(p.minimum),max=finiteOrNull(p.maximum),target=finiteOrNull(p.target);
   if(Number.isNaN(min)||Number.isNaN(max)||Number.isNaN(target)||(min!=null&&max!=null&&min>max)||
     (target!=null&&min!=null&&target<min)||(target!=null&&max!=null&&target>max))return invalid(reply,'INVALID_PARAMETER_LIMITS');
  }
  try{
   const result=await tx(db,async c=>{
    const item=await c.query('SELECT id FROM items WHERE id=$1 AND is_active=TRUE',[b.itemId]);
    if(!item.rowCount)return {conflict:'ITEM_NOT_FOUND_OR_INACTIVE'};
    await c.query('UPDATE quality_specifications SET is_active=FALSE WHERE item_id=$1 AND stage=$2 AND is_active=TRUE',[b.itemId,b.stage]);
    const spec=await c.query(`
     INSERT INTO quality_specifications(item_id,stage,version_no,sample_quantity,frequency_kg,is_active,approved_by,approved_at,created_by)
     VALUES($1,$2,$3,$4,$5,TRUE,$6,NOW(),$6) RETURNING *
    `,[b.itemId,b.stage,Number(b.versionNo),b.sampleQuantity??0.5,b.frequencyKg??0,req.authUser.user_id]);
    for(const p of b.parameters){
     await c.query(`
      INSERT INTO quality_specification_parameters(specification_id,parameter_code,name_ar,unit,minimum_value,maximum_value,target_value,required,test_method)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)
     `,[spec.rows[0].id,p.parameterCode,p.name,p.unit??'',finiteOrNull(p.minimum),finiteOrNull(p.maximum),finiteOrNull(p.target),p.required!==false,p.method??null]);
    }
    return {specification:spec.rows[0],parameterCount:b.parameters.length};
   });
   if(result.conflict)return conflict(reply,result.conflict);
   return reply.code(201).send(result);
  }catch(e){return fail(reply,e);}
 });

 app.get('/api/v1/quality/sample-sources',auth(app,'QUALITY.SAMPLES.MANAGE'),async(req,reply)=>{
  try{
   if(req.query.sourceType==='GOODS_RECEIPT'){
    return (await db.query(`
     SELECT g.id source_id,l.id source_line_id,l.item_id,i.code item_code,i.name_ar item_name,
       p.warehouse_id,w.code warehouse_code,COALESCE(l.lot_no,'') lot_no,l.received_qty,
       'RAW_MATERIAL' stage
     FROM goods_receipt_lines l JOIN goods_receipts g ON g.id=l.goods_receipt_id
     JOIN purchase_orders p ON p.id=g.purchase_order_id JOIN warehouses w ON w.id=p.warehouse_id
     JOIN items i ON i.id=l.item_id
     WHERE g.status='PENDING_QC' ORDER BY g.created_at,l.id
    `)).rows;
   }
   if(req.query.sourceType==='PRODUCTION_ORDER'){
    return (await db.query(`
     SELECT p.id source_id,o.id source_line_id,o.item_id,i.code item_code,i.name_ar item_name,
       p.warehouse_id,w.code warehouse_code,o.lot_no,o.quantity,'FINISHED_GOOD' stage
     FROM production_outputs o JOIN production_orders p ON p.id=o.production_order_id
     JOIN inventory_balances b ON b.warehouse_id=p.warehouse_id AND b.item_id=o.item_id AND b.lot_no=o.lot_no
     JOIN warehouses w ON w.id=p.warehouse_id JOIN items i ON i.id=o.item_id
     WHERE p.status='COMPLETED' AND b.quality_status IN ('PENDING_QC','QUARANTINED')
     ORDER BY p.created_at DESC,o.id
    `)).rows;
   }
   return invalid(reply,'INVALID_SOURCE_TYPE');
  }catch(e){return fail(reply,e);}
 });

 app.get('/api/v1/quality/samples',auth(app,'QUALITY.SAMPLES.READ'),async(_req,reply)=>{
  try{return (await db.query(`
   SELECT s.*,i.code item_code,i.name_ar item_name,q.version_no specification_version,
     u.display_name collector_name,tu.display_name tester_name,
     COALESCE((SELECT COUNT(*)::int FROM quality_sample_results r WHERE r.sample_id=s.id),0) result_count
   FROM quality_samples s JOIN items i ON i.id=s.item_id
   JOIN quality_specifications q ON q.id=s.specification_id
   JOIN users u ON u.id=s.collected_by LEFT JOIN users tu ON tu.id=s.tested_by
   ORDER BY s.collected_at DESC
  `)).rows;}catch(e){return fail(reply,e);}
 });

 app.post('/api/v1/quality/samples',auth(app,'QUALITY.SAMPLES.MANAGE'),async(req,reply)=>{
  const b=req.body??{};
  if(!textOk(b.sampleNo,50)||!sourceTypes.includes(b.sourceType)||!b.sourceId||!b.sourceLineId||!b.itemId||!b.warehouseId||
    !stages.includes(b.stage)||(b.sampleQuantity!=null&&!Number.isFinite(Number(b.sampleQuantity))))return invalid(reply);
  try{
   const result=await tx(db,async c=>{
    const spec=await c.query('SELECT * FROM quality_specifications WHERE item_id=$1 AND stage=$2 AND is_active=TRUE FOR SHARE',[b.itemId,b.stage]);
    if(!spec.rowCount)return {conflict:'ACTIVE_QUALITY_SPECIFICATION_REQUIRED'};
    let source;
    if(b.sourceType==='GOODS_RECEIPT'){
     if(b.stage!=='RAW_MATERIAL')return {conflict:'GOODS_RECEIPT_SAMPLES_MUST_BE_RAW_MATERIAL'};
     source=await c.query(`
      SELECT l.item_id,l.lot_no,p.warehouse_id,g.status receipt_status
      FROM goods_receipt_lines l JOIN goods_receipts g ON g.id=l.goods_receipt_id
      JOIN purchase_orders p ON p.id=g.purchase_order_id
      WHERE g.id=$1 AND l.id=$2 FOR UPDATE OF l,g
     `,[b.sourceId,b.sourceLineId]);
     if(!source.rowCount||source.rows[0].receipt_status!=='PENDING_QC')return {conflict:'GOODS_RECEIPT_LINE_NOT_PENDING_QC'};
    }else{
     source=await c.query(`
      SELECT o.item_id,o.lot_no,p.warehouse_id,p.status production_status
      FROM production_outputs o JOIN production_orders p ON p.id=o.production_order_id
      WHERE p.id=$1 AND o.id=$2 FOR UPDATE OF p,o
     `,[b.sourceId,b.sourceLineId]);
     if(!source.rowCount||source.rows[0].production_status!=='COMPLETED')return {conflict:'PRODUCTION_OUTPUT_NOT_COMPLETED'};
    }
    if(source.rows[0].item_id!==b.itemId||source.rows[0].warehouse_id!==b.warehouseId||String(source.rows[0].lot_no??'')!==String(b.lotNo??''))return {conflict:'SAMPLE_SOURCE_MISMATCH'};
    const sample=await c.query(`
     INSERT INTO quality_samples(sample_no,specification_id,source_type,source_id,source_line_id,item_id,warehouse_id,lot_no,stage,sample_quantity,collected_by,notes)
     VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *
    `,[b.sampleNo,spec.rows[0].id,b.sourceType,b.sourceId,b.sourceLineId,b.itemId,b.warehouseId,b.lotNo??'',b.stage,b.sampleQuantity??spec.rows[0].sample_quantity,req.authUser.user_id,b.notes??null]);
    return {sample:sample.rows[0],specificationVersion:spec.rows[0].version_no};
   });
   if(result.conflict)return conflict(reply,result.conflict);
   return reply.code(201).send(result);
  }catch(e){return fail(reply,e);}
 });

 app.get('/api/v1/quality/samples/:id',auth(app,'QUALITY.SAMPLES.READ'),async(req,reply)=>{
  try{
   const sample=await db.query(`
    SELECT s.*,i.code item_code,i.name_ar item_name,q.version_no
    FROM quality_samples s JOIN items i ON i.id=s.item_id
    JOIN quality_specifications q ON q.id=s.specification_id WHERE s.id=$1
   `,[req.params.id]);
   if(!sample.rowCount)return reply.code(404).send({error:'NOT_FOUND'});
   const results=await db.query(`
    SELECT p.parameter_code,p.name_ar,p.unit,p.minimum_value,p.maximum_value,p.target_value,p.required,p.test_method,
      r.numeric_value,r.text_value,r.result,r.notes,r.tested_at
    FROM quality_specification_parameters p
    LEFT JOIN quality_sample_results r ON r.parameter_id=p.id AND r.sample_id=$1
    WHERE p.specification_id=$2 ORDER BY p.parameter_code
   `,[req.params.id,sample.rows[0].specification_id]);
   return {...sample.rows[0],results:results.rows};
  }catch(e){return fail(reply,e);}
 });

 app.post('/api/v1/quality/samples/:id/results',auth(app,'QUALITY.SAMPLES.TEST'),async(req,reply)=>{
  const b=req.body??{};
  if(!Array.isArray(b.results)||!b.results.length||b.results.some(x=>!x||!textOk(x.parameterCode,40)||
    (x.numericValue==null&&x.textValue==null)||(x.numericValue!=null&&!Number.isFinite(Number(x.numericValue)))))return invalid(reply);
  try{
   const result=await tx(db,async c=>{
    const sample=await c.query('SELECT * FROM quality_samples WHERE id=$1 FOR UPDATE',[req.params.id]);
    if(!sample.rowCount||!['COLLECTED','IN_TEST'].includes(sample.rows[0].status))return {conflict:'SAMPLE_NOT_OPEN_FOR_TESTING'};
    const parameters=await c.query('SELECT * FROM quality_specification_parameters WHERE specification_id=$1',[sample.rows[0].specification_id]);
    const byCode=new Map(parameters.rows.map(p=>[p.parameter_code,p]));
    const seen=new Set();
    for(const r of b.results){
     if(seen.has(r.parameterCode))return {conflict:'DUPLICATE_PARAMETER_RESULT'};
     seen.add(r.parameterCode);
     const p=byCode.get(r.parameterCode);
     if(!p)return {conflict:'PARAMETER_NOT_IN_SPECIFICATION'};
     const value=finiteOrNull(r.numericValue);
     if(Number.isNaN(value))return {conflict:'INVALID_NUMERIC_RESULT'};
     if((p.minimum_value!=null||p.maximum_value!=null)&&value==null)return {conflict:'NUMERIC_RESULT_REQUIRED'};
     if(r.textValue!=null&&typeof r.textValue!=='string')return {conflict:'INVALID_TEXT_RESULT'};
     let status='PASS';
     if(value!=null&&((p.minimum_value!=null&&value<Number(p.minimum_value))||(p.maximum_value!=null&&value>Number(p.maximum_value))))status='FAIL';
     await c.query(`
      INSERT INTO quality_sample_results(sample_id,parameter_id,numeric_value,text_value,unit,result,tested_by,notes)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8)
      ON CONFLICT(sample_id,parameter_id) DO UPDATE SET numeric_value=EXCLUDED.numeric_value,text_value=EXCLUDED.text_value,
       unit=EXCLUDED.unit,result=EXCLUDED.result,tested_by=EXCLUDED.tested_by,tested_at=NOW(),notes=EXCLUDED.notes
     `,[req.params.id,p.id,value,r.textValue??null,r.unit??p.unit,status,req.authUser.user_id,r.notes??null]);
    }
    await c.query("UPDATE quality_samples SET status='IN_TEST' WHERE id=$1",[req.params.id]);
    return {sampleId:req.params.id,recordedResults:b.results.length};
   });
   if(result.conflict)return conflict(reply,result.conflict);
   return result;
  }catch(e){return fail(reply,e);}
 });

 app.post('/api/v1/quality/samples/:id/finalize',auth(app,'QUALITY.SAMPLES.TEST'),async(req,reply)=>{
  try{
   const result=await tx(db,async c=>{
    const sample=await c.query('SELECT * FROM quality_samples WHERE id=$1 FOR UPDATE',[req.params.id]);
    if(!sample.rowCount||!['COLLECTED','IN_TEST'].includes(sample.rows[0].status))return {conflict:'SAMPLE_NOT_FINALIZABLE'};
    const params=await c.query(`
     SELECT p.id,p.required,r.result FROM quality_specification_parameters p
     LEFT JOIN quality_sample_results r ON r.parameter_id=p.id AND r.sample_id=$1
     WHERE p.specification_id=$2
    `,[req.params.id,sample.rows[0].specification_id]);
    if(params.rows.some(p=>p.required&&!p.result))return {conflict:'REQUIRED_TESTS_MISSING'};
    const status=params.rows.some(p=>p.result==='FAIL')?'FAILED':'PASSED';
    const updated=await c.query('UPDATE quality_samples SET status=$1,tested_by=$2,tested_at=NOW() WHERE id=$3 RETURNING *',[status,req.authUser.user_id,req.params.id]);
    let certificate=null;
    if(status==='PASSED'&&sample.rows[0].stage==='FINISHED_GOOD'){
     const results=await c.query(`
      SELECT p.parameter_code,p.name_ar,p.unit,p.minimum_value,p.maximum_value,p.target_value,r.numeric_value,r.text_value,r.result
      FROM quality_sample_results r JOIN quality_specification_parameters p ON p.id=r.parameter_id
      WHERE r.sample_id=$1 ORDER BY p.parameter_code
     `,[req.params.id]);
     const certNo=('COA-'+sample.rows[0].sample_no).slice(0,50);
     certificate=await c.query(`
      INSERT INTO quality_certificates(certificate_no,sample_id,item_id,lot_no,issued_by,certificate_data)
      VALUES($1,$2,$3,$4,$5,$6::jsonb) RETURNING *
     `,[certNo,req.params.id,sample.rows[0].item_id,sample.rows[0].lot_no,req.authUser.user_id,JSON.stringify({sampleNo:sample.rows[0].sample_no,stage:sample.rows[0].stage,results:results.rows})]);
    }
    return {sample:updated.rows[0],certificate:certificate?.rows[0]??null};
   });
   if(result.conflict)return conflict(reply,result.conflict);
   return result;
  }catch(e){return fail(reply,e);}
 });

 app.get('/api/v1/quality/certificates',auth(app,'QUALITY.COA.READ'),async(req,reply)=>{
  try{
   return (await db.query(`
    SELECT c.*,i.code item_code,i.name_ar item_name
    FROM quality_certificates c JOIN items i ON i.id=c.item_id
    WHERE ($1::uuid IS NULL OR c.item_id=$1) AND ($2::text IS NULL OR c.lot_no=$2)
    ORDER BY c.issued_at DESC
   `,[req.query.itemId??null,req.query.lotNo??null])).rows;
  }catch(e){return fail(reply,e);}
 });
}
