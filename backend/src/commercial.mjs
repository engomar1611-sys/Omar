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
 const debit=lines.reduce((s,x)=>s+Number(x.debit||0),0),credit=lines.reduce((s,x)=>s+Number(x.credit||0),0);
 if(Math.abs(debit-credit)>0.00001)throw Object.assign(new Error('القيد المحاسبي غير متوازن'),{code:'P0001'});
 const h=await c.query(`INSERT INTO journal_entries(entry_no,entry_date,source_type,source_id,description,total_debit,total_credit,created_by)
 VALUES($1,COALESCE($2::date,CURRENT_DATE),$3,$4,$5,$6,$7,$8) RETURNING id`,
 [no,date??null,sourceType,sourceId,description,debit,credit,actor]);
 for(const l of lines)await c.query('INSERT INTO journal_lines(journal_entry_id,account_id,debit,credit,description) VALUES($1,$2,$3,$4,$5)',
 [h.rows[0].id,l.account,Number(l.debit||0),Number(l.credit||0),l.description??null]);
 return h.rows[0].id;
}
export async function commercialRoutes(app,{db}){
 app.get('/api/v1/customers',auth(app,'CUSTOMERS.READ'),async(_q,rep)=>{try{return (await db.query('SELECT * FROM customers ORDER BY code')).rows;}catch(e){return fail(rep,e);}});
 app.post('/api/v1/customers',auth(app,'CUSTOMERS.MANAGE'),async(req,rep)=>{
  const b=req.body??{};if(!txt(b.code,40)||!txt(b.nameAr,200)|| (b.creditLimit!==undefined&&(!Number.isFinite(Number(b.creditLimit))||Number(b.creditLimit)<0)))return bad(rep);
  try{const r=await db.query('INSERT INTO customers(code,name_ar,phone,address,credit_limit) VALUES($1,$2,$3,$4,$5) RETURNING *',[b.code.trim(),b.nameAr.trim(),b.phone??null,b.address??null,b.creditLimit??0]);return rep.code(201).send(r.rows[0]);}catch(e){return fail(rep,e);}
 });
 app.get('/api/v1/sales/invoices',auth(app,'SALES.READ'),async(_q,rep)=>{
  try{return (await db.query(`SELECT i.*,c.code customer_code,c.name_ar customer_name FROM sales_invoices i JOIN customers c ON c.id=i.customer_id ORDER BY i.invoice_date DESC,i.invoice_no DESC`)).rows;}catch(e){return fail(rep,e);}
 });
 app.post('/api/v1/sales/invoices',auth(app,'SALES.MANAGE'),async(req,rep)=>{
  const b=req.body??{};if(!txt(b.invoiceNo,40)||!b.customerId||!b.warehouseId||!Array.isArray(b.lines)||!b.lines.length||
   b.lines.some(l=>!l.itemId||!pos(l.quantity)||!Number.isFinite(Number(l.unitPrice))||Number(l.unitPrice)<0))return bad(rep);
  const discount=Number(b.discountAmount??0);if(!Number.isFinite(discount)||discount<0)return bad(rep);
  try{
   const out=await tx(db,async c=>{
    const cust=await c.query('SELECT id,credit_limit FROM customers WHERE id=$1 AND is_active=TRUE FOR UPDATE',[b.customerId]);
    if(!cust.rowCount)throw Object.assign(new Error('العميل غير موجود أو غير نشط'),{code:'P0001'});
    const h=await c.query(`INSERT INTO sales_invoices(invoice_no,customer_id,warehouse_id,invoice_date,discount_amount,created_by)
     VALUES($1,$2,$3,COALESCE($4::date,CURRENT_DATE),$5,$6) RETURNING *`,[b.invoiceNo.trim(),b.customerId,b.warehouseId,b.invoiceDate??null,discount,req.authUser.user_id]);
    let subtotal=0,costTotal=0;
    for(let i=0;i<b.lines.length;i++){
     const l=b.lines[i];let remaining=Number(l.quantity),lineCost=0,weightedQty=0,chosenLot=l.lotNo??'';
     const lots=await c.query(`SELECT lot_no,quantity,average_unit_cost FROM inventory_balances
       WHERE warehouse_id=$1 AND item_id=$2 AND quantity>0 AND ($3='' OR lot_no=$3)
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
     await c.query(`INSERT INTO inventory_balances(warehouse_id,item_id,lot_no,quantity,average_unit_cost)
      VALUES($1,$2,$3,$4,$5) ON CONFLICT(warehouse_id,item_id,lot_no) DO UPDATE SET quantity=EXCLUDED.quantity,average_unit_cost=EXCLUDED.average_unit_cost,updated_at=NOW()`,[h.rows[0].warehouse_id,l.item_id,l.lot_no,newQty,newAvg]);
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
    await c.query('UPDATE inventory_balances SET average_unit_cost=average_unit_cost+$1 WHERE warehouse_id=$2 AND item_id=$3 AND lot_no=$4',[delta,p.rows[0].warehouse_id,output.rows[0].item_id,output.rows[0].lot_no]);
    return {productionOrderId:req.params.id,additionalCost:add,totalCost:newTotal,unitCost:newTotal/qty};
   });return rep.code(201).send(out);
  }catch(e){return fail(rep,e);}
 });
 app.get('/api/v1/accounting/journals',auth(app,'ACCOUNTING.READ'),async(_q,rep)=>{
  try{return (await db.query(`SELECT j.*,COALESCE(json_agg(json_build_object('accountCode',a.code,'accountName',a.name_ar,'debit',l.debit,'credit',l.credit)) FILTER(WHERE l.id IS NOT NULL),'[]'::json) lines
   FROM journal_entries j LEFT JOIN journal_lines l ON l.journal_entry_id=j.id LEFT JOIN gl_accounts a ON a.id=l.account_id GROUP BY j.id ORDER BY j.entry_date DESC,j.entry_no DESC`)).rows;}catch(e){return fail(rep,e);}
 });
}
