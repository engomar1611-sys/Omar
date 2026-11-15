import {Router} from "express";
import {pool} from "../db.js";

const router=Router();
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const validRef=v=>typeof v==="string"&&v.trim().length>2&&v.trim().length<=60;
const qty=v=>Number.isFinite(Number(v))&&Number(v)>=0;
const fail=(res,message,status=400)=>res.status(status).json({error:message});

router.get("/inventory/stocktakes",async(_req,res,next)=>{
 try{
  const r=await pool.query(`SELECT st.*,w.name warehouse_name,u.display_name created_by_name,
    COUNT(sl.id)::int line_count,COUNT(sl.counted_quantity)::int counted_lines,
    SUM(COALESCE(sl.expected_quantity,0)) expected_total,
    SUM(COALESCE(sl.counted_quantity,0)) counted_total
   FROM stocktakes st JOIN warehouses w ON w.id=st.warehouse_id
   LEFT JOIN users u ON u.id=st.created_by LEFT JOIN stocktake_lines sl ON sl.stocktake_id=st.id
   GROUP BY st.id,w.name,u.display_name ORDER BY st.created_at DESC LIMIT 200`);
  res.json({items:r.rows});
 }catch(e){next(e);}
});

router.post("/inventory/stocktakes",async(req,res,next)=>{
 const {reference_no,warehouse_id,notes=null}=req.body??{};
 if(!validRef(reference_no)||!uuid.test(warehouse_id||""))return fail(res,"أدخل رقم الجرد والمخزن");
 const client=await pool.connect();
 try{
  await client.query("BEGIN");
  const wh=await client.query("SELECT id FROM warehouses WHERE id=$1 AND is_active=true FOR SHARE",[warehouse_id]);
  if(!wh.rowCount)throw Object.assign(new Error("المخزن غير موجود أو غير نشط"),{statusCode:404});
  const h=await client.query("INSERT INTO stocktakes(reference_no,warehouse_id,notes,created_by) VALUES($1,$2,$3,$4) RETURNING *",[reference_no.trim(),warehouse_id,notes,req.user.id]);
  const stock=await client.query(`SELECT p.id product_id,sl.id stock_lot_id,COALESCE(sl.quantity_on_hand,0) expected_quantity,
    sl.lot_number,sl.expiry_date
    FROM products p LEFT JOIN stock_lots sl ON sl.product_id=p.id AND sl.warehouse_id=$1 AND sl.quantity_on_hand>0
    WHERE p.is_active=true ORDER BY p.name_ar,sl.expiry_date NULLS LAST,sl.received_at`,[warehouse_id]);
  for(const line of stock.rows){
   await client.query(`INSERT INTO stocktake_lines(stocktake_id,product_id,stock_lot_id,expected_quantity,lot_number,expiry_date)
    VALUES($1,$2,$3,$4,$5,$6)`,[h.rows[0].id,line.product_id,line.stock_lot_id,line.expected_quantity,line.lot_number,line.expiry_date]);
  }
  await client.query("COMMIT");
  res.status(201).json({stocktake:h.rows[0],line_count:stock.rowCount});
 }catch(e){await client.query("ROLLBACK");if(e.statusCode)return res.status(e.statusCode).json({error:e.message});next(e);}finally{client.release();}
});

router.get("/inventory/stocktakes/:id",async(req,res,next)=>{
 if(!uuid.test(req.params.id))return fail(res,"رقم الجرد غير صحيح");
 try{
  const h=await pool.query(`SELECT st.*,w.name warehouse_name FROM stocktakes st JOIN warehouses w ON w.id=st.warehouse_id WHERE st.id=$1`,[req.params.id]);
  if(!h.rowCount)return fail(res,"الجرد غير موجود",404);
  const lines=await pool.query(`SELECT sl.*,p.sku,p.name_ar,p.tracks_expiry,u.code unit_code
   FROM stocktake_lines sl JOIN products p ON p.id=sl.product_id JOIN units u ON u.id=p.base_unit_id
   WHERE sl.stocktake_id=$1 ORDER BY p.name_ar,sl.lot_number NULLS FIRST,sl.expiry_date NULLS LAST`,[req.params.id]);
  res.json({stocktake:h.rows[0],items:lines.rows});
 }catch(e){next(e);}
});

router.patch("/inventory/stocktakes/:id/lines/:lineId",async(req,res,next)=>{
 const {counted_quantity,lot_number=null,expiry_date=null}=req.body??{};
 if(!uuid.test(req.params.id)||!uuid.test(req.params.lineId)||!qty(counted_quantity))return fail(res,"الكمية المدخلة غير صحيحة");
 if(expiry_date!==null&&!/^\d{4}-\d{2}-\d{2}$/.test(expiry_date))return fail(res,"تاريخ الصلاحية غير صحيح");
 const client=await pool.connect();
 try{
  await client.query("BEGIN");
  const h=await client.query("SELECT status FROM stocktakes WHERE id=$1 FOR UPDATE",[req.params.id]);
  if(!h.rowCount||h.rows[0].status!=="counting")throw Object.assign(new Error("الجرد غير موجود أو تم إقفاله"),{statusCode:409});
  const r=await client.query(`UPDATE stocktake_lines SET counted_quantity=$3,
    lot_number=CASE WHEN stock_lot_id IS NULL THEN $4 ELSE lot_number END,
    expiry_date=CASE WHEN stock_lot_id IS NULL THEN $5 ELSE expiry_date END
    WHERE id=$1 AND stocktake_id=$2 RETURNING *`,[req.params.lineId,req.params.id,counted_quantity,lot_number,expiry_date]);
  if(!r.rowCount)throw Object.assign(new Error("بند الجرد غير موجود"),{statusCode:404});
  await client.query("COMMIT");res.json({line:r.rows[0]});
 }catch(e){await client.query("ROLLBACK");if(e.statusCode)return res.status(e.statusCode).json({error:e.message});next(e);}finally{client.release();}
});

router.post("/inventory/stocktakes/:id/post",async(req,res,next)=>{
 if(!uuid.test(req.params.id))return fail(res,"رقم الجرد غير صحيح");
 const client=await pool.connect();
 try{
  await client.query("BEGIN");
  const h=await client.query("SELECT * FROM stocktakes WHERE id=$1 FOR UPDATE",[req.params.id]);
  if(!h.rowCount||h.rows[0].status!=="counting")throw Object.assign(new Error("الجرد غير موجود أو تم ترحيله مسبقًا"),{statusCode:409});
  const header=h.rows[0];
  const missing=await client.query("SELECT COUNT(*)::int n FROM stocktake_lines WHERE stocktake_id=$1 AND counted_quantity IS NULL",[header.id]);
  if(missing.rows[0].n)throw Object.assign(new Error("يجب إدخال الكميات الفعلية لكل بنود الجرد قبل الترحيل"),{statusCode:400});
  const moved=await client.query("SELECT 1 FROM stock_movements WHERE warehouse_id=$1 AND created_at>$2 LIMIT 1",[header.warehouse_id,header.created_at]);
  if(moved.rowCount)throw Object.assign(new Error("تم تسجيل حركات مخزون أثناء الجرد. ألغِ هذه الجردية وابدأ جردًا جديدًا بعد إيقاف حركة المخزن"),{statusCode:409});
  const period=await client.query("SELECT 1 FROM accounting_periods WHERE status='closed' AND CURRENT_DATE BETWEEN starts_on AND ends_on LIMIT 1");
  if(period.rowCount)throw Object.assign(new Error("الفترة المحاسبية الحالية مغلقة"),{statusCode:409});
  const lines=await client.query(`SELECT sl.*,p.tracks_expiry,p.sku,p.name_ar
   FROM stocktake_lines sl JOIN products p ON p.id=sl.product_id
   WHERE sl.stocktake_id=$1 ORDER BY p.sku,sl.lot_number FOR UPDATE OF sl`,[header.id]);
  let positiveValue=0,negativeValue=0,changed=0;
  for(const line of lines.rows){
   const expected=Number(line.expected_quantity),counted=Number(line.counted_quantity),variance=Number((counted-expected).toFixed(6));
   if(Math.abs(variance)<0.000001){await client.query("UPDATE stocktake_lines SET posted_variance=0 WHERE id=$1",[line.id]);continue;}
   let lotCost=0;
   if(line.stock_lot_id){
    const lot=await client.query("SELECT * FROM stock_lots WHERE id=$1 AND warehouse_id=$2 FOR UPDATE",[line.stock_lot_id,header.warehouse_id]);
    if(!lot.rowCount)throw Object.assign(new Error("تشغيلة الصنف لم تعد موجودة: "+line.sku),{statusCode:409});
    lotCost=Number(lot.rows[0].unit_cost);
    await client.query("UPDATE stock_lots SET quantity_on_hand=$2 WHERE id=$1",[line.stock_lot_id,counted]);
    if(variance>0)await client.query(`INSERT INTO stock_movements(reference_no,movement_type,product_id,warehouse_id,lot_id,quantity_in,unit_cost,source_type,source_id,created_by)
      VALUES($1,'adjustment',$2,$3,$4,$5,$6,'stocktake',$7,$8)`,[header.reference_no,line.product_id,header.warehouse_id,line.stock_lot_id,variance,lotCost,header.id,req.user.id]);
    else await client.query(`INSERT INTO stock_movements(reference_no,movement_type,product_id,warehouse_id,lot_id,quantity_out,unit_cost,source_type,source_id,created_by)
      VALUES($1,'adjustment',$2,$3,$4,$5,$6,'stocktake',$7,$8)`,[header.reference_no,line.product_id,header.warehouse_id,line.stock_lot_id,Math.abs(variance),lotCost,header.id,req.user.id]);
   }else if(counted>0){
    if(line.tracks_expiry&&!line.expiry_date)throw Object.assign(new Error("أدخل تاريخ صلاحية للصنف "+line.name_ar),{statusCode:400});
    const avg=await client.query("SELECT COALESCE(SUM(quantity_on_hand*unit_cost)/NULLIF(SUM(quantity_on_hand),0),0) cost FROM stock_lots WHERE product_id=$1 AND warehouse_id=$2",[line.product_id,header.warehouse_id]);
    lotCost=Number(avg.rows[0].cost);
    const lot=await client.query(`INSERT INTO stock_lots(product_id,warehouse_id,lot_number,expiry_date,quantity_on_hand,unit_cost,is_saleable)
      VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING id`,[line.product_id,header.warehouse_id,line.lot_number||("STK-"+header.reference_no+"-"+line.sku),line.expiry_date,counted,lotCost,!line.expiry_date||line.expiry_date>=new Date().toISOString().slice(0,10)]);
    await client.query(`INSERT INTO stock_movements(reference_no,movement_type,product_id,warehouse_id,lot_id,quantity_in,unit_cost,source_type,source_id,created_by)
      VALUES($1,'adjustment',$2,$3,$4,$5,$6,'stocktake',$7,$8)`,[header.reference_no,line.product_id,header.warehouse_id,lot.rows[0].id,counted,lotCost,header.id,req.user.id]);
   }
   if(variance>0)positiveValue+=variance*lotCost;else negativeValue+=Math.abs(variance)*lotCost;
   await client.query("UPDATE stocktake_lines SET posted_variance=$2 WHERE id=$1",[line.id,variance]);changed++;
  }
  let journalId=null;
  if(positiveValue>0.000001||negativeValue>0.000001){
   const map=await client.query("SELECT mapping_key,account_id FROM system_account_mappings WHERE mapping_key=ANY($1::varchar[])",[["inventory","inventory_gain","inventory_loss"]]);
   const accounts=Object.fromEntries(map.rows.map(x=>[x.mapping_key,x.account_id]));
   if(!accounts.inventory||(positiveValue>0.000001&&!accounts.inventory_gain)||(negativeValue>0.000001&&!accounts.inventory_loss))
    throw Object.assign(new Error("حسابات تسوية المخزون غير مهيأة. طبّق ترحيل الحسابات أولًا"),{statusCode:409});
   const j=await client.query("INSERT INTO journal_entries(reference_no,source_type,source_id,entry_date,status) VALUES($1,'stocktake',$2,CURRENT_DATE,'posted') RETURNING id",["JE-"+header.reference_no,header.id]);
   journalId=j.rows[0].id;
   if(positiveValue>0.000001){
    await client.query("INSERT INTO journal_lines(journal_entry_id,account_id,debit,credit) VALUES($1,$2,$3,0)",[journalId,accounts.inventory,positiveValue]);
    await client.query("INSERT INTO journal_lines(journal_entry_id,account_id,debit,credit) VALUES($1,$2,0,$3)",[journalId,accounts.inventory_gain,positiveValue]);
   }
   if(negativeValue>0.000001){
    await client.query("INSERT INTO journal_lines(journal_entry_id,account_id,debit,credit) VALUES($1,$2,$3,0)",[journalId,accounts.inventory_loss,negativeValue]);
    await client.query("INSERT INTO journal_lines(journal_entry_id,account_id,debit,credit) VALUES($1,$2,0,$3)",[journalId,accounts.inventory,negativeValue]);
   }
  }
  const done=await client.query("UPDATE stocktakes SET status='posted',posted_by=$2,posted_at=now() WHERE id=$1 RETURNING *",[header.id,req.user.id]);
  await client.query("COMMIT");
  res.json({stocktake:done.rows[0],adjusted_lines:changed,positive_adjustment_value:Number(positiveValue.toFixed(2)),negative_adjustment_value:Number(negativeValue.toFixed(2)),journal_entry_id:journalId});
 }catch(e){await client.query("ROLLBACK");if(e.statusCode)return res.status(e.statusCode).json({error:e.message});next(e);}finally{client.release();}
});

router.post("/inventory/stocktakes/:id/cancel",async(req,res,next)=>{
 if(!uuid.test(req.params.id))return fail(res,"رقم الجرد غير صحيح");
 try{const r=await pool.query("UPDATE stocktakes SET status='cancelled' WHERE id=$1 AND status='counting' RETURNING *",[req.params.id]);if(!r.rowCount)return fail(res,"لا يمكن إلغاء الجرد بعد ترحيله أو إقفاله",409);res.json({stocktake:r.rows[0]});}catch(e){next(e);}
});

export default router;
