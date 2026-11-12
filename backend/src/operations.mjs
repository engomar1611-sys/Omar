export function calculateMaterialVariance(rows) {
  return rows.map((row) => {
    const expectedQuantity = Number(row.expected_quantity ?? 0);
    const actualQuantity = Number(row.actual_quantity ?? 0);
    const varianceQuantity = actualQuantity - expectedQuantity;
    const actualCost = Number(row.actual_cost ?? 0);
    const actualUnitCost = actualQuantity > 0 ? actualCost / actualQuantity : 0;
    return {
      ...row,
      expectedQuantity,
      actualQuantity,
      varianceQuantity,
      variancePercent: expectedQuantity > 0 ? (varianceQuantity / expectedQuantity) * 100 : 0,
      actualCost,
      expectedCostAtActualUnitCost: expectedQuantity * actualUnitCost,
      costVarianceAtActualUnitCost: actualCost - (expectedQuantity * actualUnitCost)
    };
  });
}

function auth(app, permission) {
  return { preHandler: [app.authenticate, app.requirePermission(permission)] };
}
function invalid(reply, message = 'البيانات المدخلة غير صحيحة') {
  return reply.code(400).send({ error: 'VALIDATION_ERROR', message });
}
function failure(reply, error) {
  if (error.code === '23505') return reply.code(409).send({ error: 'DUPLICATE' });
  if (error.code === '23503') return reply.code(409).send({ error: 'REFERENCED' });
  if (error.code === '23514' || error.code === '22P02') return reply.code(400).send({ error: 'INVALID_DATA' });
  if (error.code === 'P0001') return reply.code(409).send({ error: 'BUSINESS_RULE', message: error.message });
  throw error;
}
async function transaction(db, work) {
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    const value = await work(client);
    await client.query('COMMIT');
    return value;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally { client.release(); }
}
async function issueProductionMaterials(c, order, issueQty, userId) {
  const existing = await c.query('SELECT id FROM production_material_issues WHERE production_order_id=$1 FOR UPDATE',[order.id]);
  if(existing.rowCount) throw Object.assign(new Error('تم صرف خامات أمر الإنتاج مسبقاً'),{code:'P0001'});
  const lines = await c.query(`SELECT item_id,SUM(percentage)::numeric percentage FROM formulation_lines WHERE formulation_id=$1 GROUP BY item_id ORDER BY item_id`,[order.formulation_id]);
  if(!lines.rowCount) throw Object.assign(new Error('التركيبة لا تحتوي على مكونات'),{code:'P0001'});
  const pctTotal=lines.rows.reduce((sum,line)=>sum+Number(line.percentage),0);
  if(Math.abs(pctTotal-100)>0.000001) throw Object.assign(new Error('مجموع نسب التركيبة يجب أن يساوي 100%'),{code:'P0001'});
  const header=await c.query(`INSERT INTO production_material_issues(issue_no,production_order_id,issue_qty,issued_by) VALUES('MI-'||SUBSTRING(REPLACE(gen_random_uuid()::text,'-',''),1,20),$1,$2,$3) RETURNING *`,[order.id,issueQty,userId]);
  const issue=header.rows[0]; let totalCost=0, sequence=0; const issued=[];
  for(const line of lines.rows){
    let required=issueQty*Number(line.percentage)/100;
    const lots=await c.query(`SELECT lot_no,quantity,average_unit_cost FROM inventory_balances WHERE warehouse_id=$1 AND item_id=$2 AND quantity>0 AND quality_status='RELEASED' ORDER BY expiry_date ASC NULLS LAST,lot_no ASC FOR UPDATE`,[order.warehouse_id,line.item_id]);
    const available=lots.rows.reduce((sum,lot)=>sum+Number(lot.quantity),0);
    if(available+0.000001<required) throw Object.assign(new Error('رصيد المخزون المفرج عنه غير كافٍ لأحد مكونات التركيبة'),{code:'P0001'});
    for(const lot of lots.rows){
      if(required<=0.000001) break;
      const used=Math.min(required,Number(lot.quantity)),average=Number(lot.average_unit_cost),cost=used*average;
      await c.query(`UPDATE inventory_balances SET quantity=quantity-$1,updated_at=NOW() WHERE warehouse_id=$2 AND item_id=$3 AND lot_no=$4`,[used,order.warehouse_id,line.item_id,lot.lot_no]);
      await c.query(`INSERT INTO production_consumptions(production_order_id,item_id,lot_no,quantity,average_unit_cost,extended_cost) VALUES($1,$2,$3,$4,$5,$6)`,[order.id,line.item_id,lot.lot_no,used,average,cost]);
      sequence++;
      await c.query(`INSERT INTO stock_movements(movement_no,warehouse_id,item_id,lot_no,movement_type,quantity_out,unit_cost,reference_type,reference_id,created_by) VALUES($1,$2,$3,$4,'PRODUCTION_ISSUE',$5,$6,'PRODUCTION_MATERIAL_ISSUE',$7,$8)`,['PI-'+issue.id.slice(0,8)+'-'+sequence,order.warehouse_id,line.item_id,lot.lot_no,used,average,issue.id,userId]);
      totalCost+=cost; issued.push({itemId:line.item_id,lotNo:lot.lot_no,quantity:used,unitCost:average,totalCost:cost}); required-=used;
    }
  }
  await c.query('UPDATE production_material_issues SET total_cost=$1 WHERE id=$2',[totalCost,issue.id]);
  return {...issue,total_cost:totalCost,lines:issued};
}
const text = (v, max) => typeof v === 'string' && v.trim().length > 0 && v.trim().length <= max;
const positive = (v) => Number.isFinite(Number(v)) && Number(v) > 0;

export async function operationsRoutes(app, { db }) {
  app.get('/api/v1/suppliers', auth(app,'SUPPLIERS.READ'), async (_req,reply) => {
    try { return (await db.query('SELECT id,code,name_ar,tax_number,phone,address,payment_terms_days,is_active FROM suppliers ORDER BY code')).rows; }
    catch(e){ return failure(reply,e); }
  });
  app.post('/api/v1/suppliers', auth(app,'SUPPLIERS.MANAGE'), async (req,reply) => {
    const b=req.body??{};
    if(!text(b.code,40)||!text(b.nameAr,200)|| (b.paymentTermsDays!==undefined && (!Number.isInteger(b.paymentTermsDays)||b.paymentTermsDays<0))) return invalid(reply);
    try {
      const r=await db.query('INSERT INTO suppliers(code,name_ar,tax_number,phone,address,payment_terms_days) VALUES($1,$2,$3,$4,$5,$6) RETURNING *',
        [b.code.trim(),b.nameAr.trim(),b.taxNumber??null,b.phone??null,b.address??null,b.paymentTermsDays??0]);
      return reply.code(201).send(r.rows[0]);
    } catch(e){ return failure(reply,e); }
  });

  app.get('/api/v1/purchases', auth(app,'PURCHASES.READ'), async (_req,reply) => {
    try { return (await db.query(`SELECT p.*,s.name_ar supplier_name,
      COALESCE(json_agg(json_build_object('id',l.id,'itemId',l.item_id,'itemCode',i.code,'itemName',i.name_ar,'orderedQty',l.ordered_qty,'receivedQty',l.received_qty,'unitCost',l.unit_cost))
      FILTER(WHERE l.id IS NOT NULL),'[]'::json) lines
      FROM purchase_orders p JOIN suppliers s ON s.id=p.supplier_id
      LEFT JOIN purchase_order_lines l ON l.purchase_order_id=p.id
      LEFT JOIN items i ON i.id=l.item_id
      GROUP BY p.id,s.name_ar ORDER BY p.created_at DESC`)).rows; }
    catch(e){ return failure(reply,e); }
  });
  app.post('/api/v1/purchases', auth(app,'PURCHASES.MANAGE'), async (req,reply) => {
    const b=req.body??{};
    if(!text(b.orderNo,40)||!b.supplierId||!b.warehouseId||!Array.isArray(b.lines)||!b.lines.length||
      b.lines.some((l)=>!l.itemId||!positive(l.quantity)||!Number.isFinite(Number(l.unitCost))||Number(l.unitCost)<0)) return invalid(reply);
    try {
      const order=await transaction(db,async c=>{
        const h=await c.query(`INSERT INTO purchase_orders(order_no,supplier_id,warehouse_id,order_date,expected_date,notes,created_by)
          VALUES($1,$2,$3,COALESCE($4::date,CURRENT_DATE),$5,$6,$7) RETURNING *`,
          [b.orderNo.trim(),b.supplierId,b.warehouseId,b.orderDate??null,b.expectedDate??null,b.notes??null,req.authUser.user_id]);
        for(let i=0;i<b.lines.length;i++){
          const l=b.lines[i];
          await c.query('INSERT INTO purchase_order_lines(purchase_order_id,line_no,item_id,ordered_qty,unit_cost) VALUES($1,$2,$3,$4,$5)',
            [h.rows[0].id,i+1,l.itemId,l.quantity,l.unitCost]);
        }
        return h.rows[0];
      });
      return reply.code(201).send(order);
    } catch(e){ return failure(reply,e); }
  });

  app.post('/api/v1/purchases/:id/approve', auth(app,'PURCHASES.APPROVE'), async(req,reply)=>{
    try {
      const r=await db.query(`UPDATE purchase_orders SET status='APPROVED'
        WHERE id=$1 AND status='DRAFT' RETURNING *`,[req.params.id]);
      if(!r.rowCount) return reply.code(409).send({error:'INVALID_STATUS'});
      return r.rows[0];
    }catch(e){return failure(reply,e);}
  });

  app.get('/api/v1/goods-receipts', auth(app,'PURCHASES.READ'), async(_req,reply)=>{
    try{return (await db.query(`SELECT g.*,p.order_no,s.name_ar supplier_name,
      COALESCE(json_agg(json_build_object('id',l.id,'itemId',l.item_id,'itemCode',i.code,'itemName',i.name_ar,'lotNo',l.lot_no,
        'receivedQty',l.received_qty,'acceptedQty',l.accepted_qty,'rejectedQty',l.rejected_qty))
        FILTER(WHERE l.id IS NOT NULL),'[]'::json) lines
      FROM goods_receipts g JOIN purchase_orders p ON p.id=g.purchase_order_id
      JOIN suppliers s ON s.id=p.supplier_id LEFT JOIN goods_receipt_lines l ON l.goods_receipt_id=g.id
      LEFT JOIN items i ON i.id=l.item_id
      GROUP BY g.id,p.order_no,s.name_ar ORDER BY g.received_at DESC`)).rows;}
    catch(e){return failure(reply,e);}
  });

  app.post('/api/v1/goods-receipts', auth(app,'RECEIVING.MANAGE'), async(req,reply)=>{
    const b=req.body??{};
    if(!text(b.receiptNo,40)||!b.purchaseOrderId||!Array.isArray(b.lines)||!b.lines.length||
      b.lines.some(l=>!l.purchaseOrderLineId||!positive(l.quantity))) return invalid(reply);
    try{
      const receipt=await transaction(db,async c=>{
        const po=await c.query('SELECT id,status FROM purchase_orders WHERE id=$1 FOR UPDATE',[b.purchaseOrderId]);
        if(!po.rowCount||!['APPROVED','PARTIALLY_RECEIVED'].includes(po.rows[0].status)) throw Object.assign(new Error('أمر الشراء غير معتمد أو مغلق'),{code:'P0001'});
        const h=await c.query(`INSERT INTO goods_receipts(receipt_no,purchase_order_id,received_by,notes)
          VALUES($1,$2,$3,$4) RETURNING *`,[b.receiptNo.trim(),b.purchaseOrderId,req.authUser.user_id,b.notes??null]);
        for(const l of b.lines){
          const pl=await c.query('SELECT id,item_id,ordered_qty,received_qty,unit_cost FROM purchase_order_lines WHERE id=$1 AND purchase_order_id=$2 FOR UPDATE',[l.purchaseOrderLineId,b.purchaseOrderId]);
          if(!pl.rowCount||Number(pl.rows[0].received_qty)+Number(l.quantity)>Number(pl.rows[0].ordered_qty)) throw Object.assign(new Error('كمية الاستلام تتجاوز المتبقي بأمر الشراء'),{code:'P0001'});
          const item=pl.rows[0];
          await c.query(`INSERT INTO goods_receipt_lines(goods_receipt_id,purchase_order_line_id,item_id,lot_no,expiry_date,received_qty,unit_cost)
            VALUES($1,$2,$3,$4,$5,$6,$7)`,[h.rows[0].id,item.id,item.item_id,l.lotNo??null,l.expiryDate??null,l.quantity,item.unit_cost]);
        }
        return h.rows[0];
      });
      return reply.code(201).send(receipt);
    }catch(e){return failure(reply,e);}
  });

  app.post('/api/v1/goods-receipts/:id/quality', auth(app,'QUALITY.APPROVE'), async(req,reply)=>{
    const b=req.body??{};
    if(!Array.isArray(b.inspections)||!b.inspections.length||b.inspections.some(x=>!x.receiptLineId||
      !['PASS','PARTIAL','FAIL'].includes(x.result)||!Number.isFinite(Number(x.acceptedQty))||
      !Number.isFinite(Number(x.rejectedQty))||Number(x.acceptedQty)<0||Number(x.rejectedQty)<0||
      Number(x.acceptedQty)+Number(x.rejectedQty)<=0)) return invalid(reply);
    try{
      const result=await transaction(db,async c=>{
        const rh=await c.query(`SELECT id,purchase_order_id,status FROM goods_receipts WHERE id=$1 FOR UPDATE`,[req.params.id]);
        if(!rh.rowCount||rh.rows[0].status!=='PENDING_QC') throw Object.assign(new Error('إذن الاستلام غير متاح للفحص'),{code:'P0001'});
        let acceptedTotal=0,rejectedTotal=0,acceptedCost=0;
        for(const x of b.inspections){
          const lr=await c.query(`SELECT l.*,p.warehouse_id,p.order_no
            FROM goods_receipt_lines l JOIN goods_receipts g ON g.id=l.goods_receipt_id
            JOIN purchase_orders p ON p.id=g.purchase_order_id
            WHERE l.id=$1 AND l.goods_receipt_id=$2 FOR UPDATE`,[x.receiptLineId,req.params.id]);
          if(!lr.rowCount) throw Object.assign(new Error('سطر الاستلام غير موجود'),{code:'P0001'});
          const line=lr.rows[0], a=Number(x.acceptedQty), rej=Number(x.rejectedQty);
          if(Math.abs((a+rej)-Number(line.received_qty))>0.000001) throw Object.assign(new Error('يجب أن يساوي مجموع المقبول والمرفوض كامل الكمية المستلمة'),{code:'P0001'});
          await c.query(`INSERT INTO quality_inspections(goods_receipt_line_id,inspected_by,result,accepted_qty,rejected_qty,parameters,notes)
            VALUES($1,$2,$3,$4,$5,$6::jsonb,$7)`,[line.id,req.authUser.user_id,x.result,a,rej,JSON.stringify(x.parameters??{}),x.notes??null]);
          await c.query('UPDATE goods_receipt_lines SET accepted_qty=$1,rejected_qty=$2 WHERE id=$3',[a,rej,line.id]);
          if(a>0){
            const bal=await c.query(`SELECT quantity,average_unit_cost FROM inventory_balances
              WHERE warehouse_id=$1 AND item_id=$2 AND lot_no=$3 FOR UPDATE`,[line.warehouse_id,line.item_id,line.lot_no??'']);
            const oldQty=bal.rowCount?Number(bal.rows[0].quantity):0, oldAvg=bal.rowCount?Number(bal.rows[0].average_unit_cost):0;
            const cost=Number(line.unit_cost), newQty=oldQty+a, avg=newQty===0?0:((oldQty*oldAvg)+(a*cost))/newQty;
            await c.query(`INSERT INTO inventory_balances(warehouse_id,item_id,lot_no,expiry_date,quantity,average_unit_cost)
              VALUES($1,$2,$3,$4,$5,$6)
              ON CONFLICT(warehouse_id,item_id,lot_no) DO UPDATE SET quantity=EXCLUDED.quantity,average_unit_cost=EXCLUDED.average_unit_cost,expiry_date=COALESCE(EXCLUDED.expiry_date,inventory_balances.expiry_date),updated_at=NOW()`,
              [line.warehouse_id,line.item_id,line.lot_no??'',line.expiry_date,a+oldQty,avg]);
            await c.query(`INSERT INTO stock_movements(movement_no,warehouse_id,item_id,lot_no,movement_type,quantity_in,unit_cost,reference_type,reference_id,created_by)
              VALUES($1,$2,$3,$4,'PURCHASE_RECEIPT',$5,$6,'GOODS_RECEIPT',$7,$8)`,
              [`GR-${line.id}`,line.warehouse_id,line.item_id,line.lot_no??'',a,cost,req.params.id,req.authUser.user_id]);
            acceptedCost+=a*cost;
          }
          await c.query('UPDATE purchase_order_lines SET received_qty=received_qty+$1 WHERE id=$2',[a+rej,line.purchase_order_line_id]);
          acceptedTotal+=a; rejectedTotal+=rej;
        }
        const all=await c.query('SELECT COUNT(*)::int total,COUNT(q.id)::int inspected FROM goods_receipt_lines l LEFT JOIN quality_inspections q ON q.goods_receipt_line_id=l.id WHERE l.goods_receipt_id=$1',[req.params.id]);
        if(all.rows[0].total!==all.rows[0].inspected) throw Object.assign(new Error('يجب فحص جميع بنود إذن الاستلام قبل الاعتماد'),{code:'P0001'});
        const status=acceptedTotal===0?'REJECTED':rejectedTotal>0?'PARTIAL':'ACCEPTED';
        await c.query(`UPDATE goods_receipts SET status=$1,quality_approved_by=$2,quality_approved_at=NOW() WHERE id=$3`,[status,req.authUser.user_id,req.params.id]);
        if(acceptedCost>0){
          const accounts=await c.query("SELECT code,id FROM gl_accounts WHERE code IN ('1200','2000')");
          const inv=accounts.rows.find(x=>x.code==='1200')?.id,ap=accounts.rows.find(x=>x.code==='2000')?.id;
          if(!inv||!ap)throw Object.assign(new Error('حساب المخزون أو الموردين غير معرف'),{code:'P0001'});
          const lock=await c.query(`SELECT status FROM accounting_periods WHERE CURRENT_DATE BETWEEN start_date AND end_date FOR UPDATE`);
          if(lock.rowCount&&lock.rows[0].status!=='OPEN')throw Object.assign(new Error('الفترة المحاسبية مغلقة أو مقفلة'),{code:'P0001'});
          const entryNo='J-GR-'+String(req.params.id).slice(0,12);
          const je=await c.query(`INSERT INTO journal_entries(entry_no,source_type,source_id,description,total_debit,total_credit,created_by)
            VALUES($1,'GOODS_RECEIPT',$2,'إثبات استلام مشتريات بعد اعتماد الجودة',$3,$3,$4) RETURNING id`,
            [entryNo,req.params.id,acceptedCost,req.authUser.user_id]);
          await c.query('INSERT INTO journal_lines(journal_entry_id,account_id,debit,credit) VALUES($1,$2,$3,0),($1,$4,0,$3)',
            [je.rows[0].id,inv,acceptedCost,ap]);
        }
        const poLines=await c.query('SELECT COUNT(*)::int total,COUNT(*) FILTER(WHERE received_qty>=ordered_qty)::int done FROM purchase_order_lines WHERE purchase_order_id=$1',[rh.rows[0].purchase_order_id]);
        await c.query(`UPDATE purchase_orders SET status=CASE WHEN $1=$2 THEN 'RECEIVED' ELSE 'PARTIALLY_RECEIVED' END WHERE id=$3`,[poLines.rows[0].done,poLines.rows[0].total,rh.rows[0].purchase_order_id]);
        return {receiptId:req.params.id,status,acceptedQty:acceptedTotal,rejectedQty:rejectedTotal};
      });
      return result;
    }catch(e){return failure(reply,e);}
  });

  app.get('/api/v1/inventory/balances', auth(app,'INVENTORY.READ'), async(req,reply)=>{
    try{return (await db.query(`SELECT b.*,i.code item_code,i.name_ar item_name,w.code warehouse_code
      FROM inventory_balances b JOIN items i ON i.id=b.item_id JOIN warehouses w ON w.id=b.warehouse_id
      WHERE ($1::uuid IS NULL OR b.warehouse_id=$1) ORDER BY i.code,b.lot_no`,[req.query?.warehouseId??null])).rows;}
    catch(e){return failure(reply,e);}
  });

  app.get('/api/v1/production/work-centers',auth(app,'PRODUCTION.READ'),async(_req,reply)=>{
    try{return (await db.query(`SELECT wc.*,pl.code plant_code FROM production_work_centers wc
      LEFT JOIN plants pl ON pl.id=wc.plant_id ORDER BY wc.code`)).rows;}
    catch(e){return failure(reply,e);}
  });
  app.post('/api/v1/production/work-centers',auth(app,'PRODUCTION.SCHEDULE.MANAGE'),async(req,reply)=>{
    const b=req.body??{};
    if(!text(b.code,30)||!text(b.nameAr,120)||!positive(b.capacityKgPerHour))return invalid(reply);
    try{return reply.code(201).send((await db.query(`INSERT INTO production_work_centers(code,name_ar,plant_id,capacity_kg_per_hour)
      VALUES($1,$2,$3,$4) RETURNING *`,[b.code.trim(),b.nameAr.trim(),b.plantId??null,b.capacityKgPerHour])).rows[0]);}
    catch(e){return failure(reply,e);}
  });
  app.get('/api/v1/production/schedule',auth(app,'PRODUCTION.READ'),async(req,reply)=>{
    const from=req.query?.from??null,to=req.query?.to??null;
    try{return (await db.query(`SELECT s.*,p.order_no,fp.code product_code,fp.name_ar product_name,
      wc.code work_center_code,wc.name_ar work_center_name
      FROM production_schedule_entries s JOIN production_orders p ON p.id=s.production_order_id
      JOIN feed_products fp ON fp.id=p.feed_product_id JOIN production_work_centers wc ON wc.id=s.work_center_id
      WHERE ($1::timestamptz IS NULL OR s.end_at>=$1) AND ($2::timestamptz IS NULL OR s.start_at<=$2)
      ORDER BY s.start_at,wc.code`,[from,to])).rows;}
    catch(e){return failure(reply,e);}
  });
  app.post('/api/v1/production/schedule',auth(app,'PRODUCTION.SCHEDULE.MANAGE'),async(req,reply)=>{
    const b=req.body??{},start=new Date(b.startAt),end=new Date(b.endAt);
    if(!b.productionOrderId||!b.workCenterId||!Number.isFinite(start.getTime())||!Number.isFinite(end.getTime())||
      end<=start||!positive(b.plannedQty))return invalid(reply,'أدخل أمر الإنتاج ومركز التشغيل ووقت بداية ونهاية صحيحين وكمية موجبة');
    const hours=(end-start)/3600000;
    try{const result=await transaction(db,async c=>{
      const center=await c.query('SELECT * FROM production_work_centers WHERE id=$1 AND is_active=TRUE FOR UPDATE',[b.workCenterId]);
      if(!center.rowCount)throw Object.assign(new Error('مركز التشغيل غير موجود أو غير نشط'),{code:'P0001'});
      const order=await c.query('SELECT id,status,planned_qty FROM production_orders WHERE id=$1 FOR UPDATE',[b.productionOrderId]);
      if(!order.rowCount||order.rows[0].status!=='RELEASED')throw Object.assign(new Error('يجب تحرير أمر الإنتاج للتشغيل قبل جدولته'),{code:'P0001'});
      if(Number(b.plannedQty)>Number(center.rows[0].capacity_kg_per_hour)*hours+0.000001)
        throw Object.assign(new Error('الكمية تتجاوز الطاقة الإنتاجية لمركز التشغيل خلال المدة المحددة'),{code:'P0001'});
      const overlap=await c.query(`SELECT id FROM production_schedule_entries
        WHERE work_center_id=$1 AND status IN ('PLANNED','CONFIRMED','IN_PROGRESS')
          AND start_at<$3 AND end_at>$2 FOR UPDATE`,[b.workCenterId,start.toISOString(),end.toISOString()]);
      if(overlap.rowCount)throw Object.assign(new Error('يوجد تعارض زمني مع جدول تشغيل آخر على نفس المركز'),{code:'P0001'});
      const allocated=await c.query(`SELECT COALESCE(SUM(planned_qty),0) qty FROM production_schedule_entries
        WHERE production_order_id=$1 AND status<>'CANCELLED'`,[b.productionOrderId]);
      if(Number(allocated.rows[0].qty)+Number(b.plannedQty)>Number(order.rows[0].planned_qty)+0.000001)
        throw Object.assign(new Error('إجمالي الكميات المجدولة يتجاوز كمية أمر الإنتاج'),{code:'P0001'});
      const created=await c.query(`INSERT INTO production_schedule_entries
        (schedule_no,production_order_id,work_center_id,start_at,end_at,planned_qty,notes,created_by)
        VALUES('SCH-'||TO_CHAR(NOW(),'YYMMDDHH24MISSMS')||'-'||SUBSTRING(REPLACE(gen_random_uuid()::text,'-',''),1,6),
          $1,$2,$3,$4,$5,$6,$7) RETURNING *`,
        [b.productionOrderId,b.workCenterId,start.toISOString(),end.toISOString(),b.plannedQty,b.notes??null,req.authUser.user_id]);
      return created.rows[0];
    });return reply.code(201).send(result);}catch(e){return failure(reply,e);}
  });
  app.put('/api/v1/production/schedule/:id/status',auth(app,'PRODUCTION.SCHEDULE.MANAGE'),async(req,reply)=>{
    const next=req.body?.status;
    if(!['CONFIRMED','IN_PROGRESS','COMPLETED','CANCELLED'].includes(next))return invalid(reply,'حالة الجدولة غير صحيحة');
    try{const result=await transaction(db,async c=>{
      const row=await c.query('SELECT * FROM production_schedule_entries WHERE id=$1 FOR UPDATE',[req.params.id]);
      if(!row.rowCount)throw Object.assign(new Error('جدولة الإنتاج غير موجودة'),{code:'P0001'});
      const current=row.rows[0].status,allowed={PLANNED:['CONFIRMED','CANCELLED'],CONFIRMED:['IN_PROGRESS','CANCELLED'],IN_PROGRESS:['COMPLETED']}[current]??[];
      if(!allowed.includes(next))throw Object.assign(new Error('انتقال الحالة غير مسموح'),{code:'P0001'});
      const updated=await c.query(`UPDATE production_schedule_entries SET status=$2,
        confirmed_by=CASE WHEN $2='CONFIRMED' THEN $3 ELSE confirmed_by END,
        confirmed_at=CASE WHEN $2='CONFIRMED' THEN NOW() ELSE confirmed_at END,
        started_at=CASE WHEN $2='IN_PROGRESS' THEN NOW() ELSE started_at END,
        completed_at=CASE WHEN $2='COMPLETED' THEN NOW() ELSE completed_at END
        WHERE id=$1 RETURNING *`,[req.params.id,next,req.authUser.user_id]);
      return updated.rows[0];
    });return result;}catch(e){return failure(reply,e);}
  });

  app.get('/api/v1/production/orders', auth(app,'PRODUCTION.READ'), async(_req,reply)=>{
    try{return (await db.query(`SELECT p.*,fp.code product_code,fp.name_ar product_name,
      f.version_no formulation_version,w.name_ar warehouse_name,
      EXISTS(SELECT 1 FROM journal_entries j WHERE j.source_type='PRODUCTION_COST' AND j.source_id=p.id AND j.status='POSTED') costs_journal_posted,
      EXISTS(SELECT 1 FROM production_material_issues mi WHERE mi.production_order_id=p.id) material_issued,
      (SELECT mi.status FROM production_material_issues mi WHERE mi.production_order_id=p.id) material_issue_status,
      (SELECT mi.id FROM production_material_issues mi WHERE mi.production_order_id=p.id) material_issue_id
      FROM production_orders p JOIN feed_products fp ON fp.id=p.feed_product_id
      JOIN formulations f ON f.id=p.formulation_id JOIN warehouses w ON w.id=p.warehouse_id
      ORDER BY p.created_at DESC`)).rows;}
    catch(e){return failure(reply,e);}
  });

  app.get('/api/v1/production/orders/:id/details', auth(app,'PRODUCTION.READ'), async(req,reply)=>{
    try{
      const order=await db.query(`SELECT p.*,fp.code product_code,fp.name_ar product_name,
        f.version_no formulation_version,w.code warehouse_code,w.name_ar warehouse_name
        FROM production_orders p JOIN feed_products fp ON fp.id=p.feed_product_id
        JOIN formulations f ON f.id=p.formulation_id JOIN warehouses w ON w.id=p.warehouse_id
        WHERE p.id=$1`,[req.params.id]);
      if(!order.rowCount)return reply.code(404).send({error:'NOT_FOUND'});
      const [consumptions,output,components,journals,materialIssue,losses]=await Promise.all([
        db.query(`SELECT pc.item_id,i.code item_code,i.name_ar item_name,pc.lot_no,pc.quantity,
          pc.average_unit_cost,pc.extended_cost
          FROM production_consumptions pc JOIN items i ON i.id=pc.item_id
          WHERE pc.production_order_id=$1 ORDER BY i.code,pc.lot_no`,[req.params.id]),
        db.query(`SELECT o.item_id,i.code item_code,i.name_ar item_name,o.lot_no,o.quantity,o.unit_cost,o.total_cost,
          b.quality_status,b.expiry_date
          FROM production_outputs o JOIN items i ON i.id=o.item_id
          LEFT JOIN inventory_balances b ON b.warehouse_id=(SELECT warehouse_id FROM production_orders WHERE id=$1)
            AND b.item_id=o.item_id AND b.lot_no=o.lot_no
          WHERE o.production_order_id=$1`,[req.params.id]),
        db.query(`SELECT component_code,description,amount FROM production_cost_components
          WHERE production_order_id=$1 ORDER BY component_code,created_at`,[req.params.id]),
        db.query(`SELECT j.id,j.entry_no,j.entry_date,j.source_type,j.description,j.status,j.total_debit,j.total_credit,
          COALESCE(json_agg(json_build_object('account_code',a.code,'account_name',a.name_ar,
            'debit',l.debit,'credit',l.credit,'description',l.description) ORDER BY a.code)
            FILTER(WHERE l.id IS NOT NULL),'[]'::json) lines
          FROM journal_entries j LEFT JOIN journal_lines l ON l.journal_entry_id=j.id
          LEFT JOIN gl_accounts a ON a.id=l.account_id
          WHERE j.source_id=$1 AND j.source_type='PRODUCTION_COST'
          GROUP BY j.id ORDER BY j.created_at`,[req.params.id]),
        db.query(`SELECT id,issue_no,issue_qty,total_cost,status,issued_at,issued_by,reversed_at,reversed_by,reversal_reason FROM production_material_issues WHERE production_order_id=$1`,[req.params.id]),
        db.query(`SELECT l.id,l.loss_type,l.quantity,l.reason,l.created_at,l.approved_at,l.journal_entry_id,
          CASE WHEN l.approved_by IS NULL THEN 'PENDING_APPROVAL' ELSE 'POSTED' END status,
          j.entry_no,j.total_debit loss_value,creator.display_name created_by_name,approver.display_name approved_by_name
          FROM production_losses l LEFT JOIN journal_entries j ON j.id=l.journal_entry_id
          LEFT JOIN users creator ON creator.id=l.created_by LEFT JOIN users approver ON approver.id=l.approved_by
          WHERE l.production_order_id=$1 ORDER BY l.created_at DESC`,[req.params.id])
      ]);
      return {order:order.rows[0],consumptions:consumptions.rows,output:output.rows[0]??null,
        costComponents:components.rows,journalEntries:journals.rows,losses:losses.rows,materialIssue:materialIssue.rows[0]??null};
    }catch(e){return failure(reply,e);}
  });

  app.get('/api/v1/reports/production-material-variance', auth(app,'PRODUCTION.READ'), async(req,reply)=>{
    const {from,to,productionOrderId}=req.query??{};
    const validDate=value=>!value||(/^\\d{4}-\\d{2}-\\d{2}$/.test(value)&&!Number.isNaN(Date.parse(value+'T00:00:00Z')));
    if(!validDate(from)||!validDate(to)||(from&&to&&from>to))
      return invalid(reply,'أدخل نطاق تاريخ صحيحاً');
    try{
      const result=await db.query(`WITH actual AS (
        SELECT production_order_id,item_id,SUM(quantity) actual_quantity,SUM(extended_cost) actual_cost
        FROM production_consumptions pc WHERE NOT EXISTS(SELECT 1 FROM production_material_issues mi WHERE mi.production_order_id=pc.production_order_id AND mi.status='REVERSED') GROUP BY production_order_id,item_id
      )
      SELECT p.id production_order_id,p.order_no,p.completed_at::date completed_date,
        fp.code product_code,fp.name_ar product_name,p.actual_qty,
        i.id item_id,i.code item_code,i.name_ar item_name,u.code unit_code,u.name_ar unit_name,
        l.percentage,
        (p.actual_qty*l.percentage/100.0) expected_quantity,
        COALESCE(a.actual_quantity,0) actual_quantity,
        COALESCE(a.actual_cost,0) actual_cost,
        CASE WHEN COALESCE(a.actual_quantity,0)>0
          THEN COALESCE(a.actual_cost,0)/a.actual_quantity ELSE 0 END actual_unit_cost
      FROM production_orders p
      JOIN feed_products fp ON fp.id=p.feed_product_id
      JOIN formulation_lines l ON l.formulation_id=p.formulation_id
      JOIN items i ON i.id=l.item_id
      JOIN units_of_measure u ON u.id=i.base_unit_id
      LEFT JOIN actual a ON a.production_order_id=p.id AND a.item_id=l.item_id
      WHERE p.status='COMPLETED'
        AND ($1::date IS NULL OR p.completed_at::date >= $1::date)
        AND ($2::date IS NULL OR p.completed_at::date <= $2::date)
        AND ($3::uuid IS NULL OR p.id=$3::uuid)
      ORDER BY p.completed_at DESC,p.order_no,i.code`,[from??null,to??null,productionOrderId??null]);
      const lines=calculateMaterialVariance(result.rows);
      const totals=lines.reduce((sum,line)=>{
        sum.expectedQuantity+=line.expectedQuantity;
        sum.actualQuantity+=line.actualQuantity;
        sum.varianceQuantity+=line.varianceQuantity;
        sum.actualCost+=line.actualCost;
        sum.expectedCostAtActualUnitCost+=line.expectedCostAtActualUnitCost;
        sum.costVarianceAtActualUnitCost+=line.costVarianceAtActualUnitCost;
        return sum;
      },{expectedQuantity:0,actualQuantity:0,varianceQuantity:0,actualCost:0,expectedCostAtActualUnitCost:0,costVarianceAtActualUnitCost:0});
      return {filters:{from:from??null,to:to??null,productionOrderId:productionOrderId??null},count:lines.length,totals,lines};
    }catch(e){return failure(reply,e);}
  });

  app.get('/api/v1/production/losses', auth(app,'PRODUCTION.READ'), async(_req,reply)=>{
    try{return (await db.query(`SELECT l.*,p.order_no,fp.code product_code,fp.name_ar product_name,o.lot_no,
      o.quantity output_quantity,o.unit_cost,CASE WHEN l.approved_by IS NULL THEN 'PENDING_APPROVAL' ELSE 'POSTED' END status,
      creator.display_name created_by_name,approver.display_name approved_by_name
      FROM production_losses l JOIN production_orders p ON p.id=l.production_order_id
      JOIN feed_products fp ON fp.id=p.feed_product_id JOIN production_outputs o ON o.production_order_id=p.id
      LEFT JOIN users creator ON creator.id=l.created_by LEFT JOIN users approver ON approver.id=l.approved_by
      ORDER BY l.created_at DESC LIMIT 500`)).rows;}
    catch(e){return failure(reply,e);}
  });
  app.post('/api/v1/production/losses', auth(app,'PRODUCTION.LOSSES.MANAGE'), async(req,reply)=>{
    const b=req.body??{};
    if(!b.productionOrderId||!['PROCESS','MOISTURE','DAMAGE','OTHER'].includes(b.lossType)||!positive(b.quantity)||!text(b.reason,1000))return invalid(reply);
    try{const result=await transaction(db,async c=>{
      const h=await c.query(`SELECT p.id,p.status,o.quantity output_quantity,b.quantity balance_qty,b.quality_status
        FROM production_orders p JOIN production_outputs o ON o.production_order_id=p.id
        JOIN inventory_balances b ON b.warehouse_id=p.warehouse_id AND b.item_id=o.item_id AND b.lot_no=o.lot_no
        WHERE p.id=$1 FOR UPDATE OF p,b`,[b.productionOrderId]);
      if(!h.rowCount||h.rows[0].status!=='COMPLETED'||h.rows[0].quality_status!=='RELEASED')
        throw Object.assign(new Error('يجب أن يكون أمر الإنتاج مكتملاً والمنتج النهائي مجتازاً للجودة'),{code:'P0001'});
      if(Number(b.quantity)>Number(h.rows[0].balance_qty)+0.000001)
        throw Object.assign(new Error('كمية الهالك تتجاوز رصيد التشغيلة المتاح'),{code:'P0001'});
      const created=await c.query(`INSERT INTO production_losses(production_order_id,loss_type,quantity,reason,created_by)
        VALUES($1,$2,$3,$4,$5) RETURNING *`,[b.productionOrderId,b.lossType,b.quantity,b.reason.trim(),req.authUser.user_id]);
      return {...created.rows[0],status:'PENDING_APPROVAL'};
    });return reply.code(201).send(result);}catch(e){return failure(reply,e);}
  });
  app.post('/api/v1/production/losses/:id/approve', auth(app,'PRODUCTION.LOSSES.APPROVE'), async(req,reply)=>{
    try{const result=await transaction(db,async c=>{
      const loss=await c.query('SELECT * FROM production_losses WHERE id=$1 FOR UPDATE',[req.params.id]);
      if(!loss.rowCount||loss.rows[0].approved_by)throw Object.assign(new Error('طلب الهالك غير متاح للاعتماد أو تم ترحيله مسبقاً'),{code:'P0001'});
      const data=await c.query(`SELECT p.id,p.warehouse_id,o.item_id,o.lot_no,b.quantity,b.average_unit_cost,b.quality_status
        FROM production_orders p JOIN production_outputs o ON o.production_order_id=p.id
        JOIN inventory_balances b ON b.warehouse_id=p.warehouse_id AND b.item_id=o.item_id AND b.lot_no=o.lot_no
        WHERE p.id=$1 FOR UPDATE OF p,b`,[loss.rows[0].production_order_id]);
      if(!data.rowCount||data.rows[0].quality_status!=='RELEASED')throw Object.assign(new Error('التشغيلة غير متاحة للصرف؛ يجب اجتياز فحص الجودة'),{code:'P0001'});
      const row=data.rows[0],qty=Number(loss.rows[0].quantity),available=Number(row.quantity),cost=Number(row.average_unit_cost);
      if(qty>available+0.000001)throw Object.assign(new Error('الرصيد المتاح لا يكفي لاعتماد الهالك'),{code:'P0001'});
      const period=await c.query('SELECT status FROM accounting_periods WHERE CURRENT_DATE BETWEEN start_date AND end_date FOR UPDATE');
      if(period.rowCount&&period.rows.some(x=>x.status!=='OPEN'))throw Object.assign(new Error('الفترة المحاسبية مغلقة'),{code:'P0001'});
      const accounts=await c.query("SELECT id,code FROM gl_accounts WHERE code IN ('1200','5420') AND is_active=TRUE");
      const inventory=accounts.rows.find(x=>x.code==='1200')?.id,lossAccount=accounts.rows.find(x=>x.code==='5420')?.id;
      if(!inventory||!lossAccount)throw Object.assign(new Error('حساب المخزون أو خسائر هالك الإنتاج غير معرف'),{code:'P0001'});
      const amount=qty*cost,entry=await c.query(`INSERT INTO journal_entries(entry_no,entry_date,source_type,source_id,description,total_debit,total_credit,created_by)
        VALUES($1,CURRENT_DATE,'PRODUCTION_LOSS',$2,$3,$4,$4,$5) RETURNING id`,
        ['J-LOSS-'+req.params.id.slice(0,12),req.params.id,'إثبات هالك إنتاج لأمر '+row.id,amount,req.authUser.user_id]);
      await c.query('INSERT INTO journal_lines(journal_entry_id,account_id,debit,credit,description) VALUES($1,$2,$3,0,$4),($1,$5,0,$3,$6)',
        [entry.rows[0].id,lossAccount,amount,'خسائر هالك الإنتاج',inventory,'تخفيض مخزون المنتج النهائي']);
      await c.query(`UPDATE inventory_balances SET quantity=quantity-$1,updated_at=NOW()
        WHERE warehouse_id=$2 AND item_id=$3 AND lot_no=$4`,[qty,row.warehouse_id,row.item_id,row.lot_no]);
      await c.query(`INSERT INTO stock_movements(movement_no,warehouse_id,item_id,lot_no,movement_type,quantity_out,unit_cost,reference_type,reference_id,created_by)
        VALUES($1,$2,$3,$4,'PRODUCTION_LOSS',$5,$6,'PRODUCTION_LOSS',$7,$8)`,
        ['PL-'+req.params.id,row.warehouse_id,row.item_id,row.lot_no,qty,cost,req.params.id,req.authUser.user_id]);
      await c.query('UPDATE production_losses SET approved_by=$1,approved_at=NOW(),journal_entry_id=$2 WHERE id=$3',
        [req.authUser.user_id,entry.rows[0].id,req.params.id]);
      return {id:req.params.id,status:'POSTED',quantity:qty,unitCost:cost,totalCost:amount,journalEntryId:entry.rows[0].id,remainingQuantity:available-qty};
    });return result;}catch(e){return failure(reply,e);}
  });

  app.post('/api/v1/production/orders', auth(app,'PRODUCTION.MANAGE'), async(req,reply)=>{
    const b=req.body??{};
    if(!text(b.orderNo,40)||!b.feedProductId||!b.formulationId||!b.warehouseId||!positive(b.plannedQty))return invalid(reply);
    try{
      const r=await db.query(`INSERT INTO production_orders(order_no,feed_product_id,formulation_id,warehouse_id,planned_qty,created_by)
        SELECT $1,$2,$3,$4,$5,$6 WHERE EXISTS(SELECT 1 FROM formulations WHERE id=$3 AND feed_product_id=$2 AND status='APPROVED')
        RETURNING *`,[b.orderNo.trim(),b.feedProductId,b.formulationId,b.warehouseId,b.plannedQty,req.authUser.user_id]);
      if(!r.rowCount)return reply.code(409).send({error:'FORMULATION_NOT_APPROVED'});
      return reply.code(201).send(r.rows[0]);
    }catch(e){return failure(reply,e);}
  });

  app.post('/api/v1/production/orders/:id/release', auth(app,'PRODUCTION.MANAGE'), async(req,reply)=>{
    try {
      const r=await db.query(`UPDATE production_orders SET status='RELEASED',started_at=NOW()
        WHERE id=$1 AND status='DRAFT' RETURNING *`,[req.params.id]);
      if(!r.rowCount)return reply.code(409).send({error:'INVALID_STATUS'});
      return r.rows[0];
    }catch(e){return failure(reply,e);}
  });

  app.post('/api/v1/production/orders/:id/issue', auth(app,'PRODUCTION.MATERIALS.ISSUE'), async(req,reply)=>{
    const requested=req.body?.issueQty;
    if(requested!==undefined&&!positive(requested))return invalid(reply,'كمية الصرف يجب أن تكون أكبر من صفر');
    try{
      const result=await transaction(db,async c=>{
        const orderResult=await c.query('SELECT * FROM production_orders WHERE id=$1 FOR UPDATE',[req.params.id]);
        if(!orderResult.rowCount||orderResult.rows[0].status!=='RELEASED') throw Object.assign(new Error('يجب تحرير أمر الإنتاج قبل صرف الخامات'),{code:'P0001'});
        const order=orderResult.rows[0],issueQty=requested===undefined?Number(order.planned_qty):Number(requested);
        if(issueQty>Number(order.planned_qty)+0.000001) throw Object.assign(new Error('كمية الصرف لا يجوز أن تتجاوز الكمية المخططة لأمر الإنتاج'),{code:'P0001'});
        const issued=await issueProductionMaterials(c,order,issueQty,req.authUser.user_id);
        return {id:issued.id,issueNo:issued.issue_no,productionOrderId:order.id,issueQty:issued.issue_qty,totalCost:issued.total_cost,lines:issued.lines};
      });
      return reply.code(201).send(result);
    }catch(e){return failure(reply,e);}
  });
  app.post('/api/v1/production/material-issues/:id/reverse', auth(app,'PRODUCTION.MATERIALS.REVERSE'), async(req,reply)=>{
    const reason=req.body?.reason;
    if(!text(reason,1000))return invalid(reply,'سبب عكس إذن الصرف مطلوب ولا يتجاوز 1000 حرف');
    try{
      const result=await transaction(db,async c=>{
        const issueResult=await c.query('SELECT * FROM production_material_issues WHERE id=$1 FOR UPDATE',[req.params.id]);
        if(!issueResult.rowCount||issueResult.rows[0].status!=='POSTED')throw Object.assign(new Error('إذن الصرف غير موجود أو تم عكسه مسبقاً'),{code:'P0001'});
        const issue=issueResult.rows[0];
        const orderResult=await c.query('SELECT id,status,warehouse_id FROM production_orders WHERE id=$1 FOR UPDATE',[issue.production_order_id]);
        if(!orderResult.rowCount||orderResult.rows[0].status!=='RELEASED')throw Object.assign(new Error('لا يمكن عكس الصرف بعد بدء إتمام أمر الإنتاج أو إقفاله'),{code:'P0001'});
        const activeSchedule=await c.query(`SELECT id FROM production_schedule_entries WHERE production_order_id=$1 AND status IN ('IN_PROGRESS','COMPLETED') FOR UPDATE`,[issue.production_order_id]);
        if(activeSchedule.rowCount)throw Object.assign(new Error('لا يمكن عكس الصرف بعد بدء تنفيذ جدولة التشغيل'),{code:'P0001'});
        const lines=await c.query(`SELECT pc.item_id,pc.lot_no,pc.quantity,pc.average_unit_cost,b.quantity balance_qty
          FROM production_consumptions pc JOIN inventory_balances b ON b.warehouse_id=$2 AND b.item_id=pc.item_id AND b.lot_no=pc.lot_no
          WHERE pc.production_order_id=$1 ORDER BY pc.item_id,pc.lot_no FOR UPDATE OF b`,[issue.production_order_id,orderResult.rows[0].warehouse_id]);
        if(!lines.rowCount)throw Object.assign(new Error('لا توجد تفاصيل خامات مرتبطة بإذن الصرف'),{code:'P0001'});
        let restoredQty=0,restoredCost=0,sequence=0;
        for(const line of lines.rows){
          const later=await c.query(`SELECT id FROM stock_movements WHERE warehouse_id=$1 AND item_id=$2 AND lot_no=$3
            AND NOT(reference_type='PRODUCTION_MATERIAL_ISSUE' AND reference_id=$4) AND created_at >= $5 LIMIT 1`,
            [orderResult.rows[0].warehouse_id,line.item_id,line.lot_no,issue.id,issue.issued_at]);
          if(later.rowCount)throw Object.assign(new Error('تعذر العكس: توجد حركة مخزنية لاحقة على إحدى التشغيلات المصروفة'),{code:'P0001'});
          const qty=Number(line.quantity),cost=Number(line.average_unit_cost);
          await c.query('UPDATE inventory_balances SET quantity=quantity+$1,updated_at=NOW() WHERE warehouse_id=$2 AND item_id=$3 AND lot_no=$4',[qty,orderResult.rows[0].warehouse_id,line.item_id,line.lot_no]);
          sequence++;
          await c.query(`INSERT INTO stock_movements(movement_no,warehouse_id,item_id,lot_no,movement_type,quantity_in,unit_cost,reference_type,reference_id,created_by)
            VALUES($1,$2,$3,$4,'ADJUSTMENT_IN',$5,$6,'PRODUCTION_MATERIAL_ISSUE_REVERSAL',$7,$8)`,
            ['PIR-'+issue.id.slice(0,8)+'-'+sequence,orderResult.rows[0].warehouse_id,line.item_id,line.lot_no,qty,cost,issue.id,req.authUser.user_id]);
          restoredQty+=qty;restoredCost+=qty*cost;
        }
        await c.query(`UPDATE production_material_issues SET status='REVERSED',reversed_by=$1,reversed_at=NOW(),reversal_reason=$2 WHERE id=$3`,[req.authUser.user_id,reason.trim(),issue.id]);
        await c.query(`UPDATE production_orders SET status='CANCELLED' WHERE id=$1`,[issue.production_order_id]);
        await c.query(`UPDATE production_schedule_entries SET status='CANCELLED' WHERE production_order_id=$1 AND status IN ('PLANNED','CONFIRMED')`,[issue.production_order_id]);
        return {issueId:issue.id,issueNo:issue.issue_no,status:'REVERSED',productionOrderStatus:'CANCELLED',restoredQuantity:restoredQty,restoredCost,reason:reason.trim()};
      });
      return result;
    }catch(e){return failure(reply,e);}
  });
  app.post('/api/v1/production/orders/:id/complete', auth(app,'PRODUCTION.COMPLETE'), async(req,reply)=>{
    const b=req.body??{};
    if(!positive(b.actualQty)||!text(b.outputLotNo,80))return invalid(reply);
    try{
      const result=await transaction(db,async c=>{
        const pr=await c.query(`SELECT p.*,fp.item_id output_item_id FROM production_orders p
          JOIN feed_products fp ON fp.id=p.feed_product_id WHERE p.id=$1 FOR UPDATE`,[req.params.id]);
        if(!pr.rowCount||pr.rows[0].status!=='RELEASED')throw Object.assign(new Error('يجب تحرير أمر التشغيل قبل الإتمام'),{code:'P0001'});
        const order=pr.rows[0];
        const lines=await c.query('SELECT item_id,percentage FROM formulation_lines WHERE formulation_id=$1 ORDER BY sequence_no',[order.formulation_id]);
        if(!lines.rowCount)throw Object.assign(new Error('التركيبة لا تحتوي على مكونات'),{code:'P0001'});
        const pctTotal=lines.rows.reduce((sum,line)=>sum+Number(line.percentage),0);
        if(Math.abs(pctTotal-100)>0.000001)throw Object.assign(new Error('مجموع نسب التركيبة يجب أن يساوي 100%'),{code:'P0001'});
        const issueHeader=await c.query('SELECT id,issue_qty FROM production_material_issues WHERE production_order_id=$1 FOR UPDATE',[order.id]);
        let totalCost=0;
        if(!issueHeader.rowCount){
          const issued=await issueProductionMaterials(c,order,Number(b.actualQty),req.authUser.user_id);
          totalCost=Number(issued.total_cost);
        }else{
          const consumed=await c.query(`SELECT item_id,SUM(quantity) quantity,SUM(extended_cost) cost FROM production_consumptions WHERE production_order_id=$1 GROUP BY item_id`,[order.id]);
          const byItem=new Map(consumed.rows.map(row=>[row.item_id,Number(row.quantity)]));
          for(const line of lines.rows){
            const required=Number(b.actualQty)*Number(line.percentage)/100;
            if((byItem.get(line.item_id)||0)+0.000001<required) throw Object.assign(new Error('الخامات المصروفة لا تكفي لإتمام الكمية الفعلية؛ راجع إذن الصرف'),{code:'P0001'});
          }
          totalCost=consumed.rows.reduce((sum,row)=>sum+Number(row.cost),0);
        }
        const unitCost=totalCost/Number(b.actualQty);
        const existingLot=await c.query('SELECT 1 FROM inventory_balances WHERE warehouse_id=$1 AND item_id=$2 AND lot_no=$3 FOR UPDATE',[order.warehouse_id,order.output_item_id,b.outputLotNo]);
        if(existingLot.rowCount)throw Object.assign(new Error('رقم تشغيلة المنتج النهائي مستخدم مسبقاً؛ أدخل رقم تشغيلة جديداً'),{code:'P0001'});
        await c.query(`INSERT INTO inventory_balances(warehouse_id,item_id,lot_no,quantity,average_unit_cost,quality_status)
          VALUES($1,$2,$3,$4,$5,'PENDING_QC')`,
          [order.warehouse_id,order.output_item_id,b.outputLotNo,Number(b.actualQty),unitCost]);
        await c.query(`INSERT INTO production_outputs(production_order_id,item_id,lot_no,quantity,unit_cost,total_cost)
          VALUES($1,$2,$3,$4,$5,$6)`,[order.id,order.output_item_id,b.outputLotNo,b.actualQty,unitCost,totalCost]);
        await c.query(`INSERT INTO stock_movements(movement_no,warehouse_id,item_id,lot_no,movement_type,quantity_in,unit_cost,reference_type,reference_id,created_by)
          VALUES($1,$2,$3,$4,'PRODUCTION_OUTPUT',$5,$6,'PRODUCTION_ORDER',$7,$8)`,
          [`PO-${order.id}`,order.warehouse_id,order.output_item_id,b.outputLotNo,b.actualQty,unitCost,order.id,req.authUser.user_id]);
        const updated=await c.query(`UPDATE production_orders SET status='COMPLETED',actual_qty=$1,completed_at=NOW(),
          total_material_cost=$2,unit_production_cost=$3 WHERE id=$4 RETURNING *`,
          [b.actualQty,totalCost,unitCost,order.id]);
        return updated.rows[0];
      });
      return result;
    }catch(e){return failure(reply,e);}
  });

  app.put('/api/v1/production/orders/:id', auth(app,'PRODUCTION.MANAGE'), async(req,reply)=>{
    const b=req.body??{};
    if(!text(b.orderNo,40)||!b.feedProductId||!b.formulationId||!b.warehouseId||!positive(b.plannedQty))return invalid(reply);
    try{
      const r=await db.query(`UPDATE production_orders p SET order_no=$1,feed_product_id=$2,formulation_id=$3,warehouse_id=$4,planned_qty=$5 WHERE p.id=$6 AND p.status='DRAFT' AND EXISTS(SELECT 1 FROM formulations f WHERE f.id=$3 AND f.feed_product_id=$2 AND f.status='APPROVED') RETURNING p.*`,
        [b.orderNo.trim(),b.feedProductId,b.formulationId,b.warehouseId,b.plannedQty,req.params.id]);
      if(!r.rowCount)return reply.code(409).send({error:'INVALID_STATUS_OR_FORMULATION'});
      return r.rows[0];
    }catch(e){return failure(reply,e);}
  });

  app.post('/api/v1/production/orders/:id/costs', auth(app,'PRODUCTION.COSTS.MANAGE'), async(req,reply)=>{
    const components=req.body?.components,allowed=['LABOR','ENERGY','OVERHEAD','PACKAGING','WASTE'];
    if(!Array.isArray(components)||components.some(x=>!allowed.includes(x.componentCode)||!text(x.description,200)||!Number.isFinite(Number(x.amount))||Number(x.amount)<0))return invalid(reply);
    try{
      const result=await transaction(db,async c=>{
        const h=await c.query('SELECT p.id,p.status,p.warehouse_id,p.total_material_cost,o.item_id,o.lot_no,o.quantity,o.total_cost,b.quantity balance_qty,b.average_unit_cost,b.quality_status FROM production_orders p JOIN production_outputs o ON o.production_order_id=p.id JOIN inventory_balances b ON b.warehouse_id=p.warehouse_id AND b.item_id=o.item_id AND b.lot_no=o.lot_no WHERE p.id=$1 FOR UPDATE OF p,b',[req.params.id]);
        if(!h.rowCount||h.rows[0].status!=='COMPLETED'||!['PENDING_QC','QUARANTINED'].includes(h.rows[0].quality_status))throw Object.assign(new Error('يجب أن يكون الإنتاج مكتملاً والمنتج بانتظار فحص الجودة'),{code:'P0001'});
        const existingJournal=await c.query("SELECT id FROM journal_entries WHERE source_type='PRODUCTION_COST' AND source_id=$1 FOR UPDATE",[req.params.id]);
        if(existingJournal.rowCount)throw Object.assign(new Error('تم ترحيل تكلفة هذا الأمر محاسبياً ولا يمكن تعديلها مباشرة'),{code:'P0001'});
        await c.query('DELETE FROM production_cost_components WHERE production_order_id=$1',[req.params.id]);
        for(const x of components)await c.query('INSERT INTO production_cost_components(production_order_id,component_code,description,amount,created_by) VALUES($1,$2,$3,$4,$5)',[req.params.id,x.componentCode,x.description.trim(),x.amount,req.authUser.user_id]);
        const sums=await c.query('SELECT COALESCE(SUM(amount),0) extras FROM production_cost_components WHERE production_order_id=$1',[req.params.id]);
        const extraTotal=Number(sums.rows[0].extras);
        if(extraTotal>0){
          const period=await c.query('SELECT status FROM accounting_periods WHERE CURRENT_DATE BETWEEN start_date AND end_date FOR UPDATE');
          if(period.rowCount&&period.rows[0].status!=='OPEN')throw Object.assign(new Error('الفترة المحاسبية مغلقة أو مقفلة'),{code:'P0001'});
          const mapping={LABOR:'5100',ENERGY:'5200',OVERHEAD:'5300',PACKAGING:'5410',WASTE:'5300'};
          const requiredCodes=['1200',...new Set(components.filter(x=>Number(x.amount)>0).map(x=>mapping[x.componentCode]))];
          const found=await c.query('SELECT id,code FROM gl_accounts WHERE code=ANY($1::text[]) AND is_active=TRUE',[requiredCodes]);
          const ids=Object.fromEntries(found.rows.map(x=>[x.code,x.id]));
          for(const accountCode of requiredCodes)if(!ids[accountCode])throw Object.assign(new Error('الحساب المالي غير معرف: '+accountCode),{code:'P0001'});
          const entry=await c.query(`INSERT INTO journal_entries(entry_no,entry_date,source_type,source_id,description,total_debit,total_credit,created_by)
            VALUES($1,CURRENT_DATE,'PRODUCTION_COST',$2,$3,$4,$4,$5) RETURNING id`,
            ['PC-'+req.params.id,req.params.id,'رسملة تكاليف الإنتاج الإضافية لأمر '+req.params.id,extraTotal,req.authUser.user_id]);
          await c.query('INSERT INTO journal_lines(journal_entry_id,account_id,debit,credit,description) VALUES($1,$2,$3,0,$4)',
            [entry.rows[0].id,ids['1200'],extraTotal,'إضافة تكاليف التحويل إلى مخزون المنتج النهائي']);
          for(const x of components.filter(x=>Number(x.amount)>0)){
            await c.query('INSERT INTO journal_lines(journal_entry_id,account_id,debit,credit,description) VALUES($1,$2,0,$3,$4)',
              [entry.rows[0].id,ids[mapping[x.componentCode]],x.amount,x.description.trim()]);
          }
        }
        const oldTotal=Number(h.rows[0].total_cost),newTotal=Number(h.rows[0].total_material_cost)+extraTotal,qty=Number(h.rows[0].quantity),balanceQty=Number(h.rows[0].balance_qty),unit=newTotal/qty;
        await c.query('UPDATE production_outputs SET total_cost=$1,unit_cost=$2 WHERE production_order_id=$3',[newTotal,unit,req.params.id]);
        await c.query('UPDATE inventory_balances SET average_unit_cost=average_unit_cost+(($1::numeric-$2::numeric)/$3::numeric),updated_at=NOW() WHERE warehouse_id=$4 AND item_id=$5 AND lot_no=$6',
          [newTotal,oldTotal,balanceQty,h.rows[0].warehouse_id,h.rows[0].item_id,h.rows[0].lot_no]);
        await c.query('UPDATE stock_movements SET unit_cost=$1 WHERE reference_type=$2 AND reference_id=$3 AND movement_type=$4',[unit,'PRODUCTION_ORDER',req.params.id,'PRODUCTION_OUTPUT']);
        const updated=await c.query('UPDATE production_orders SET unit_production_cost=$1 WHERE id=$2 RETURNING id,actual_qty,total_material_cost,unit_production_cost',[unit,req.params.id]);
        return {...updated.rows[0],totalProductionCost:newTotal,additionalCost:Number(sums.rows[0].extras)};
      });
      return result;
    }catch(e){return failure(reply,e);}
  });

  app.post('/api/v1/production/orders/:id/quality', auth(app,'QUALITY.FINISHED_APPROVE'), async(req,reply)=>{
    const b=req.body??{};
    if(!['PASS','FAIL','CONDITIONAL'].includes(b.result))return invalid(reply);
    try{
      const result=await transaction(db,async c=>{
        const h=await c.query('SELECT p.id,p.status,p.warehouse_id,o.item_id,o.lot_no,o.quantity,b.quality_status FROM production_orders p JOIN production_outputs o ON o.production_order_id=p.id JOIN inventory_balances b ON b.warehouse_id=p.warehouse_id AND b.item_id=o.item_id AND b.lot_no=o.lot_no WHERE p.id=$1 FOR UPDATE OF p,b',[req.params.id]);
        if(!h.rowCount||h.rows[0].status!=='COMPLETED'||!['PENDING_QC','QUARANTINED'].includes(h.rows[0].quality_status))throw Object.assign(new Error('المنتج غير متاح للفحص أو تم فحصه مسبقاً'),{code:'P0001'});
        await c.query('INSERT INTO finished_goods_inspections(production_order_id,inspected_by,result,parameters,notes) VALUES($1,$2,$3,$4::jsonb,$5) ON CONFLICT(production_order_id) DO UPDATE SET inspected_by=EXCLUDED.inspected_by,inspected_at=NOW(),result=EXCLUDED.result,parameters=EXCLUDED.parameters,notes=EXCLUDED.notes',
          [req.params.id,req.authUser.user_id,b.result,JSON.stringify(b.parameters??{}),b.notes??null]);
        const status=b.result==='PASS'?'RELEASED':b.result==='FAIL'?'QUARANTINED':'PENDING_QC';
        await c.query('UPDATE inventory_balances SET quality_status=$1,updated_at=NOW() WHERE warehouse_id=$2 AND item_id=$3 AND lot_no=$4',
          [status,h.rows[0].warehouse_id,h.rows[0].item_id,h.rows[0].lot_no]);
        return {productionOrderId:req.params.id,result:b.result,inventoryStatus:status,availableForSale:status==='RELEASED'};
      });
      return result;
    }catch(e){return failure(reply,e);}
  });

}
