const auth=(app,p)=>({preHandler:[app.authenticate,app.requirePermission(p)]});
const bad=(reply,message='البيانات غير صحيحة')=>reply.code(400).send({error:'VALIDATION_ERROR',message});
const fail=(reply,e)=>{
 if(e.code==='23505')return reply.code(409).send({error:'DUPLICATE'});
 if(e.code==='23503')return reply.code(409).send({error:'REFERENCED'});
 if(['23514','22P02'].includes(e.code))return reply.code(400).send({error:'INVALID_DATA'});
 if(e.code==='P0001')return reply.code(409).send({error:'BUSINESS_RULE',message:e.message});
 throw e;
};
async function tx(db,fn){const c=await db.connect();try{await c.query('BEGIN');const v=await fn(c);await c.query('COMMIT');return v;}catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();}}
const txt=(v,n)=>typeof v==='string'&&v.trim().length>0&&v.trim().length<=n;
const pos=v=>Number.isFinite(Number(v))&&Number(v)>0;
async function account(c,code){const r=await c.query('SELECT id FROM gl_accounts WHERE code=$1 AND is_active=TRUE',[code]);if(!r.rowCount)throw Object.assign(new Error('الحساب المالي غير معرف: '+code),{code:'P0001'});return r.rows[0].id;}
async function journal(c,{no,date,sourceType,sourceId,description,actor,lines}){
 const period=await c.query(`SELECT status FROM accounting_periods WHERE $1::date BETWEEN start_date AND end_date FOR UPDATE`,[date??new Date().toISOString().slice(0,10)]);
 if(period.rowCount&&period.rows[0].status!=='OPEN')throw Object.assign(new Error('الفترة المحاسبية مغلقة أو مقفلة'),{code:'P0001'});
 const debit=lines.reduce((s,x)=>s+Number(x.debit||0),0),credit=lines.reduce((s,x)=>s+Number(x.credit||0),0);
 if(Math.abs(debit-credit)>0.00001)throw Object.assign(new Error('القيد المحاسبي غير متوازن'),{code:'P0001'});
 const h=await c.query(`INSERT INTO journal_entries(entry_no,entry_date,source_type,source_id,description,total_debit,total_credit,created_by)
 VALUES($1,COALESCE($2::date,CURRENT_DATE),$3,$4,$5,$6,$7,$8) RETURNING id`,
 [no,date??null,sourceType,sourceId,description,debit,credit,actor]);
 for(const l of lines)await c.query('INSERT INTO journal_lines(journal_entry_id,account_id,debit,credit,description) VALUES($1,$2,$3,$4,$5)',
 [h.rows[0].id,l.account,Number(l.debit||0),Number(l.credit||0),l.description??null]);
 return h.rows[0].id;
}

async function reverseJournal(c,{sourceType,sourceId,reversalType,reversalNo,actor,reason}){
 const period=await c.query('SELECT status FROM accounting_periods WHERE CURRENT_DATE BETWEEN start_date AND end_date FOR UPDATE');
 if(period.rowCount&&period.rows[0].status!=='OPEN')throw Object.assign(new Error('لا يمكن عكس مستند في فترة محاسبية مغلقة'),{code:'P0001'});
 const original=await c.query("SELECT * FROM journal_entries WHERE source_type=$1 AND source_id=$2 AND status='POSTED' FOR UPDATE",[sourceType,sourceId]);
 if(!original.rowCount)throw Object.assign(new Error('القيد الأصلي غير موجود أو سبق عكسه'),{code:'P0001'});
 const lines=await c.query('SELECT account_id,debit,credit,description FROM journal_lines WHERE journal_entry_id=$1',[original.rows[0].id]);
 const reversal=await c.query(`INSERT INTO journal_entries(entry_no,source_type,source_id,description,total_debit,total_credit,created_by)
  VALUES($1,$2,$3,$4,$5,$5,$6) RETURNING id`,
  [reversalNo,reversalType,sourceId,'عكس: '+(reason||original.rows[0].description||sourceType),Number(original.rows[0].total_debit),actor]);
 for(const l of lines.rows)await c.query('INSERT INTO journal_lines(journal_entry_id,account_id,debit,credit,description) VALUES($1,$2,$3,$4,$5)',
  [reversal.rows[0].id,l.account_id,l.credit,l.debit,'عكس القيد الأصلي']);
 await c.query("UPDATE journal_entries SET status='REVERSED' WHERE id=$1",[original.rows[0].id]);
 await c.query('INSERT INTO document_reversals(source_type,source_id,reversal_entry_id,reason,reversed_by) VALUES($1,$2,$3,$4,$5)',
  [sourceType,sourceId,reversal.rows[0].id,reason,actor]);
 return reversal.rows[0].id;
}

export async function commercialRoutes(app,{db}){
 app.get('/api/v1/customers',auth(app,'CUSTOMERS.READ'),async(_q,rep)=>{try{return (await db.query('SELECT * FROM customers ORDER BY code')).rows;}catch(e){return fail(rep,e);}});
 app.post('/api/v1/customers',auth(app,'CUSTOMERS.MANAGE'),async(req,rep)=>{
  const b=req.body??{};if(!txt(b.code,40)||!txt(b.nameAr,200)|| (b.creditLimit!==undefined&&(!Number.isFinite(Number(b.creditLimit))||Number(b.creditLimit)<0)))return bad(rep);
  try{const r=await db.query('INSERT INTO customers(code,name_ar,phone,address,credit_limit) VALUES($1,$2,$3,$4,$5) RETURNING *',[b.code.trim(),b.nameAr.trim(),b.phone??null,b.address??null,b.creditLimit??0]);return rep.code(201).send(r.rows[0]);}catch(e){return fail(rep,e);}
 });
 app.get('/api/v1/sales/invoices',auth(app,'SALES.READ'),async(_q,rep)=>{
  try{return (await db.query(`SELECT i.*,c.code customer_code,c.name_ar customer_name,
   COALESCE(json_agg(json_build_object('id',l.id,'itemId',l.item_id,'itemCode',m.code,'itemName',m.name_ar,'lotNo',l.lot_no,'quantity',l.quantity,'unitPrice',l.unit_price,'unitCost',l.unit_cost,'lineTotal',l.line_total)) FILTER(WHERE l.id IS NOT NULL),'[]'::json) lines
   FROM sales_invoices i JOIN customers c ON c.id=i.customer_id
   LEFT JOIN sales_invoice_lines l ON l.sales_invoice_id=i.id LEFT JOIN items m ON m.id=l.item_id
   GROUP BY i.id,c.code,c.name_ar ORDER BY i.invoice_date DESC,i.invoice_no DESC`)).rows;}catch(e){return fail(rep,e);}
 });
 app.post('/api/v1/sales/invoices',auth(app,'SALES.MANAGE'),async(req,rep)=>{
  const b=req.body??{};if(!txt(b.invoiceNo,40)||!b.customerId||!b.warehouseId||!Array.isArray(b.lines)||!b.lines.length||
   b.lines.some(l=>!l.itemId||!pos(l.quantity)||!Number.isFinite(Number(l.unitPrice))||Number(l.unitPrice)<0)||(b.dueDate&&!/^\\d{4}-\\d{2}-\\d{2}$/.test(String(b.dueDate))))return bad(rep);
  const discount=Number(b.discountAmount??0);if(!Number.isFinite(discount)||discount<0)return bad(rep);
  try{
   const out=await tx(db,async c=>{
    const cust=await c.query('SELECT id,credit_limit FROM customers WHERE id=$1 AND is_active=TRUE FOR UPDATE',[b.customerId]);
    if(!cust.rowCount)throw Object.assign(new Error('العميل غير موجود أو غير نشط'),{code:'P0001'});
    const h=await c.query(`INSERT INTO sales_invoices(invoice_no,customer_id,warehouse_id,invoice_date,subtotal,discount_amount,total_amount,created_by)
     VALUES($1,$2,$3,COALESCE($4::date,CURRENT_DATE),$5,$5,0,$6) RETURNING *`,[b.invoiceNo.trim(),b.customerId,b.warehouseId,b.invoiceDate??null,discount,req.authUser.user_id]);
    let subtotal=0,costTotal=0;
    for(let i=0;i<b.lines.length;i++){
     const l=b.lines[i];let remaining=Number(l.quantity),lineCost=0,weightedQty=0,chosenLot=l.lotNo??'';
     const lots=await c.query(`SELECT lot_no,quantity,average_unit_cost FROM inventory_balances
       WHERE warehouse_id=$1 AND item_id=$2 AND quantity>0 AND quality_status='RELEASED' AND ($3='' OR lot_no=$3)
       ORDER BY expiry_date ASC NULLS LAST,lot_no FOR UPDATE`,[b.warehouseId,l.itemId,chosenLot]);
     const avail=lots.rows.reduce((s,x)=>s+Number(x.quantity),0);
     if(avail+0.000001<remaining)throw Object.assign(new Error('رصيد غير كافٍ للصنف '+l.itemId),{code:'P0001'});
     const price=Number(l.unitPrice);
     let lineNo=0;
     for(const lot of lots.rows){
      if(remaining<=0.000001)break;
      const q=Math.min(remaining,Number(lot.quantity)),cost=Number(lot.average_unit_cost);
      await c.query('UPDATE inventory_balances SET quantity=quantity-$1,updated_at=NOW() WHERE warehouse_id=$2 AND item_id=$3 AND lot_no=$4',[q,b.warehouseId,l.itemId,lot.lot_no]);
      await c.query(`INSERT INTO stock_movements(movement_no,warehouse_id,item_id,lot_no,movement_type,quantity_out,unit_cost,reference_type,reference_id,created_by)
       VALUES($1,$2,$3,$4,'ADJUSTMENT_OUT',$5,$6,'SALES_INVOICE',$7,$8)`,
       [`SI-${h.rows[0].id.slice(0,8)}-${i+1}-${++lineNo}`,b.warehouseId,l.itemId,lot.lot_no,q,cost,h.rows[0].id,req.authUser.user_id]);
      const lineCost=q*cost,lineTotal=q*price;
      subtotal+=lineTotal;costTotal+=lineCost;
      await c.query(`INSERT INTO sales_invoice_lines(sales_invoice_id,item_id,lot_no,quantity,unit_price,unit_cost,line_total,cost_total)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8)`,[h.rows[0].id,l.itemId,lot.lot_no,q,price,cost,lineTotal,lineCost]);
      remaining-=q;
     }

    }
    if(discount>subtotal)throw Object.assign(new Error('الخصم أكبر من إجمالي الفاتورة'),{code:'P0001'});
    const total=subtotal-discount;
    const outstanding=await c.query(`SELECT COALESCE(SUM(total_amount),0)-COALESCE((SELECT SUM(a.amount) FROM receipt_allocations a JOIN sales_invoices x ON x.id=a.sales_invoice_id WHERE x.customer_id=$1),0) due FROM sales_invoices WHERE customer_id=$1 AND status IN ('POSTED','PARTIALLY_PAID','PAID')`,[b.customerId]);
    if(Number(cust.rows[0].credit_limit)>0&&Number(outstanding.rows[0].due)+total>Number(cust.rows[0].credit_limit))throw Object.assign(new Error('تجاوز الحد الائتماني للعميل'),{code:'P0001'});
    await c.query(`UPDATE sales_invoices SET subtotal=$1,total_amount=$2,cost_amount=$3,status='POSTED',posted_at=NOW() WHERE id=$4`,[subtotal,total,costTotal,h.rows[0].id]);
    const ar=await account(c,'1100'),sales=await account(c,'4000'),cogs=await account(c,'5000'),inventory=await account(c,'1200');
    const lines=[];if(total>0)lines.push({account:ar,debit:total});if(total>0)lines.push({account:sales,credit:total});
    if(costTotal>0){lines.push({account:cogs,debit:costTotal});lines.push({account:inventory,credit:costTotal});}
    if(lines.length)await journal(c,{no:'J-SI-'+b.invoiceNo,date:b.invoiceDate,sourceType:'SALES_INVOICE',sourceId:h.rows[0].id,description:'ترحيل فاتورة مبيعات '+b.invoiceNo,actor:req.authUser.user_id,lines});
    return {id:h.rows[0].id,invoiceNo:b.invoiceNo,subtotal,totalAmount:total,costAmount:costTotal,status:'POSTED'};
   });
   return rep.code(201).send(out);
  }catch(e){return fail(rep,e);}
 });
 app.get('/api/v1/accounting/accounts',auth(app,'ACCOUNTING.READ'),async(_q,rep)=>{
  try{return (await db.query("SELECT id,code,name_ar,account_type FROM gl_accounts WHERE is_active=TRUE AND account_type='EXPENSE' ORDER BY code")).rows;}catch(e){return fail(rep,e);}
 });
 app.get('/api/v1/accounting/receipts',auth(app,'ACCOUNTING.READ'),async(_q,rep)=>{
  try{return (await db.query(`SELECT r.*,c.code customer_code,c.name_ar customer_name,
   COALESCE(json_agg(json_build_object('invoiceId',i.id,'invoiceNo',i.invoice_no,'amount',a.amount)) FILTER(WHERE a.id IS NOT NULL),'[]'::json) allocations
   FROM cash_receipts r JOIN customers c ON c.id=r.customer_id
   LEFT JOIN receipt_allocations a ON a.receipt_id=r.id LEFT JOIN sales_invoices i ON i.id=a.sales_invoice_id
   GROUP BY r.id,c.code,c.name_ar ORDER BY r.receipt_date DESC,r.receipt_no DESC`)).rows;}catch(e){return fail(rep,e);}
 });
 app.get('/api/v1/sales/returns',auth(app,'SALES.READ'),async(_q,rep)=>{
  try{return (await db.query(`SELECT r.*,i.invoice_no,c.name_ar customer_name,
   COALESCE(json_agg(json_build_object('id',l.id,'invoiceLineId',l.invoice_line_id,'itemId',l.item_id,'lotNo',l.lot_no,'quantity',l.quantity,'unitPrice',l.unit_price)) FILTER(WHERE l.id IS NOT NULL),'[]'::json) lines
   FROM sales_returns r JOIN sales_invoices i ON i.id=r.sales_invoice_id JOIN customers c ON c.id=i.customer_id
   LEFT JOIN sales_return_lines l ON l.sales_return_id=r.id
   GROUP BY r.id,i.invoice_no,c.name_ar ORDER BY r.created_at DESC`)).rows;}catch(e){return fail(rep,e);}
 });
 app.get('/api/v1/accounting/expenses',auth(app,'ACCOUNTING.READ'),async(_q,rep)=>{
  try{return (await db.query(`SELECT e.*,a.code account_code,a.name_ar account_name FROM expenses e JOIN gl_accounts a ON a.id=e.account_id ORDER BY e.expense_date DESC,e.expense_no DESC`)).rows;}catch(e){return fail(rep,e);}
 });
 app.post('/api/v1/accounting/receipts',auth(app,'RECEIPTS.MANAGE'),async(req,rep)=>{
  const b=req.body??{};if(!txt(b.receiptNo,40)||!b.customerId||!pos(b.amount)||!['CASH','BANK','TRANSFER','CHEQUE'].includes(b.paymentMethod)||!Array.isArray(b.allocations))return bad(rep);
  try{
   const out=await tx(db,async c=>{
    const h=await c.query(`INSERT INTO cash_receipts(receipt_no,customer_id,receipt_date,amount,payment_method,reference_no,created_by)
      VALUES($1,$2,COALESCE($3::date,CURRENT_DATE),$4,$5,$6,$7) RETURNING *`,[b.receiptNo,b.customerId,b.receiptDate??null,b.amount,b.paymentMethod,b.referenceNo??null,req.authUser.user_id]);
    let allocated=0;
    for(const a of b.allocations){
     if(!a.invoiceId||!pos(a.amount))throw Object.assign(new Error('توزيع التحصيل غير صحيح'),{code:'P0001'});
     const inv=await c.query(`SELECT id,total_amount,status,customer_id FROM sales_invoices WHERE id=$1 AND customer_id=$2 AND status IN ('POSTED','PARTIALLY_PAID','PAID') FOR UPDATE`,[a.invoiceId,b.customerId]);
     if(!inv.rowCount)throw Object.assign(new Error('الفاتورة غير تابعة للعميل أو غير مرحلة'),{code:'P0001'});
     const paid=await c.query('SELECT COALESCE(SUM(amount),0) amount FROM receipt_allocations WHERE sales_invoice_id=$1',[a.invoiceId]);
     if(Number(paid.rows[0].amount)+Number(a.amount)>Number(inv.rows[0].total_amount)+0.000001)throw Object.assign(new Error('مبلغ التخصيص يتجاوز المتبقي على الفاتورة'),{code:'P0001'});
     await c.query('INSERT INTO receipt_allocations(receipt_id,sales_invoice_id,amount) VALUES($1,$2,$3)',[h.rows[0].id,a.invoiceId,a.amount]);
     const newPaid=Number(paid.rows[0].amount)+Number(a.amount);
     await c.query(`UPDATE sales_invoices SET status=CASE WHEN $1>=total_amount THEN 'PAID' ELSE 'PARTIALLY_PAID' END WHERE id=$2`,[newPaid,a.invoiceId]);
     allocated+=Number(a.amount);
    }
    if(Math.abs(allocated-Number(b.amount))>0.000001)throw Object.assign(new Error('يجب توزيع كامل مبلغ سند القبض على فواتير العميل'),{code:'P0001'});
    const cash=await account(c,b.paymentMethod==='CASH'?'1000':'1010'),ar=await account(c,'1100');
    const journalLines=[{account:cash,debit:Number(b.amount)},{account:ar,credit:Number(b.amount)}];
    await journal(c,{no:'J-RC-'+b.receiptNo,date:b.receiptDate,sourceType:'CASH_RECEIPT',sourceId:h.rows[0].id,description:'سند قبض '+b.receiptNo,actor:req.authUser.user_id,lines:journalLines});
    return {receipt:h.rows[0],allocated,unallocated:Number(b.amount)-allocated};
   });
   return rep.code(201).send(out);
  }catch(e){return fail(rep,e);}
 });
 app.post('/api/v1/sales/returns',auth(app,'RETURNS.MANAGE'),async(req,rep)=>{
  const b=req.body??{};if(!txt(b.returnNo,40)||!b.invoiceId||!b.warehouseId||!Array.isArray(b.lines)||!b.lines.length||b.lines.some(x=>!x.invoiceLineId||!pos(x.quantity)))return bad(rep);
  try{
   const out=await tx(db,async c=>{
    const h=await c.query(`INSERT INTO sales_returns(return_no,sales_invoice_id,warehouse_id,reason,created_by)
      VALUES($1,$2,$3,$4,$5) RETURNING *`,[b.returnNo,b.invoiceId,b.warehouseId,b.reason??null,req.authUser.user_id]);
    for(const l of b.lines){
     const src=await c.query('SELECT id,item_id,lot_no,quantity,unit_price,unit_cost FROM sales_invoice_lines WHERE id=$1 AND sales_invoice_id=$2',[l.invoiceLineId,b.invoiceId]);
     if(!src.rowCount)throw Object.assign(new Error('بند الفاتورة غير موجود'),{code:'P0001'});
     const prior=await c.query(`SELECT COALESCE(SUM(rl.quantity),0) q FROM sales_return_lines rl JOIN sales_returns r ON r.id=rl.sales_return_id WHERE rl.invoice_line_id=$1 AND r.status<>'REJECTED'`,[l.invoiceLineId]);
     if(Number(prior.rows[0].q)+Number(l.quantity)>Number(src.rows[0].quantity))throw Object.assign(new Error('كمية المرتجع تتجاوز المبيع'),{code:'P0001'});
     await c.query(`INSERT INTO sales_return_lines(sales_return_id,invoice_line_id,item_id,lot_no,quantity,unit_price,unit_cost)
       VALUES($1,$2,$3,$4,$5,$6,$7)`,[h.rows[0].id,src.rows[0].id,src.rows[0].item_id,src.rows[0].lot_no,l.quantity,src.rows[0].unit_price,src.rows[0].unit_cost]);
    }
    return h.rows[0];
   });return rep.code(201).send(out);
  }catch(e){return fail(rep,e);}
 });
 app.post('/api/v1/sales/returns/:id/warehouse-approve',auth(app,'RETURNS.WAREHOUSE_APPROVE'),async(req,rep)=>{
  try{const r=await db.query(`UPDATE sales_returns SET status='PENDING_ACCOUNTING',warehouse_approved_by=$1,warehouse_approved_at=NOW()
   WHERE id=$2 AND status='PENDING_WAREHOUSE' RETURNING *`,[req.authUser.user_id,req.params.id]);
   if(!r.rowCount)return rep.code(409).send({error:'INVALID_STATUS'});return r.rows[0];}catch(e){return fail(rep,e);}
 });
 app.post('/api/v1/sales/returns/:id/accounting-approve',auth(app,'RETURNS.ACCOUNTING_APPROVE'),async(req,rep)=>{
  try{
   const out=await tx(db,async c=>{
    const h=await c.query('SELECT * FROM sales_returns WHERE id=$1 FOR UPDATE',[req.params.id]);
    if(!h.rowCount||h.rows[0].status!=='PENDING_ACCOUNTING')throw Object.assign(new Error('المرتجع لم يجتز اعتماد المخزن'),{code:'P0001'});
    const lines=await c.query('SELECT * FROM sales_return_lines WHERE sales_return_id=$1',[req.params.id]);
    let amount=0,cost=0;
    for(const l of lines.rows){
     amount+=Number(l.quantity)*Number(l.unit_price);cost+=Number(l.quantity)*Number(l.unit_cost);
     const bal=await c.query('SELECT quantity,average_unit_cost FROM inventory_balances WHERE warehouse_id=$1 AND item_id=$2 AND lot_no=$3 FOR UPDATE',[h.rows[0].warehouse_id,l.item_id,l.lot_no]);
     const old=bal.rowCount?Number(bal.rows[0].quantity):0,avg=bal.rowCount?Number(bal.rows[0].average_unit_cost):0,newQty=old+Number(l.quantity),newAvg=newQty?(old*avg+Number(l.quantity)*Number(l.unit_cost))/newQty:0;
     await c.query(`INSERT INTO inventory_balances(warehouse_id,item_id,lot_no,quantity,average_unit_cost,quality_status)
      VALUES($1,$2,$3,$4,$5,'PENDING_QC') ON CONFLICT(warehouse_id,item_id,lot_no) DO UPDATE SET quantity=EXCLUDED.quantity,average_unit_cost=EXCLUDED.average_unit_cost,quality_status='PENDING_QC',updated_at=NOW()`,[h.rows[0].warehouse_id,l.item_id,l.lot_no,newQty,newAvg]);
     await c.query(`INSERT INTO stock_movements(movement_no,warehouse_id,item_id,lot_no,movement_type,quantity_in,unit_cost,reference_type,reference_id,created_by)
      VALUES($1,$2,$3,$4,'ADJUSTMENT_IN',$5,$6,'SALES_RETURN',$7,$8)`,[`SR-${req.params.id.slice(0,12)}-${l.id.slice(0,8)}`,h.rows[0].warehouse_id,l.item_id,l.lot_no,l.quantity,l.unit_cost,req.params.id,req.authUser.user_id]);
    }
    const ar=await account(c,'1100'),sales=await account(c,'4000'),inventory=await account(c,'1200'),cogs=await account(c,'5000');
    const jl=[];if(amount){jl.push({account:sales,debit:amount});jl.push({account:ar,credit:amount});}if(cost){jl.push({account:inventory,debit:cost});jl.push({account:cogs,credit:cost});}
    if(jl.length)await journal(c,{no:'J-SR-'+h.rows[0].return_no,sourceType:'SALES_RETURN',sourceId:req.params.id,description:'مرتجع مبيعات '+h.rows[0].return_no,actor:req.authUser.user_id,lines:jl});
    await c.query(`UPDATE sales_returns SET status='APPROVED',accounting_approved_by=$1,accounting_approved_at=NOW() WHERE id=$2`,[req.authUser.user_id,req.params.id]);
    return {returnId:req.params.id,amount,cost,status:'APPROVED'};
   });return out;
  }catch(e){return fail(rep,e);}
 });
 app.post('/api/v1/quality/finished-goods/:productionOrderId/inspect',auth(app,'QUALITY.FINISHED_APPROVE'),async(req,rep)=>{
  const b=req.body??{};if(!['PASS','FAIL','CONDITIONAL'].includes(b.result))return bad(rep);
  try{
   const out=await tx(db,async c=>{
    const p=await c.query(`SELECT p.id,p.status,p.warehouse_id,o.item_id,o.lot_no FROM production_orders p
      JOIN production_outputs o ON o.production_order_id=p.id WHERE p.id=$1 FOR UPDATE`,[req.params.productionOrderId]);
    if(!p.rowCount||p.rows[0].status!=='COMPLETED')throw Object.assign(new Error('أمر الإنتاج غير مكتمل أو غير موجود'),{code:'P0001'});
    const q=await c.query(`INSERT INTO finished_goods_inspections(production_order_id,inspected_by,result,parameters,notes)
      VALUES($1,$2,$3,$4::jsonb,$5) RETURNING *`,[p.rows[0].id,req.authUser.user_id,b.result,JSON.stringify(b.parameters??{}),b.notes??null]);
    const status=b.result==='PASS'?'RELEASED':'QUARANTINED';
    await c.query('UPDATE inventory_balances SET quality_status=$1,updated_at=NOW() WHERE warehouse_id=$2 AND item_id=$3 AND lot_no=$4',
      [status,p.rows[0].warehouse_id,p.rows[0].item_id,p.rows[0].lot_no]);
    return {inspection:q.rows[0],inventoryStatus:status};
   });return rep.code(201).send(out);
  }catch(e){return fail(rep,e);}
 });
 app.get('/api/v1/accounting/supplier-payments',auth(app,'ACCOUNTING.READ'),async(_q,rep)=>{
  try{return (await db.query(`SELECT p.*,s.code supplier_code,s.name_ar supplier_name,
   COALESCE(json_agg(json_build_object('purchaseOrderId',po.id,'orderNo',po.order_no,'amount',a.amount)) FILTER(WHERE a.id IS NOT NULL),'[]'::json) allocations
   FROM supplier_payments p JOIN suppliers s ON s.id=p.supplier_id
   LEFT JOIN supplier_payment_allocations a ON a.supplier_payment_id=p.id LEFT JOIN purchase_orders po ON po.id=a.purchase_order_id
   GROUP BY p.id,s.code,s.name_ar ORDER BY p.payment_date DESC,p.payment_no DESC`)).rows;}catch(e){return fail(rep,e);}
 });
 app.get('/api/v1/purchases/returns',auth(app,'PURCHASES.READ'),async(_q,rep)=>{
  try{return (await db.query(`SELECT r.*,s.code supplier_code,s.name_ar supplier_name,w.code warehouse_code,
   COALESCE(json_agg(json_build_object('id',l.id,'itemId',l.item_id,'itemCode',i.code,'itemName',i.name_ar,'lotNo',l.lot_no,'quantity',l.quantity,'unitCost',l.unit_cost)) FILTER(WHERE l.id IS NOT NULL),'[]'::json) lines
   FROM purchase_returns r JOIN suppliers s ON s.id=r.supplier_id JOIN warehouses w ON w.id=r.warehouse_id
   LEFT JOIN purchase_return_lines l ON l.purchase_return_id=r.id LEFT JOIN items i ON i.id=l.item_id
   GROUP BY r.id,s.code,s.name_ar,w.code ORDER BY r.created_at DESC`)).rows;}catch(e){return fail(rep,e);}
 });
 app.get('/api/v1/accounting/periods',auth(app,'ACCOUNTING.READ'),async(_q,rep)=>{
  try{return (await db.query('SELECT * FROM accounting_periods ORDER BY start_date DESC')).rows;}catch(e){return fail(rep,e);}
 });
 app.post('/api/v1/accounting/supplier-payments',auth(app,'SUPPLIER_PAYMENTS.MANAGE'),async(req,rep)=>{
  const b=req.body??{};if(!txt(b.paymentNo,40)||!b.supplierId||!pos(b.amount)||!['CASH','BANK','TRANSFER','CHEQUE'].includes(b.paymentMethod)||!Array.isArray(b.allocations))return bad(rep);
  try{
   const out=await tx(db,async c=>{
    const h=await c.query(`INSERT INTO supplier_payments(payment_no,supplier_id,payment_date,amount,payment_method,reference_no,created_by)
      VALUES($1,$2,COALESCE($3::date,CURRENT_DATE),$4,$5,$6,$7) RETURNING *`,[b.paymentNo,b.supplierId,b.paymentDate??null,b.amount,b.paymentMethod,b.referenceNo??null,req.authUser.user_id]);
    let allocated=0;
    for(const a of b.allocations){
     if(!a.purchaseOrderId||!pos(a.amount))throw Object.assign(new Error('توزيع السداد غير صحيح'),{code:'P0001'});
     const po=await c.query('SELECT id,supplier_id FROM purchase_orders WHERE id=$1 AND supplier_id=$2 FOR UPDATE',[a.purchaseOrderId,b.supplierId]);
     if(!po.rowCount)throw Object.assign(new Error('أمر الشراء غير تابع للمورد'),{code:'P0001'});
     const received=await c.query(`SELECT COALESCE(SUM(l.accepted_qty*l.unit_cost),0) amount FROM goods_receipts g
       JOIN goods_receipt_lines l ON l.goods_receipt_id=g.id WHERE g.purchase_order_id=$1 AND g.status IN ('ACCEPTED','PARTIAL')`,[a.purchaseOrderId]);
     const paid=await c.query("SELECT COALESCE(SUM(a.amount),0) amount FROM supplier_payment_allocations a JOIN supplier_payments p ON p.id=a.supplier_payment_id WHERE a.purchase_order_id=$1 AND p.status='POSTED'",[a.purchaseOrderId]);
     const returned=await c.query("SELECT COALESCE(SUM(l.quantity*l.unit_cost),0) amount FROM purchase_returns r JOIN purchase_return_lines l ON l.purchase_return_id=r.id WHERE r.purchase_order_id=$1 AND r.status='POSTED'",[a.purchaseOrderId]);
     const payable=Math.max(0,Number(received.rows[0].amount)-Number(returned.rows[0].amount));
     if(Number(paid.rows[0].amount)+Number(a.amount)>payable+0.000001)throw Object.assign(new Error('السداد يتجاوز صافي قيمة المستلم بعد مرتجعات المشتريات'),{code:'P0001'});
     await c.query('INSERT INTO supplier_payment_allocations(supplier_payment_id,purchase_order_id,amount) VALUES($1,$2,$3)',[h.rows[0].id,a.purchaseOrderId,a.amount]);allocated+=Number(a.amount);
    }
    if(Math.abs(allocated-Number(b.amount))>0.000001)throw Object.assign(new Error('يجب توزيع كامل مبلغ سند الصرف على أوامر الشراء'),{code:'P0001'});
    const ap=await account(c,'2000'),cash=await account(c,b.paymentMethod==='CASH'?'1000':'1010');
    await journal(c,{no:'J-SP-'+b.paymentNo,date:b.paymentDate,sourceType:'SUPPLIER_PAYMENT',sourceId:h.rows[0].id,description:'سداد مورد '+b.paymentNo,actor:req.authUser.user_id,lines:[{account:ap,debit:Number(b.amount)},{account:cash,credit:Number(b.amount)}]});
    return h.rows[0];
   });return rep.code(201).send(out);
  }catch(e){return fail(rep,e);}
 });
 app.post('/api/v1/purchases/returns',auth(app,'PURCHASE_RETURNS.MANAGE'),async(req,rep)=>{
  const b=req.body??{};if(!txt(b.returnNo,40)||!b.supplierId||!b.purchaseOrderId||!b.warehouseId||!Array.isArray(b.lines)||!b.lines.length||b.lines.some(x=>!x.itemId||typeof (x.lotNo??'')!=='string'||(x.lotNo??'').trim().length>80||!pos(x.quantity)))return bad(rep);
  try{const out=await tx(db,async c=>{
   const po=await c.query('SELECT id,supplier_id,warehouse_id FROM purchase_orders WHERE id=$1 AND supplier_id=$2 FOR UPDATE',[b.purchaseOrderId,b.supplierId]);
   if(!po.rowCount||po.rows[0].warehouse_id!==b.warehouseId)throw Object.assign(new Error('أمر الشراء لا يطابق المورد أو المخزن'),{code:'P0001'});
   const h=await c.query(`INSERT INTO purchase_returns(return_no,supplier_id,warehouse_id,purchase_order_id,reason,created_by,status) VALUES($1,$2,$3,$4,$5,$6,'PENDING_WAREHOUSE') RETURNING *`,[b.returnNo,b.supplierId,b.warehouseId,b.purchaseOrderId,b.reason??null,req.authUser.user_id]);
   for(const l of b.lines){
    const accepted=await c.query(`SELECT COALESCE(SUM(gl.accepted_qty),0) received FROM goods_receipts gr
      JOIN goods_receipt_lines gl ON gl.goods_receipt_id=gr.id
      WHERE gr.purchase_order_id=$1 AND gr.status IN ('ACCEPTED','PARTIAL') AND gl.item_id=$2 AND COALESCE(gl.lot_no,'')=$3`,[b.purchaseOrderId,l.itemId,l.lotNo??'']);
    const already=await c.query(`SELECT COALESCE(SUM(rl.quantity),0) returned FROM purchase_returns pr
      JOIN purchase_return_lines rl ON rl.purchase_return_id=pr.id
      WHERE pr.purchase_order_id=$1 AND pr.status<>'CANCELLED' AND rl.item_id=$2 AND rl.lot_no=$3`,[b.purchaseOrderId,l.itemId,l.lotNo??'']);
    if(Number(already.rows[0].returned)+Number(l.quantity)>Number(accepted.rows[0].received)+0.000001)
     throw Object.assign(new Error('كمية المرتجع تتجاوز الكمية المقبولة لهذا الصنف والتشغيلة في أمر الشراء'),{code:'P0001'});
    const bal=await c.query("SELECT quantity,average_unit_cost FROM inventory_balances WHERE warehouse_id=$1 AND item_id=$2 AND lot_no=$3 AND quality_status='RELEASED' FOR UPDATE",[b.warehouseId,l.itemId,l.lotNo??'']);
    if(!bal.rowCount||Number(bal.rows[0].quantity)<Number(l.quantity))throw Object.assign(new Error('الرصيد المتاح غير كافٍ لمرتجع المشتريات'),{code:'P0001'});
    await c.query('INSERT INTO purchase_return_lines(purchase_return_id,item_id,lot_no,quantity,unit_cost) VALUES($1,$2,$3,$4,$5)',[h.rows[0].id,l.itemId,l.lotNo??'',l.quantity,bal.rows[0].average_unit_cost]);
   }
   return {returnId:h.rows[0].id,status:'PENDING_WAREHOUSE'};
  });return rep.code(201).send(out);}catch(e){return fail(rep,e);}
 });
 app.post('/api/v1/purchases/returns/:id/warehouse-approve',auth(app,'PURCHASE_RETURNS.WAREHOUSE_APPROVE'),async(req,rep)=>{
  try{const out=await tx(db,async c=>{
   const h=await c.query("SELECT * FROM purchase_returns WHERE id=$1 FOR UPDATE",[req.params.id]);
   if(!h.rowCount||h.rows[0].status!=='PENDING_WAREHOUSE')throw Object.assign(new Error('مرتجع المشتريات ليس بانتظار اعتماد المخزن'),{code:'P0001'});
   const lines=await c.query('SELECT * FROM purchase_return_lines WHERE purchase_return_id=$1 ORDER BY id',[req.params.id]);
   for(const l of lines.rows){
    const bal=await c.query("SELECT quantity,average_unit_cost FROM inventory_balances WHERE warehouse_id=$1 AND item_id=$2 AND lot_no=$3 AND quality_status='RELEASED' FOR UPDATE",[h.rows[0].warehouse_id,l.item_id,l.lot_no]);
    if(!bal.rowCount||Number(bal.rows[0].quantity)+0.000001<Number(l.quantity))throw Object.assign(new Error('الرصيد المتاح غير كافٍ لاعتماد المرتجع'),{code:'P0001'});
    const cost=Number(bal.rows[0].average_unit_cost);
    await c.query('UPDATE purchase_return_lines SET unit_cost=$1 WHERE id=$2',[cost,l.id]);
    await c.query('UPDATE inventory_balances SET quantity=quantity-$1,updated_at=NOW() WHERE warehouse_id=$2 AND item_id=$3 AND lot_no=$4',[l.quantity,h.rows[0].warehouse_id,l.item_id,l.lot_no]);
    await c.query(`INSERT INTO stock_movements(movement_no,warehouse_id,item_id,lot_no,movement_type,quantity_out,unit_cost,reference_type,reference_id,created_by)
     VALUES($1,$2,$3,$4,'ADJUSTMENT_OUT',$5,$6,'PURCHASE_RETURN',$7,$8)`,[`PR-${req.params.id.slice(0,12)}-${l.id.slice(0,8)}`,h.rows[0].warehouse_id,l.item_id,l.lot_no,l.quantity,cost,req.params.id,req.authUser.user_id]);
   }
   await c.query("UPDATE purchase_returns SET status='PENDING_ACCOUNTING',warehouse_approved_by=$1,warehouse_approved_at=NOW() WHERE id=$2",[req.authUser.user_id,req.params.id]);
   return {returnId:req.params.id,status:'PENDING_ACCOUNTING',warehouseApproved:true};
  });return out;}catch(e){return fail(rep,e);}
 });
 app.post('/api/v1/purchases/returns/:id/accounting-approve',auth(app,'PURCHASE_RETURNS.ACCOUNTING_APPROVE'),async(req,rep)=>{
  try{const out=await tx(db,async c=>{
   const h=await c.query("SELECT * FROM purchase_returns WHERE id=$1 FOR UPDATE",[req.params.id]);
   if(!h.rowCount||h.rows[0].status!=='PENDING_ACCOUNTING')throw Object.assign(new Error('مرتجع المشتريات لم يجتز اعتماد المخزن'),{code:'P0001'});
   const total=Number((await c.query('SELECT COALESCE(SUM(quantity*unit_cost),0) amount FROM purchase_return_lines WHERE purchase_return_id=$1',[req.params.id])).rows[0].amount);
   const ap=await account(c,'2000'),inv=await account(c,'1200');
   await journal(c,{no:'J-PR-'+h.rows[0].return_no,sourceType:'PURCHASE_RETURN',sourceId:req.params.id,description:'مرتجع مشتريات '+h.rows[0].return_no,actor:req.authUser.user_id,lines:[{account:ap,debit:total},{account:inv,credit:total}]});
   await c.query("UPDATE purchase_returns SET status='POSTED',accounting_approved_by=$1,accounting_approved_at=NOW(),posted_at=NOW() WHERE id=$2",[req.authUser.user_id,req.params.id]);
   return {returnId:req.params.id,total,status:'POSTED'};
  });return out;}catch(e){return fail(rep,e);}
 });
 app.post('/api/v1/accounting/periods/close',auth(app,'ACCOUNTING.PERIODS.MANAGE'),async(req,rep)=>{
  const b=req.body??{};if(!txt(b.periodCode,20)||!b.startDate||!b.endDate||String(b.endDate)<String(b.startDate))return bad(rep);
  try{
   const r=await tx(db,async c=>{
    await c.query("SELECT pg_advisory_xact_lock(hashtext('new-feed-accounting-periods'))");
    const overlap=await c.query("SELECT id,period_code FROM accounting_periods WHERE daterange(start_date,end_date,'[]') && daterange($1::date,$2::date,'[]') FOR UPDATE",[b.startDate,b.endDate]);
    if(overlap.rowCount)throw Object.assign(new Error('الفترة تتداخل مع فترة محاسبية موجودة: '+overlap.rows[0].period_code),{code:'P0001'});
    const integrity=await c.query(`SELECT COUNT(*)::int n FROM journal_entries j
     LEFT JOIN (SELECT journal_entry_id,SUM(debit) debit,SUM(credit) credit,COUNT(*) line_count
       FROM journal_lines GROUP BY journal_entry_id) l ON l.journal_entry_id=j.id
     WHERE j.entry_date BETWEEN $1::date AND $2::date
       AND (l.journal_entry_id IS NULL OR l.line_count<2
        OR ABS(COALESCE(l.debit,0)-j.total_debit)>0.00001
        OR ABS(COALESCE(l.credit,0)-j.total_credit)>0.00001
        OR ABS(COALESCE(l.debit,0)-COALESCE(l.credit,0))>0.00001)`,[b.startDate,b.endDate]);
    if(integrity.rows[0].n)throw Object.assign(new Error('توجد قيود غير مكتملة أو غير متطابقة؛ لا يمكن إغلاق الفترة'),{code:'P0001'});
    const totals=await c.query(`SELECT COALESCE(SUM(total_debit),0) debit,COALESCE(SUM(total_credit),0) credit
      FROM journal_entries WHERE entry_date BETWEEN $1::date AND $2::date AND status='POSTED'`,[b.startDate,b.endDate]);
    if(Math.abs(Number(totals.rows[0].debit)-Number(totals.rows[0].credit))>0.00001)
     throw Object.assign(new Error('ميزان الفترة غير متوازن؛ لا يمكن إغلاقها'),{code:'P0001'});
    const result=await c.query(`INSERT INTO accounting_periods(period_code,start_date,end_date,status,closed_by,closed_at)
     VALUES($1,$2,$3,'CLOSED',$4,NOW()) RETURNING *`,[b.periodCode,b.startDate,b.endDate,req.authUser.user_id]);
    return result.rows[0];
   });
   return rep.code(201).send(r);
  }catch(e){return fail(rep,e);}
 });
 app.post('/api/v1/accounting/periods/:id/lock',auth(app,'ACCOUNTING.PERIODS.MANAGE'),async(req,rep)=>{
  try{
   const r=await db.query("UPDATE accounting_periods SET status='LOCKED',closed_by=$1,closed_at=NOW() WHERE id=$2 AND status='CLOSED' RETURNING *",[req.authUser.user_id,req.params.id]);
   if(!r.rowCount)return rep.code(409).send({error:'BUSINESS_RULE',message:'الفترة غير موجودة أو ليست مغلقة'});
   return r.rows[0];
  }catch(e){return fail(rep,e);}
 });
 app.post('/api/v1/quality/sales-returns/:returnId/inspect',auth(app,'QUALITY.APPROVE'),async(req,rep)=>{
  const b=req.body??{};if(!['PASS','FAIL','CONDITIONAL'].includes(b.result))return bad(rep);
  try{
   const out=await tx(db,async c=>{
    const h=await c.query("SELECT id,status FROM sales_returns WHERE id=$1 FOR UPDATE",[req.params.returnId]);
    if(!h.rowCount||h.rows[0].status!=='APPROVED')throw Object.assign(new Error('يجب اعتماد المرتجع مالياً قبل فحصه'),{code:'P0001'});
    const lines=await c.query('SELECT item_id,lot_no FROM sales_return_lines WHERE sales_return_id=$1',[req.params.returnId]);
    const status=b.result==='PASS'?'RELEASED':'QUARANTINED';
    for(const l of lines.rows)await c.query('UPDATE inventory_balances SET quality_status=$1 WHERE item_id=$2 AND lot_no=$3 AND warehouse_id=(SELECT warehouse_id FROM sales_returns WHERE id=$4)',
      [status,l.item_id,l.lot_no,req.params.returnId]);
    return {returnId:req.params.returnId,qualityStatus:status,inspectedLines:lines.rowCount};
   });return out;
  }catch(e){return fail(rep,e);}
 });
 app.post('/api/v1/accounting/expenses',auth(app,'EXPENSES.MANAGE'),async(req,rep)=>{
  const b=req.body??{};if(!txt(b.expenseNo,40)||!b.accountId||!pos(b.amount)||!['CASH','BANK'].includes(b.paymentMethod)||!txt(b.description,500))return bad(rep);
  try{
   const out=await tx(db,async c=>{
    const h=await c.query(`INSERT INTO expenses(expense_no,expense_date,account_id,amount,payment_method,description,created_by)
     VALUES($1,COALESCE($2::date,CURRENT_DATE),$3,$4,$5,$6,$7) RETURNING *`,[b.expenseNo,b.expenseDate??null,b.accountId,b.amount,b.paymentMethod,b.description,req.authUser.user_id]);
    const cash=await account(c,b.paymentMethod==='CASH'?'1000':'1010');
    await journal(c,{no:'J-EX-'+b.expenseNo,date:b.expenseDate,sourceType:'EXPENSE',sourceId:h.rows[0].id,description:b.description,actor:req.authUser.user_id,lines:[{account:b.accountId,debit:Number(b.amount)},{account:cash,credit:Number(b.amount)}]});
    return h.rows[0];
   });return rep.code(201).send(out);
  }catch(e){return fail(rep,e);}
 });
 app.post('/api/v1/production/orders/:id/cost-components',auth(app,'PRODUCTION.COSTS.MANAGE'),async(req,rep)=>{
  const b=req.body??{};if(!['LABOR','ENERGY','OVERHEAD','PACKAGING','WASTE'].includes(b.componentCode)||!txt(b.description,200)||!Number.isFinite(Number(b.amount))||Number(b.amount)<0)return bad(rep);
  try{
   const out=await tx(db,async c=>{
    const p=await c.query('SELECT * FROM production_orders WHERE id=$1 AND status=\'COMPLETED\' FOR UPDATE',[req.params.id]);
    if(!p.rowCount)throw Object.assign(new Error('أمر التشغيل غير مكتمل'),{code:'P0001'});
    const output=await c.query('SELECT * FROM production_outputs WHERE production_order_id=$1 FOR UPDATE',[req.params.id]);
    const oldTotal=Number(p.rows[0].total_material_cost),add=Number(b.amount),newTotal=oldTotal+add,qty=Number(output.rows[0].quantity),delta=add/qty;
    await c.query('INSERT INTO production_cost_components(production_order_id,component_code,description,amount,created_by) VALUES($1,$2,$3,$4,$5)',[req.params.id,b.componentCode,b.description,add,req.authUser.user_id]);
    await c.query('UPDATE production_orders SET total_material_cost=$1,unit_production_cost=$2 WHERE id=$3',[newTotal,newTotal/qty,req.params.id]);
    await c.query('UPDATE production_outputs SET total_cost=$1,unit_cost=$2 WHERE production_order_id=$3',[newTotal,newTotal/qty,req.params.id]);
    await c.query('UPDATE inventory_balances SET average_unit_cost=average_unit_cost+($1/NULLIF(quantity,0)) WHERE warehouse_id=$2 AND item_id=$3 AND lot_no=$4 AND quantity>0',[delta,p.rows[0].warehouse_id,output.rows[0].item_id,output.rows[0].lot_no]);
    return {productionOrderId:req.params.id,additionalCost:add,totalCost:newTotal,unitCost:newTotal/qty};
   });return rep.code(201).send(out);
  }catch(e){return fail(rep,e);}
 });
 app.post('/api/v1/production/orders/:id/losses',auth(app,'PRODUCTION.LOSSES.MANAGE'),async(req,rep)=>{
  const b=req.body??{};if(!['PROCESS','MOISTURE','DAMAGE','OTHER'].includes(b.lossType)||!pos(b.quantity)||!txt(b.reason,500)||!Number.isFinite(Number(b.lossCost??0))||Number(b.lossCost??0)<0)return bad(rep);
  try{
   const out=await tx(db,async c=>{
    const p=await c.query("SELECT * FROM production_orders WHERE id=$1 AND status='COMPLETED' FOR UPDATE",[req.params.id]);
    if(!p.rowCount)throw Object.assign(new Error('أمر التشغيل غير مكتمل'),{code:'P0001'});
    const loss=await c.query(`INSERT INTO production_losses(production_order_id,loss_type,quantity,reason,approved_by,approved_at,created_by)
      VALUES($1,$2,$3,$4,$5,NOW(),$5) RETURNING *`,[req.params.id,b.lossType,b.quantity,b.reason,req.authUser.user_id]);
    if(Number(b.lossCost??0)>0){
     const output=await c.query('SELECT quantity FROM production_outputs WHERE production_order_id=$1',[req.params.id]);
     const qty=Number(output.rows[0].quantity),amount=Number(b.lossCost),newTotal=Number(p.rows[0].total_material_cost)+amount;
     await c.query('INSERT INTO production_cost_components(production_order_id,component_code,description,amount,created_by) VALUES($1,\'WASTE\',$2,$3,$4)',[req.params.id,b.reason,amount,req.authUser.user_id]);
     await c.query('UPDATE production_orders SET total_material_cost=$1,unit_production_cost=$2 WHERE id=$3',[newTotal,newTotal/qty,req.params.id]);
     await c.query('UPDATE production_outputs SET total_cost=$1,unit_cost=$2 WHERE production_order_id=$3',[newTotal,newTotal/qty,req.params.id]);
     await c.query('UPDATE inventory_balances SET average_unit_cost=average_unit_cost+$1 WHERE warehouse_id=$2 AND item_id=$3 AND lot_no=$4',[amount/qty,p.rows[0].warehouse_id,output.rows[0].item_id,(await c.query('SELECT lot_no FROM production_outputs WHERE production_order_id=$1',[req.params.id])).rows[0].lot_no]);
    }
    return loss.rows[0];
   });return rep.code(201).send(out);
  }catch(e){return fail(rep,e);}
 });

 app.post('/api/v1/sales/invoices/:id/reverse',auth(app,'SALES.REVERSE'),async(req,rep)=>{
  const reason=req.body?.reason;if(!txt(reason,500))return bad(rep,'سبب العكس مطلوب');
  try{const out=await tx(db,async c=>{
   const h=await c.query("SELECT * FROM sales_invoices WHERE id=$1 FOR UPDATE",[req.params.id]);
   if(!h.rowCount||!['POSTED','PARTIALLY_PAID','PAID'].includes(h.rows[0].status))throw Object.assign(new Error('الفاتورة غير قابلة للعكس'),{code:'P0001'});
   const deps=await c.query(`SELECT
    (SELECT COUNT(*) FROM receipt_allocations a JOIN cash_receipts r ON r.id=a.receipt_id AND r.status='POSTED' WHERE a.sales_invoice_id=$1) receipts,
    (SELECT COUNT(*) FROM sales_return_lines l JOIN sales_returns r ON r.id=l.sales_return_id WHERE r.sales_invoice_id=$1 AND r.status<>'REJECTED') returns`,[req.params.id]);
   if(Number(deps.rows[0].receipts)>0)throw Object.assign(new Error('اعكس سندات القبض المرتبطة أولاً'),{code:'P0001'});
   if(Number(deps.rows[0].returns)>0)throw Object.assign(new Error('لا يمكن عكس فاتورة لها مرتجعات غير مرفوضة'),{code:'P0001'});
   const lines=await c.query('SELECT * FROM sales_invoice_lines WHERE sales_invoice_id=$1 ORDER BY id',[req.params.id]);
   for(const l of lines.rows){
    const bal=await c.query('SELECT quantity,average_unit_cost,quality_status FROM inventory_balances WHERE warehouse_id=$1 AND item_id=$2 AND lot_no=$3 FOR UPDATE',[h.rows[0].warehouse_id,l.item_id,l.lot_no]);
    const old=bal.rowCount?Number(bal.rows[0].quantity):0,oldCost=bal.rowCount?Number(bal.rows[0].average_unit_cost):0,q=Number(l.quantity),cost=Number(l.unit_cost),newQty=old+q;
    const avg=newQty?((old*oldCost)+(q*cost))/newQty:0;
    await c.query(`INSERT INTO inventory_balances(warehouse_id,item_id,lot_no,quantity,average_unit_cost,quality_status)
     VALUES($1,$2,$3,$4,$5,'RELEASED') ON CONFLICT(warehouse_id,item_id,lot_no) DO UPDATE
     SET quantity=EXCLUDED.quantity,average_unit_cost=EXCLUDED.average_unit_cost,updated_at=NOW()`,
     [h.rows[0].warehouse_id,l.item_id,l.lot_no,newQty,avg]);
    await c.query(`INSERT INTO stock_movements(movement_no,warehouse_id,item_id,lot_no,movement_type,quantity_in,unit_cost,reference_type,reference_id,created_by)
     VALUES($1,$2,$3,$4,'ADJUSTMENT_IN',$5,$6,'SALES_INVOICE_REVERSAL',$7,$8)`,
     [`SIR-${req.params.id.slice(0,12)}-${l.id.slice(0,8)}`,h.rows[0].warehouse_id,l.item_id,l.lot_no,q,cost,req.params.id,req.authUser.user_id]);
   }
   await reverseJournal(c,{sourceType:'SALES_INVOICE',sourceId:req.params.id,reversalType:'SALES_INVOICE_REVERSAL',reversalNo:'J-RSI-'+req.params.id.slice(0,12),actor:req.authUser.user_id,reason});
   await c.query("UPDATE sales_invoices SET status='CANCELLED' WHERE id=$1",[req.params.id]);
   return {invoiceId:req.params.id,status:'CANCELLED',restoredLines:lines.rowCount};
  });return out;}catch(e){return fail(rep,e);}
 });
 app.post('/api/v1/accounting/receipts/:id/reverse',auth(app,'RECEIPTS.REVERSE'),async(req,rep)=>{
  const reason=req.body?.reason;if(!txt(reason,500))return bad(rep,'سبب العكس مطلوب');
  try{const out=await tx(db,async c=>{
   const h=await c.query("SELECT * FROM cash_receipts WHERE id=$1 FOR UPDATE",[req.params.id]);
   if(!h.rowCount||h.rows[0].status!=='POSTED')throw Object.assign(new Error('سند القبض غير قابل للعكس'),{code:'P0001'});
   const allocations=await c.query('SELECT sales_invoice_id FROM receipt_allocations WHERE receipt_id=$1',[req.params.id]);
   await reverseJournal(c,{sourceType:'CASH_RECEIPT',sourceId:req.params.id,reversalType:'CASH_RECEIPT_REVERSAL',reversalNo:'J-RRC-'+req.params.id.slice(0,12),actor:req.authUser.user_id,reason});
   await c.query("UPDATE cash_receipts SET status='REVERSED' WHERE id=$1",[req.params.id]);
   for(const a of allocations.rows){
    const paid=await c.query(`SELECT COALESCE(SUM(x.amount),0) amount FROM receipt_allocations x JOIN cash_receipts r ON r.id=x.receipt_id AND r.status='POSTED' WHERE x.sales_invoice_id=$1`,[a.sales_invoice_id]);
    const inv=await c.query('SELECT total_amount FROM sales_invoices WHERE id=$1 FOR UPDATE',[a.sales_invoice_id]);
    if(inv.rowCount)await c.query(`UPDATE sales_invoices SET status=CASE WHEN $1<=0 THEN 'POSTED' WHEN $1>=total_amount THEN 'PAID' ELSE 'PARTIALLY_PAID' END WHERE id=$2 AND status<>'CANCELLED'`,[Number(paid.rows[0].amount),a.sales_invoice_id]);
   }
   return {receiptId:req.params.id,status:'REVERSED',recalculatedInvoices:allocations.rowCount};
  });return out;}catch(e){return fail(rep,e);}
 });

 app.post('/api/v1/accounting/supplier-payments/:id/reverse',auth(app,'SUPPLIER_PAYMENTS.REVERSE'),async(req,rep)=>{
  const reason=req.body?.reason;if(!txt(reason,500))return bad(rep,'سبب العكس مطلوب');
  try{const out=await tx(db,async c=>{
   const h=await c.query("SELECT * FROM supplier_payments WHERE id=$1 FOR UPDATE",[req.params.id]);
   if(!h.rowCount||h.rows[0].status!=='POSTED')throw Object.assign(new Error('سند صرف المورد غير قابل للعكس'),{code:'P0001'});
   await reverseJournal(c,{sourceType:'SUPPLIER_PAYMENT',sourceId:req.params.id,reversalType:'SUPPLIER_PAYMENT_REVERSAL',reversalNo:'J-RSP-'+req.params.id.slice(0,12),actor:req.authUser.user_id,reason});
   await c.query("UPDATE supplier_payments SET status='REVERSED' WHERE id=$1",[req.params.id]);
   return {paymentId:req.params.id,status:'REVERSED'};
  });return out;}catch(e){return fail(rep,e);}
 });
 app.post('/api/v1/purchases/returns/:id/reverse',auth(app,'PURCHASE_RETURNS.REVERSE'),async(req,rep)=>{
  const reason=req.body?.reason;if(!txt(reason,500))return bad(rep,'سبب العكس مطلوب');
  try{const out=await tx(db,async c=>{
   const h=await c.query("SELECT * FROM purchase_returns WHERE id=$1 FOR UPDATE",[req.params.id]);
   if(!h.rowCount||h.rows[0].status!=='POSTED')throw Object.assign(new Error('مرتجع المشتريات غير قابل للعكس'),{code:'P0001'});
   const lines=await c.query('SELECT * FROM purchase_return_lines WHERE purchase_return_id=$1 ORDER BY id',[req.params.id]);
   for(const l of lines.rows){
    const bal=await c.query('SELECT quantity,average_unit_cost FROM inventory_balances WHERE warehouse_id=$1 AND item_id=$2 AND lot_no=$3 FOR UPDATE',[h.rows[0].warehouse_id,l.item_id,l.lot_no]);
    const old=bal.rowCount?Number(bal.rows[0].quantity):0,oldCost=bal.rowCount?Number(bal.rows[0].average_unit_cost):0,q=Number(l.quantity),cost=Number(l.unit_cost),newQty=old+q;
    const avg=newQty?((old*oldCost)+(q*cost))/newQty:0;
    await c.query(`INSERT INTO inventory_balances(warehouse_id,item_id,lot_no,quantity,average_unit_cost,quality_status)
     VALUES($1,$2,$3,$4,$5,'RELEASED') ON CONFLICT(warehouse_id,item_id,lot_no) DO UPDATE
     SET quantity=EXCLUDED.quantity,average_unit_cost=EXCLUDED.average_unit_cost,updated_at=NOW()`,
     [h.rows[0].warehouse_id,l.item_id,l.lot_no,newQty,avg]);
    await c.query(`INSERT INTO stock_movements(movement_no,warehouse_id,item_id,lot_no,movement_type,quantity_in,unit_cost,reference_type,reference_id,created_by)
     VALUES($1,$2,$3,$4,'ADJUSTMENT_IN',$5,$6,'PURCHASE_RETURN_REVERSAL',$7,$8)`,
     [`PRR-${req.params.id.slice(0,12)}-${l.id.slice(0,8)}`,h.rows[0].warehouse_id,l.item_id,l.lot_no,q,cost,req.params.id,req.authUser.user_id]);
   }
   await reverseJournal(c,{sourceType:'PURCHASE_RETURN',sourceId:req.params.id,reversalType:'PURCHASE_RETURN_REVERSAL',reversalNo:'J-RPR-'+req.params.id.slice(0,12),actor:req.authUser.user_id,reason});
   await c.query("UPDATE purchase_returns SET status='CANCELLED' WHERE id=$1",[req.params.id]);
   return {returnId:req.params.id,status:'CANCELLED',restoredLines:lines.rowCount};
  });return out;}catch(e){return fail(rep,e);}
 });
 app.post('/api/v1/accounting/expenses/:id/reverse',auth(app,'EXPENSES.REVERSE'),async(req,rep)=>{
  const reason=req.body?.reason;if(!txt(reason,500))return bad(rep,'سبب العكس مطلوب');
  try{const out=await tx(db,async c=>{
   const h=await c.query("SELECT * FROM expenses WHERE id=$1 FOR UPDATE",[req.params.id]);
   if(!h.rowCount||h.rows[0].status!=='POSTED')throw Object.assign(new Error('المصروف غير قابل للعكس'),{code:'P0001'});
   await reverseJournal(c,{sourceType:'EXPENSE',sourceId:req.params.id,reversalType:'EXPENSE_REVERSAL',reversalNo:'J-REX-'+req.params.id.slice(0,12),actor:req.authUser.user_id,reason});
   await c.query("UPDATE expenses SET status='REVERSED' WHERE id=$1",[req.params.id]);
   return {expenseId:req.params.id,status:'REVERSED'};
  });return out;}catch(e){return fail(rep,e);}
 });

 app.get('/api/v1/reports/general-ledger',auth(app,'ACCOUNTING.READ'),async(req,rep)=>{
  const accountId=req.query?.accountId??null,from=req.query?.from??null,to=req.query?.to??null;
  if(from&&to&&String(from)>String(to))return bad(rep,'تاريخ البداية يجب ألا يتجاوز تاريخ النهاية');
  try{
   return (await db.query(`WITH ledger AS (
    SELECT a.id account_id,a.code account_code,a.name_ar account_name,a.account_type,
      j.id journal_id,j.entry_no,j.entry_date,j.source_type,j.source_id,j.description,
      j.created_at,l.id line_id,l.debit,l.credit,
      SUM(l.debit-l.credit) OVER(PARTITION BY a.id ORDER BY j.entry_date,j.created_at,j.entry_no,l.id ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) running_balance,
      SUM(CASE WHEN $2::date IS NOT NULL AND j.entry_date<$2::date THEN l.debit-l.credit ELSE 0 END)
        OVER(PARTITION BY a.id) opening_balance
    FROM gl_accounts a JOIN journal_lines l ON l.account_id=a.id
    JOIN journal_entries j ON j.id=l.journal_entry_id AND j.status='POSTED'
    WHERE ($1::uuid IS NULL OR a.id=$1::uuid) AND ($3::date IS NULL OR j.entry_date<=$3::date)
   )
   SELECT account_id,account_code,account_name,account_type,journal_id,entry_no,entry_date,
     source_type,source_id,description,debit,credit,opening_balance,running_balance
   FROM ledger WHERE ($2::date IS NULL OR entry_date>=$2::date)
   ORDER BY account_code,entry_date,created_at,entry_no,line_id`,
   [accountId,from,to])).rows;
  }catch(e){return fail(rep,e);}
 });
 app.get('/api/v1/reports/trial-balance',auth(app,'REPORTS.READ'),async(req,rep)=>{
  try{return (await db.query(`SELECT a.code,a.name_ar,a.account_type,
    COALESCE(SUM(CASE WHEN j.id IS NOT NULL THEN l.debit ELSE 0 END),0) total_debit,
    COALESCE(SUM(CASE WHEN j.id IS NOT NULL THEN l.credit ELSE 0 END),0) total_credit,
    COALESCE(SUM(CASE WHEN j.id IS NOT NULL THEN l.debit-l.credit ELSE 0 END),0) balance
    FROM gl_accounts a LEFT JOIN journal_lines l ON l.account_id=a.id
    LEFT JOIN journal_entries j ON j.id=l.journal_entry_id AND j.status='POSTED'
      AND ($1::date IS NULL OR j.entry_date >= $1) AND ($2::date IS NULL OR j.entry_date <= $2)
    GROUP BY a.id ORDER BY a.code`,[req.query?.from??null,req.query?.to??null])).rows;}catch(e){return fail(rep,e);}
 });
 app.get('/api/v1/reports/inventory-valuation',auth(app,'REPORTS.READ'),async(_q,rep)=>{
  try{return (await db.query(`SELECT b.item_id,w.code warehouse_code,i.code item_code,i.name_ar item_name,b.lot_no,b.expiry_date,b.quality_status,b.quantity,b.average_unit_cost,b.quantity*b.average_unit_cost stock_value
    FROM inventory_balances b JOIN warehouses w ON w.id=b.warehouse_id JOIN items i ON i.id=b.item_id
    ORDER BY w.code,i.code,b.lot_no`)).rows;}catch(e){return fail(rep,e);}
 });
 app.get('/api/v1/reports/expiry-alerts',auth(app,'REPORTS.READ'),async(req,rep)=>{
  const days=req.query?.days===undefined?30:Number(req.query.days);
  if(!Number.isInteger(days)||days<0||days>3650)return rep.code(400).send({error:'VALIDATION_ERROR',message:'عدد الأيام يجب أن يكون بين 0 و3650'});
  try{return (await db.query(`SELECT b.item_id,w.code warehouse_code,i.code item_code,i.name_ar item_name,b.lot_no,
    b.expiry_date,b.quality_status,b.quantity,b.average_unit_cost,b.quantity*b.average_unit_cost stock_value,
    (b.expiry_date-CURRENT_DATE) days_to_expiry,
    CASE WHEN b.expiry_date<CURRENT_DATE THEN 'EXPIRED'
      WHEN b.expiry_date=CURRENT_DATE THEN 'EXPIRES_TODAY' ELSE 'EXPIRING_SOON' END expiry_status
    FROM inventory_balances b JOIN warehouses w ON w.id=b.warehouse_id JOIN items i ON i.id=b.item_id
    WHERE b.expiry_date IS NOT NULL AND b.quantity>0 AND b.expiry_date<=CURRENT_DATE+$1::int
    ORDER BY b.expiry_date,w.code,i.code,b.lot_no`,[days])).rows;}
  catch(e){return fail(rep,e);}
 });
 app.get('/api/v1/reports/production-costs',auth(app,'REPORTS.READ'),async(_q,rep)=>{
  try{return (await db.query(`SELECT p.order_no,fp.code product_code,fp.name_ar product_name,p.planned_qty,p.actual_qty,
    p.total_material_cost,p.unit_production_cost,
    COALESCE((SELECT SUM(c.amount) FROM production_cost_components c WHERE c.production_order_id=p.id),0) additional_costs,
    COALESCE((SELECT SUM(l.quantity) FROM production_losses l WHERE l.production_order_id=p.id),0) recorded_loss_qty
    FROM production_orders p JOIN feed_products fp ON fp.id=p.feed_product_id ORDER BY p.created_at DESC`)).rows;}catch(e){return fail(rep,e);}
 });
 app.get('/api/v1/reports/production-losses',auth(app,'REPORTS.READ'),async(req,rep)=>{
  try{return (await db.query(`SELECT l.id,p.order_no,fp.code product_code,fp.name_ar product_name,
    o.lot_no,l.loss_type,l.quantity,o.unit_cost,l.quantity*o.unit_cost estimated_loss_value,
    CASE WHEN l.approved_by IS NULL THEN 'PENDING_APPROVAL' ELSE 'POSTED' END status,
    l.reason,l.created_at,l.approved_at,j.entry_no,j.total_debit posted_loss_value,
    creator.display_name created_by_name,approver.display_name approved_by_name
    FROM production_losses l JOIN production_orders p ON p.id=l.production_order_id
    JOIN feed_products fp ON fp.id=p.feed_product_id JOIN production_outputs o ON o.production_order_id=p.id
    LEFT JOIN journal_entries j ON j.id=l.journal_entry_id
    LEFT JOIN users creator ON creator.id=l.created_by LEFT JOIN users approver ON approver.id=l.approved_by
    WHERE ($1::date IS NULL OR l.created_at::date >= $1) AND ($2::date IS NULL OR l.created_at::date <= $2)
    ORDER BY l.created_at DESC`,[req.query?.from??null,req.query?.to??null])).rows;}
  catch(e){return fail(rep,e);}
 });
 app.get('/api/v1/reports/sales-summary',auth(app,'REPORTS.READ'),async(req,rep)=>{
  try{return (await db.query(`SELECT invoice_date,COUNT(*)::int invoice_count,SUM(subtotal) subtotal,SUM(discount_amount) discounts,
    SUM(total_amount) net_sales,SUM(cost_amount) cost_of_sales,SUM(total_amount-cost_amount) gross_margin
    FROM sales_invoices WHERE status IN ('POSTED','PARTIALLY_PAID','PAID')
    AND ($1::date IS NULL OR invoice_date >= $1) AND ($2::date IS NULL OR invoice_date <= $2)
    GROUP BY invoice_date ORDER BY invoice_date DESC`,[req.query?.from??null,req.query?.to??null])).rows;}catch(e){return fail(rep,e);}
 });

 app.get('/api/v1/reports/supplier-aging',auth(app,'REPORTS.READ'),async(req,rep)=>{
  const asOf=req.query?.asOf??new Date().toISOString().slice(0,10),supplierCode=String(req.query?.supplierCode??'').trim()||null;
  if(!/^\d{4}-\d{2}-\d{2}$/.test(String(asOf)))return bad(rep,'صيغة التاريخ يجب أن تكون YYYY-MM-DD');
  if(supplierCode&&!txt(supplierCode,40))return bad(rep,'كود المورد غير صحيح');
  try{return (await db.query(`WITH received AS (
    SELECT po.id purchase_order_id,po.order_no,po.supplier_id,po.payment_due_date,
      COALESCE(po.payment_due_date,MIN(gr.received_at::date)) aging_date,
      SUM(gl.accepted_qty*gl.unit_cost)::numeric received_amount
    FROM purchase_orders po JOIN goods_receipts gr ON gr.purchase_order_id=po.id
      JOIN goods_receipt_lines gl ON gl.goods_receipt_id=gr.id
    WHERE gr.status IN ('ACCEPTED','PARTIAL') AND gr.received_at::date<=$1::date
    GROUP BY po.id,po.order_no,po.supplier_id,po.payment_due_date
   ), paid AS (
    SELECT a.purchase_order_id,SUM(a.amount)::numeric paid_amount
    FROM supplier_payment_allocations a JOIN supplier_payments p ON p.id=a.supplier_payment_id
    WHERE p.status='POSTED' AND p.payment_date<=$1::date GROUP BY a.purchase_order_id
   ), returned AS (
    SELECT r.purchase_order_id,SUM(l.quantity*l.unit_cost)::numeric returned_amount
    FROM purchase_returns r JOIN purchase_return_lines l ON l.purchase_return_id=r.id
    WHERE r.status='POSTED' AND r.accounting_approved_at::date<=$1::date AND r.purchase_order_id IS NOT NULL
    GROUP BY r.purchase_order_id
   )
   SELECT s.code supplier_code,s.name_ar supplier_name,r.purchase_order_id,r.order_no,r.aging_date,
    r.received_amount,COALESCE(p.paid_amount,0) paid_amount,COALESCE(x.returned_amount,0) returned_amount,
    GREATEST(0::numeric,r.received_amount-COALESCE(p.paid_amount,0)-COALESCE(x.returned_amount,0)) outstanding,
    GREATEST(0,($1::date-r.aging_date))::int age_days,
    CASE WHEN GREATEST(0,($1::date-r.aging_date))<=30 THEN '0-30'
      WHEN GREATEST(0,($1::date-r.aging_date))<=60 THEN '31-60'
      WHEN GREATEST(0,($1::date-r.aging_date))<=90 THEN '61-90' ELSE 'أكثر من 90' END aging_bucket
   FROM received r JOIN suppliers s ON s.id=r.supplier_id
   LEFT JOIN paid p ON p.purchase_order_id=r.purchase_order_id LEFT JOIN returned x ON x.purchase_order_id=r.purchase_order_id
   WHERE GREATEST(0::numeric,r.received_amount-COALESCE(p.paid_amount,0)-COALESCE(x.returned_amount,0))>0
    AND ($2::text IS NULL OR s.code=$2::text)
   ORDER BY s.code,r.aging_date,r.order_no`,[asOf,supplierCode])).rows;}
  catch(e){return fail(rep,e);}
 });
 app.get('/api/v1/reports/supplier-statement',auth(app,'REPORTS.READ'),async(req,rep)=>{
  const supplierCode=String(req.query?.supplierCode??'').trim(),from=req.query?.from??null,to=req.query?.to??null;
  if(!txt(supplierCode,40))return bad(rep,'كود المورد مطلوب');
  if((from&&!/^\\d{4}-\\d{2}-\\d{2}$/.test(String(from)))||(to&&!/^\\d{4}-\\d{2}-\\d{2}$/.test(String(to))))return bad(rep,'صيغة التاريخ يجب أن تكون YYYY-MM-DD');
  if(from&&to&&String(from)>String(to))return bad(rep,'تاريخ البداية يجب ألا يتجاوز النهاية');
  const sql=`WITH transactions AS (
    SELECT g.received_at::date transaction_date,'GOODS_RECEIPT'::text transaction_type,
      g.receipt_no document_no,'استلام مشتريات معتمد الجودة'::text description,
      0::numeric debit,SUM(l.accepted_qty*l.unit_cost)::numeric credit
    FROM goods_receipts g JOIN purchase_orders po ON po.id=g.purchase_order_id
      JOIN suppliers s ON s.id=po.supplier_id JOIN goods_receipt_lines l ON l.goods_receipt_id=g.id
    WHERE s.code=$1 AND g.status IN ('ACCEPTED','PARTIAL')
    GROUP BY g.id,g.received_at,g.receipt_no
    UNION ALL
    SELECT p.payment_date,'SUPPLIER_PAYMENT',p.payment_no,'سداد مورد',
      SUM(a.amount)::numeric,0::numeric
    FROM supplier_payments p JOIN suppliers s ON s.id=p.supplier_id
      JOIN supplier_payment_allocations a ON a.supplier_payment_id=p.id
    WHERE s.code=$1 AND p.status='POSTED'
    GROUP BY p.id,p.payment_date,p.payment_no
    UNION ALL
    SELECT COALESCE(r.accounting_approved_at::date,r.posted_at::date),'PURCHASE_RETURN',r.return_no,
      'مرتجع مشتريات معتمد',SUM(l.quantity*l.unit_cost)::numeric,0::numeric
    FROM purchase_returns r JOIN suppliers s ON s.id=r.supplier_id
      JOIN purchase_return_lines l ON l.purchase_return_id=r.id
    WHERE s.code=$1 AND r.status='POSTED'
    GROUP BY r.id,r.accounting_approved_at,r.posted_at,r.return_no
  ), opening AS (
    SELECT COALESCE(SUM(credit-debit),0)::numeric balance FROM transactions
    WHERE $2::date IS NOT NULL AND transaction_date<$2::date
  ), period_rows AS (
    SELECT * FROM transactions
    WHERE ($2::date IS NULL OR transaction_date>=$2::date)
      AND ($3::date IS NULL OR transaction_date<=$3::date)
  ), running AS (
    SELECT p.*,o.balance+SUM(p.credit-p.debit) OVER(
      ORDER BY p.transaction_date,p.transaction_type,p.document_no
      ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) balance
    FROM period_rows p CROSS JOIN opening o
  ), closing AS (
    SELECT o.balance+COALESCE(SUM(p.credit-p.debit),0)::numeric balance
    FROM opening o LEFT JOIN period_rows p ON TRUE GROUP BY o.balance
  )
  SELECT * FROM (
    SELECT 0 sort_order,NULL::date transaction_date,'OPENING'::text transaction_type,
      '—'::text document_no,'رصيد افتتاحي'::text description,0::numeric debit,0::numeric credit,o.balance
    FROM opening o
    UNION ALL
    SELECT 1,r.transaction_date,r.transaction_type,r.document_no,r.description,r.debit,r.credit,r.balance FROM running r
    UNION ALL
    SELECT 2,NULL::date,'CLOSING'::text,'—'::text,'رصيد ختامي'::text,0::numeric,0::numeric,c.balance FROM closing c
  ) statement_rows
  ORDER BY sort_order,transaction_date NULLS FIRST,document_no`;
  try{return (await db.query(sql,[supplierCode,from,to])).rows;}
  catch(e){return fail(rep,e);}
 });

 app.get('/api/v1/reports/customer-statement',auth(app,'REPORTS.READ'),async(req,rep)=>{
  const customerCode=String(req.query?.customerCode??'').trim(),from=req.query?.from??null,to=req.query?.to??null;
  if(!txt(customerCode,40))return bad(rep,'كود العميل مطلوب');
  if((from&&!/^\d{4}-\d{2}-\d{2}$/.test(String(from)))||(to&&!/^\d{4}-\d{2}-\d{2}$/.test(String(to))))return bad(rep,'صيغة التاريخ يجب أن تكون YYYY-MM-DD');
  if(from&&to&&String(from)>String(to))return bad(rep,'تاريخ البداية يجب ألا يتجاوز تاريخ النهاية');
  const sql=`WITH transactions AS (
    SELECT i.invoice_date transaction_date,'SALES_INVOICE' transaction_type,i.invoice_no document_no,
      'فاتورة مبيعات' description,i.total_amount::numeric debit,0::numeric credit
    FROM sales_invoices i JOIN customers c ON c.id=i.customer_id
    WHERE c.code=$1 AND i.status IN ('POSTED','PARTIALLY_PAID','PAID')
    UNION ALL
    SELECT r.receipt_date,'CASH_RECEIPT',r.receipt_no,'سند قبض',0::numeric,SUM(a.amount)::numeric
    FROM cash_receipts r JOIN receipt_allocations a ON a.receipt_id=r.id
      JOIN sales_invoices i ON i.id=a.sales_invoice_id JOIN customers c ON c.id=i.customer_id
    WHERE c.code=$1 AND r.status='POSTED'
    GROUP BY r.id,r.receipt_date,r.receipt_no
    UNION ALL
    SELECT COALESCE(sr.accounting_approved_at::date,sr.created_at::date),'SALES_RETURN',sr.return_no,
      'مرتجع مبيعات معتمد',0::numeric,SUM(rl.quantity*rl.unit_price)::numeric
    FROM sales_returns sr JOIN sales_invoices i ON i.id=sr.sales_invoice_id
      JOIN customers c ON c.id=i.customer_id JOIN sales_return_lines rl ON rl.sales_return_id=sr.id
    WHERE c.code=$1 AND sr.status='APPROVED'
    GROUP BY sr.id,sr.accounting_approved_at,sr.created_at,sr.return_no
  ), opening AS (
    SELECT COALESCE(SUM(debit-credit),0)::numeric balance FROM transactions
    WHERE $2::date IS NOT NULL AND transaction_date<$2::date
  ), period_rows AS (
    SELECT * FROM transactions
    WHERE ($2::date IS NULL OR transaction_date>=$2::date)
      AND ($3::date IS NULL OR transaction_date<=$3::date)
  ), running AS (
    SELECT p.*,o.balance+SUM(p.debit-p.credit) OVER(
      ORDER BY p.transaction_date,p.transaction_type,p.document_no
      ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) balance
    FROM period_rows p CROSS JOIN opening o
  ), closing AS (
    SELECT o.balance+COALESCE(SUM(p.debit-p.credit),0)::numeric balance
    FROM opening o LEFT JOIN period_rows p ON TRUE GROUP BY o.balance
  )
  SELECT * FROM (
    SELECT 0 sort_order,NULL::date transaction_date,'OPENING'::text transaction_type,
      '—'::text document_no,'رصيد افتتاحي'::text description,0::numeric debit,0::numeric credit,
      o.balance FROM opening o
    UNION ALL
    SELECT 1,r.transaction_date,r.transaction_type,r.document_no,r.description,r.debit,r.credit,r.balance
    FROM running r
    UNION ALL
    SELECT 2,NULL::date,'CLOSING'::text,'—'::text,'رصيد ختامي'::text,0::numeric,0::numeric,c.balance
    FROM closing c
  ) statement_rows
  ORDER BY sort_order,transaction_date NULLS FIRST,document_no`;
  try{return (await db.query(sql,[customerCode,from,to])).rows;}
  catch(e){return fail(rep,e);}
 });
 app.get('/api/v1/reports/customer-aging',auth(app,'REPORTS.READ'),async(req,rep)=>{
  const asOf=req.query?.asOf??new Date().toISOString().slice(0,10),customerCode=String(req.query?.customerCode??'').trim()||null;
  if(!/^\d{4}-\d{2}-\d{2}$/.test(String(asOf)))return bad(rep,'صيغة التاريخ يجب أن تكون YYYY-MM-DD');
  if(customerCode&&!txt(customerCode,40))return bad(rep,'كود العميل غير صحيح');
  try{return (await db.query(`WITH paid AS (
    SELECT a.sales_invoice_id,SUM(a.amount)::numeric paid_amount
    FROM receipt_allocations a JOIN cash_receipts r ON r.id=a.receipt_id
    WHERE r.status='POSTED' GROUP BY a.sales_invoice_id
  ), returned AS (
    SELECT sr.sales_invoice_id,SUM(rl.quantity*rl.unit_price)::numeric returned_amount
    FROM sales_returns sr JOIN sales_return_lines rl ON rl.sales_return_id=sr.id
    WHERE sr.status='APPROVED' GROUP BY sr.sales_invoice_id
  ), balances AS (
    SELECT i.id invoice_id,i.invoice_no,i.invoice_date,COALESCE(i.due_date,i.invoice_date) due_date,c.code customer_code,c.name_ar customer_name,
      i.total_amount::numeric invoice_amount,COALESCE(p.paid_amount,0)::numeric paid_amount,
      COALESCE(r.returned_amount,0)::numeric returned_amount,
      GREATEST(0::numeric,i.total_amount-COALESCE(p.paid_amount,0)-COALESCE(r.returned_amount,0)) outstanding,
      ($1::date-COALESCE(i.due_date,i.invoice_date))::int age_days
    FROM sales_invoices i JOIN customers c ON c.id=i.customer_id
    LEFT JOIN paid p ON p.sales_invoice_id=i.id LEFT JOIN returned r ON r.sales_invoice_id=i.id
    WHERE i.status IN ('POSTED','PARTIALLY_PAID','PAID') AND i.invoice_date<=$1::date
      AND ($2::text IS NULL OR c.code=$2::text)
  )
  SELECT invoice_id,invoice_no,invoice_date,due_date,customer_code,customer_name,invoice_amount,paid_amount,
    returned_amount,outstanding,age_days,
    CASE WHEN age_days<=30 THEN '0-30' WHEN age_days<=60 THEN '31-60'
      WHEN age_days<=90 THEN '61-90' ELSE 'أكثر من 90' END aging_bucket
  FROM balances WHERE outstanding>0.000001
  ORDER BY customer_code,invoice_date,invoice_no`,[asOf,customerCode])).rows;}
  catch(e){return fail(rep,e);}
 });

 app.get('/api/v1/accounting/journals',auth(app,'ACCOUNTING.READ'),async(_q,rep)=>{
  try{return (await db.query(`SELECT j.*,COALESCE(json_agg(json_build_object('accountCode',a.code,'accountName',a.name_ar,'debit',l.debit,'credit',l.credit)) FILTER(WHERE l.id IS NOT NULL),'[]'::json) lines
   FROM journal_entries j LEFT JOIN journal_lines l ON l.journal_entry_id=j.id LEFT JOIN gl_accounts a ON a.id=l.account_id GROUP BY j.id ORDER BY j.entry_date DESC,j.entry_no DESC`)).rows;}catch(e){return fail(rep,e);}
 });
}
