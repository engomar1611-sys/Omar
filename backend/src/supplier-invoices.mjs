const auth=(app,p)=>({preHandler:[app.authenticate,app.requirePermission(p)]});
const invalid=(reply,error='VALIDATION_ERROR')=>reply.code(400).send({error});
const conflict=(reply,error='BUSINESS_RULE')=>reply.code(409).send({error});
const textOk=(v,n=60)=>typeof v==='string'&&v.trim().length>0&&v.trim().length<=n;
const positive=v=>Number.isFinite(Number(v))&&Number(v)>0;
const validDate=v=>{
 const text=String(v);
 if(!/^\d{4}-\d{2}-\d{2}$/.test(text))return false;
 const date=new Date(text+'T00:00:00.000Z');
 return Number.isFinite(date.getTime())&&date.toISOString().slice(0,10)===text;
};
async function tx(db,fn){
 const c=await db.connect();
 try{await c.query('BEGIN');const out=await fn(c);await c.query('COMMIT');return out;}
 catch(e){await c.query('ROLLBACK');throw e;}
 finally{c.release();}
}
const fail=(reply,e)=>{
 if(e.code==='23505')return conflict(reply,'DUPLICATE_SUPPLIER_INVOICE');
 if(e.code==='23503')return conflict(reply,'INVALID_REFERENCE');
 if(['23514','22P02','22007'].includes(e.code))return invalid(reply,'INVALID_DATA');
 if(e.code==='P0001')return conflict(reply,e.message);
 throw e;
};

export async function supplierInvoiceRoutes(app,{db}){
 app.get('/api/v1/supplier-invoices',auth(app,'SUPPLIER_INVOICES.READ'),async(req,reply)=>{
  try{
   const result=await db.query(`
    SELECT si.*,s.code supplier_code,s.name_ar supplier_name,po.order_no,
      COALESCE(json_agg(json_build_object(
       'id',l.id,'receiptLineId',l.goods_receipt_line_id,'purchaseOrderLineId',l.purchase_order_line_id,
       'itemId',l.item_id,'itemCode',i.code,'itemName',i.name_ar,'quantity',l.invoiced_qty,
       'unitCost',l.unit_cost,'lineTotal',l.line_total
      )) FILTER(WHERE l.id IS NOT NULL),'[]'::json) lines
    FROM supplier_invoices si JOIN suppliers s ON s.id=si.supplier_id
    JOIN purchase_orders po ON po.id=si.purchase_order_id
    LEFT JOIN supplier_invoice_lines l ON l.supplier_invoice_id=si.id
    LEFT JOIN items i ON i.id=l.item_id
    GROUP BY si.id,s.code,s.name_ar,po.order_no
    ORDER BY si.invoice_date DESC,si.supplier_invoice_no DESC
   `);
   return result.rows;
  }catch(e){return fail(reply,e);}
 });

 app.post('/api/v1/supplier-invoices',auth(app,'SUPPLIER_INVOICES.MANAGE'),async(req,reply)=>{
  const b=req.body??{};
  if(!textOk(b.supplierInvoiceNo)||!b.supplierId||!b.purchaseOrderId||
    !validDate(b.invoiceDate)||!validDate(b.dueDate)||b.dueDate<b.invoiceDate||
    !Array.isArray(b.lines)||!b.lines.length||
    b.lines.some(l=>!l||!l.receiptLineId||!positive(l.quantity)||
      (l.unitCost!=null&&(!Number.isFinite(Number(l.unitCost))||Number(l.unitCost)<0))))return invalid(reply);
  const ids=b.lines.map(l=>l.receiptLineId);
  if(new Set(ids).size!==ids.length)return invalid(reply,'DUPLICATE_RECEIPT_LINE');
  try{
   const result=await tx(db,async c=>{
    const po=await c.query('SELECT * FROM purchase_orders WHERE id=$1 AND supplier_id=$2 FOR UPDATE',[b.purchaseOrderId,b.supplierId]);
    if(!po.rowCount||!['APPROVED','PARTIALLY_RECEIVED','RECEIVED'].includes(po.rows[0].status))
      return {conflict:'PURCHASE_ORDER_SUPPLIER_OR_STATUS_INVALID'};
    const header=await c.query(`
      INSERT INTO supplier_invoices(supplier_invoice_no,supplier_id,purchase_order_id,invoice_date,due_date,notes,created_by)
      VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *
    `,[b.supplierInvoiceNo.trim(),b.supplierId,b.purchaseOrderId,b.invoiceDate,b.dueDate,b.notes??null,req.authUser.user_id]);
    let subtotal=0;
    for(const line of b.lines){
      const receipt=await c.query(`
       SELECT grl.*,gr.status receipt_status,gr.purchase_order_id,pol.unit_cost po_unit_cost,
         pol.item_id po_item_id,po.supplier_id
       FROM goods_receipt_lines grl
       JOIN goods_receipts gr ON gr.id=grl.goods_receipt_id
       JOIN purchase_orders po ON po.id=gr.purchase_order_id
       JOIN purchase_order_lines pol ON pol.id=grl.purchase_order_line_id
       WHERE grl.id=$1 AND gr.purchase_order_id=$2
       FOR UPDATE OF grl,gr,pol
      `,[line.receiptLineId,b.purchaseOrderId]);
      if(!receipt.rowCount)throw Object.assign(new Error('سطر الاستلام لا يتبع أمر الشراء المحدد'),{code:'P0001'});
      const source=receipt.rows[0];
      if(!['ACCEPTED','PARTIAL'].includes(source.receipt_status)||Number(source.accepted_qty)<=0)
        throw Object.assign(new Error('لا يمكن مطابقة فاتورة على استلام لم يجتز فحص الجودة'),{code:'P0001'});
      if(source.item_id!==source.po_item_id)
        throw Object.assign(new Error('الصنف في الاستلام لا يطابق أمر الشراء'),{code:'P0001'});
      const already=await c.query(`
       SELECT COALESCE(SUM(l.invoiced_qty),0) invoiced_qty
       FROM supplier_invoice_lines l JOIN supplier_invoices h ON h.id=l.supplier_invoice_id
       WHERE l.goods_receipt_line_id=$1 AND h.status IN ('DRAFT','PENDING_APPROVAL','REGISTERED')
      `,[line.receiptLineId]);
      const remaining=Number(source.accepted_qty)-Number(already.rows[0].invoiced_qty);
      if(Number(line.quantity)>remaining+0.000001)
        throw Object.assign(new Error('كمية الفاتورة تتجاوز الكمية المقبولة المتبقية في إذن الاستلام'),{code:'P0001'});
      const unitCost=line.unitCost==null?Number(source.po_unit_cost):Number(line.unitCost);
      if(Math.abs(unitCost-Number(source.po_unit_cost))>0.0001)
        throw Object.assign(new Error('سعر فاتورة المورد يختلف عن السعر المعتمد بأمر الشراء؛ يلزم اعتماد فرق السعر قبل التسجيل'),{code:'P0001'});
      const lineTotal=Number(line.quantity)*unitCost;
      await c.query(`
       INSERT INTO supplier_invoice_lines(supplier_invoice_id,goods_receipt_line_id,purchase_order_line_id,item_id,invoiced_qty,unit_cost,line_total)
       VALUES($1,$2,$3,$4,$5,$6,$7)
      `,[header.rows[0].id,source.id,source.purchase_order_line_id,source.item_id,line.quantity,unitCost,lineTotal]);
      subtotal+=lineTotal;
    }
    const updated=await c.query('UPDATE supplier_invoices SET subtotal=$1,total_amount=$1 WHERE id=$2 RETURNING *',[subtotal,header.rows[0].id]);
    return {invoice:updated.rows[0],lineCount:b.lines.length,matchedAmount:subtotal};
   });
   if(result.conflict)return conflict(reply,result.conflict);
   return reply.code(201).send(result);
  }catch(e){return fail(reply,e);}
 });

 app.post('/api/v1/supplier-invoices/:id/submit',auth(app,'SUPPLIER_INVOICES.MANAGE'),async(req,reply)=>{
  try{
   const result=await db.query(`
    UPDATE supplier_invoices si SET status='PENDING_APPROVAL'
    WHERE si.id=$1 AND si.status='DRAFT'
      AND EXISTS(SELECT 1 FROM supplier_invoice_lines l WHERE l.supplier_invoice_id=si.id)
    RETURNING *
   `,[req.params.id]);
   if(!result.rowCount)return conflict(reply,'INVALID_STATUS_OR_EMPTY_INVOICE');
   return result.rows[0];
  }catch(e){return fail(reply,e);}
 });

 app.post('/api/v1/supplier-invoices/:id/register',auth(app,'SUPPLIER_INVOICES.APPROVE'),async(req,reply)=>{
  try{
   const result=await tx(db,async c=>{
    const invoice=await c.query('SELECT * FROM supplier_invoices WHERE id=$1 FOR UPDATE',[req.params.id]);
    if(!invoice.rowCount||invoice.rows[0].status!=='PENDING_APPROVAL')
      return {conflict:'INVOICE_NOT_PENDING_APPROVAL'};
    const lines=await c.query('SELECT COUNT(*)::int count,COALESCE(SUM(line_total),0) total FROM supplier_invoice_lines WHERE supplier_invoice_id=$1',[req.params.id]);
    if(!lines.rows[0].count||Math.abs(Number(lines.rows[0].total)-Number(invoice.rows[0].total_amount))>0.0001)
      return {conflict:'INVOICE_TOTAL_MISMATCH'};
    const updated=await c.query(`
      UPDATE supplier_invoices SET status='REGISTERED',registered_by=$1,registered_at=NOW()
      WHERE id=$2 RETURNING *
    `,[req.authUser.user_id,req.params.id]);
    // Goods receipt has already posted Dr Inventory / Cr Accounts Payable.
    // Registering the supplier's invoice matches the liability document and due date;
    // it deliberately does not post AP a second time.
    return {invoice:updated.rows[0],accountingEntryCreated:false,matchedTotal:Number(lines.rows[0].total)};
   });
   if(result.conflict)return conflict(reply,result.conflict);
   return result;
  }catch(e){return fail(reply,e);}
 });

 app.post('/api/v1/supplier-invoices/:id/cancel',auth(app,'SUPPLIER_INVOICES.MANAGE'),async(req,reply)=>{
  try{
   const result=await db.query("UPDATE supplier_invoices SET status='CANCELLED' WHERE id=$1 AND status='DRAFT' RETURNING *",[req.params.id]);
   if(!result.rowCount)return conflict(reply,'ONLY_DRAFT_INVOICES_CAN_BE_CANCELLED');
   return result.rows[0];
  }catch(e){return fail(reply,e);}
 });

 app.post('/api/v1/supplier-invoices/:id/reject',auth(app,'SUPPLIER_INVOICES.APPROVE'),async(req,reply)=>{
  try{
   const result=await db.query(`
    UPDATE supplier_invoices SET status='REJECTED'
    WHERE id=$1 AND status='PENDING_APPROVAL' RETURNING *
   `,[req.params.id]);
   if(!result.rowCount)return conflict(reply,'INVALID_STATUS');
   return result.rows[0];
  }catch(e){return fail(reply,e);}
 });

 app.get('/api/v1/supplier-invoices/:id/match',auth(app,'SUPPLIER_INVOICES.READ'),async(req,reply)=>{
  try{
   const result=await db.query(`
    SELECT l.id receipt_line_id,l.item_id,i.code item_code,i.name_ar item_name,
      l.received_qty,l.accepted_qty,l.rejected_qty,l.unit_cost,
      COALESCE((SELECT SUM(x.invoiced_qty) FROM supplier_invoice_lines x
        JOIN supplier_invoices h ON h.id=x.supplier_invoice_id
        WHERE x.goods_receipt_line_id=l.id AND h.status IN ('DRAFT','PENDING_APPROVAL','REGISTERED')),0) invoiced_qty,
      l.accepted_qty-COALESCE((SELECT SUM(x.invoiced_qty) FROM supplier_invoice_lines x
        JOIN supplier_invoices h ON h.id=x.supplier_invoice_id
        WHERE x.goods_receipt_line_id=l.id AND h.status IN ('DRAFT','PENDING_APPROVAL','REGISTERED')),0) remaining_qty
    FROM goods_receipt_lines l JOIN goods_receipts g ON g.id=l.goods_receipt_id
    JOIN items i ON i.id=l.item_id
    WHERE g.purchase_order_id=$1 AND g.status IN ('ACCEPTED','PARTIAL')
    ORDER BY g.received_at,l.id
   `,[req.params.id]);
   return result.rows;
  }catch(e){return fail(reply,e);}
 });

 app.get('/api/v1/reports/supplier-invoice-due-schedule',auth(app,'REPORTS.READ'),async(_req,reply)=>{
  try{
   return (await db.query(`
    SELECT s.id supplier_id,s.code supplier_code,s.name_ar supplier_name,
      i.supplier_invoice_no,i.invoice_date,i.due_date,i.total_amount,
      CASE WHEN i.due_date<CURRENT_DATE THEN i.total_amount ELSE 0 END overdue_amount,
      CASE WHEN i.due_date>=CURRENT_DATE THEN i.total_amount ELSE 0 END not_due_amount
    FROM supplier_invoices i JOIN suppliers s ON s.id=i.supplier_id
    WHERE i.status='REGISTERED'
    ORDER BY i.due_date,s.code,i.supplier_invoice_no
   `)).rows;
  }catch(e){return fail(reply,e);}
 });
}
