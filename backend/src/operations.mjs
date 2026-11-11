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

  app.get('/api/v1/production/orders', auth(app,'PRODUCTION.READ'), async(_req,reply)=>{
    try{return (await db.query(`SELECT p.*,fp.code product_code,fp.name_ar product_name,
      f.version_no formulation_version,w.name_ar warehouse_name
      FROM production_orders p JOIN feed_products fp ON fp.id=p.feed_product_id
      JOIN formulations f ON f.id=p.formulation_id JOIN warehouses w ON w.id=p.warehouse_id
      ORDER BY p.created_at DESC`)).rows;}
    catch(e){return failure(reply,e);}
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
        let totalCost=0;
        for(const l of lines.rows){
          let required=Number(b.actualQty)*Number(l.percentage)/100;
          const lots=await c.query(`SELECT lot_no,quantity,average_unit_cost FROM inventory_balances
            WHERE warehouse_id=$1 AND item_id=$2 AND quantity>0 AND quality_status='RELEASED'
            ORDER BY expiry_date ASC NULLS LAST,lot_no ASC FOR UPDATE`,[order.warehouse_id,l.item_id]);
          const available=lots.rows.reduce((sum,lot)=>sum+Number(lot.quantity),0);
          if(available+0.000001<required)throw Object.assign(new Error('رصيد المخزون غير كافٍ لأحد مكونات التركيبة'),{code:'P0001'});
          for(const lot of lots.rows){
            if(required<=0.000001)break;
            const used=Math.min(required,Number(lot.quantity)),avg=Number(lot.average_unit_cost),cost=used*avg;
            await c.query(`UPDATE inventory_balances SET quantity=quantity-$1,updated_at=NOW()
              WHERE warehouse_id=$2 AND item_id=$3 AND lot_no=$4`,[used,order.warehouse_id,l.item_id,lot.lot_no]);
            await c.query(`INSERT INTO production_consumptions(production_order_id,item_id,lot_no,quantity,average_unit_cost,extended_cost)
              VALUES($1,$2,$3,$4,$5,$6)`,[order.id,l.item_id,lot.lot_no,used,avg,cost]);
            await c.query(`INSERT INTO stock_movements(movement_no,warehouse_id,item_id,lot_no,movement_type,quantity_out,unit_cost,reference_type,reference_id,created_by)
              VALUES($1,$2,$3,$4,'PRODUCTION_ISSUE',$5,$6,'PRODUCTION_ORDER',$7,$8)`,
              [`PI-${order.id.slice(0,8)}-${l.item_id.slice(0,8)}-${String(lot.lot_no||'NOLOT').slice(0,20)}`,order.warehouse_id,l.item_id,lot.lot_no,used,avg,order.id,req.authUser.user_id]);
            totalCost+=cost;
            required-=used;
          }
        }
        const unitCost=totalCost/Number(b.actualQty);
        await c.query(`INSERT INTO inventory_balances(warehouse_id,item_id,lot_no,quantity,average_unit_cost,quality_status)
          VALUES($1,$2,$3,$4,$5,'PENDING_QC') ON CONFLICT(warehouse_id,item_id,lot_no) DO UPDATE SET
          average_unit_cost=((inventory_balances.quantity*inventory_balances.average_unit_cost)+($4*$5))/(inventory_balances.quantity+$4),
          quantity=inventory_balances.quantity+$4,quality_status='PENDING_QC',updated_at=NOW()`,
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
        await c.query('DELETE FROM production_cost_components WHERE production_order_id=$1',[req.params.id]);
        for(const x of components)await c.query('INSERT INTO production_cost_components(production_order_id,component_code,description,amount,created_by) VALUES($1,$2,$3,$4,$5)',[req.params.id,x.componentCode,x.description.trim(),x.amount,req.authUser.user_id]);
        const sums=await c.query('SELECT COALESCE(SUM(amount),0) extras FROM production_cost_components WHERE production_order_id=$1',[req.params.id]);
        const oldTotal=Number(h.rows[0].total_cost),newTotal=Number(h.rows[0].total_material_cost)+Number(sums.rows[0].extras),qty=Number(h.rows[0].quantity),balanceQty=Number(h.rows[0].balance_qty),unit=newTotal/qty;
        await c.query('UPDATE production_outputs SET total_cost=$1,unit_cost=$2 WHERE production_order_id=$3',[newTotal,unit,req.params.id]);
        await c.query('UPDATE inventory_balances SET average_unit_cost=average_unit_cost+(($1-$2)/$3),updated_at=NOW() WHERE warehouse_id=$4 AND item_id=$5 AND lot_no=$6',
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
        if(!h.rowCount||h.rows[0].status!=='COMPLETED'||h.rows[0].quality_status!=='PENDING_QC')throw Object.assign(new Error('المنتج غير متاح للفحص أو تم فحصه مسبقاً'),{code:'P0001'});
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
