import {Router} from "express";
import {pool} from "../db.js";
import {requirePermission} from "../auth.js";

const router=Router();
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const txt=(v,n=100)=>typeof v==="string"&&v.trim().length>0&&v.trim().length<=n;
const num=v=>Number.isFinite(Number(v))&&Number(v)>0;
const permission=requirePermission("supplier.accounting");

router.get("/supplier-payment-methods",permission,async(_req,res,next)=>{try{const r=await pool.query("SELECT id,code,name_ar,account_id FROM payment_methods WHERE is_active=true AND account_id IS NOT NULL ORDER BY code");res.json({items:r.rows});}catch(e){next(e);}});

router.get("/supplier-invoices",permission,async(req,res,next)=>{try{
 const r=await pool.query(\`SELECT i.*,s.name supplier_name,po.reference_no purchase_order_reference,
   COALESCE((SELECT SUM(a.amount) FROM supplier_payment_allocations a JOIN supplier_payments p ON p.id=a.payment_id WHERE a.invoice_id=i.id AND p.status='posted'),0) paid_amount,
   COALESCE((SELECT SUM(ra.amount) FROM supplier_return_allocations ra JOIN supplier_returns sr ON sr.id=ra.return_id WHERE ra.invoice_id=i.id AND sr.status='posted'),0) credit_amount
   FROM supplier_invoices i JOIN suppliers s ON s.id=i.supplier_id
   JOIN purchase_orders po ON po.id=i.purchase_order_id
   ORDER BY i.created_at DESC LIMIT 300\`);
 res.json({items:r.rows});
}catch(e){next(e);}});

router.get("/supplier-invoice-eligible-lines/:receiptId",permission,async(req,res,next)=>{
 if(!uuid.test(req.params.receiptId))return res.status(400).json({error:"Invalid receipt id"});
 try{
  const receipt=await pool.query(`SELECT pr.id,pr.reference_no,pr.purchase_order_id,pr.inspection_status,
   prl.id receipt_line_id,prl.product_id,p.sku,p.name_ar,prl.accepted_quantity,prl.unit_cost,
   GREATEST(0,prl.accepted_quantity-COALESCE((SELECT SUM(sil.quantity) FROM supplier_invoice_lines sil
    JOIN supplier_invoices si ON si.id=sil.invoice_id WHERE sil.receipt_line_id=prl.id AND si.status='posted'),0)) remaining_quantity
   FROM purchase_receipts pr JOIN purchase_receipt_lines prl ON prl.receipt_id=pr.id
   JOIN products p ON p.id=prl.product_id
   WHERE pr.id=$1 AND pr.inspection_status='accepted' ORDER BY p.name_ar`,[req.params.receiptId]);
  if(!receipt.rowCount)return res.status(404).json({error:"Accepted receipt not found"});
  res.json({receipt:{id:receipt.rows[0].id,reference_no:receipt.rows[0].reference_no,purchase_order_id:receipt.rows[0].purchase_order_id},items:receipt.rows.filter(x=>Number(x.remaining_quantity)>0)});
 }catch(e){next(e);}
});

router.post("/supplier-invoices",permission,async(req,res,next)=>{
 const {reference_no,supplier_invoice_no,supplier_id,purchase_order_id,invoice_date,due_date=null,lines}=req.body??{};
 if(!txt(reference_no,50)||!txt(supplier_invoice_no,100)||!uuid.test(supplier_id||"")||!uuid.test(purchase_order_id||"")||
   !/^\d{4}-\d{2}-\d{2}$/.test(invoice_date||"")||(due_date&&(!/^\d{4}-\d{2}-\d{2}$/.test(due_date)||due_date<invoice_date))||
   !Array.isArray(lines)||!lines.length||lines.length>500||lines.some(x=>!uuid.test(x.receipt_line_id||"")||!num(x.quantity)||!Number.isFinite(Number(x.unit_price))||Number(x.unit_price)<0))
  return res.status(400).json({error:"Invalid supplier invoice fields"});
 const c=await pool.connect();
 try{
  await c.query("BEGIN");
  const po=await c.query("SELECT id,supplier_id FROM purchase_orders WHERE id=$1 FOR UPDATE",[purchase_order_id]);
  if(!po.rowCount||po.rows[0].supplier_id!==supplier_id)throw Object.assign(new Error("Purchase order does not belong to selected supplier"),{statusCode:409});
  const inv=await c.query(`INSERT INTO supplier_invoices(reference_no,supplier_invoice_no,supplier_id,purchase_order_id,invoice_date,due_date,created_by)
    VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *`,[reference_no.trim(),supplier_invoice_no.trim(),supplier_id,purchase_order_id,invoice_date,due_date,req.user.id]);
  let total=0;const seen=new Set();
  for(const line of lines){
   if(seen.has(line.receipt_line_id))throw Object.assign(new Error("Duplicate receipt line"),{statusCode:400});
   seen.add(line.receipt_line_id);
   const receipt=await c.query(`SELECT prl.id,prl.product_id,prl.quantity,prl.accepted_quantity,prl.unit_cost,pr.inspection_status,pr.purchase_order_id
    FROM purchase_receipt_lines prl JOIN purchase_receipts pr ON pr.id=prl.receipt_id
    WHERE prl.id=$1 FOR UPDATE OF prl`,[line.receipt_line_id]);
   if(!receipt.rowCount||receipt.rows[0].purchase_order_id!==purchase_order_id||receipt.rows[0].inspection_status!=="accepted")
    throw Object.assign(new Error("Invoice lines must reference accepted receipts from the selected purchase order"),{statusCode:409});
   const invoiced=await c.query(`SELECT COALESCE(SUM(sil.quantity),0) qty FROM supplier_invoice_lines sil
     JOIN supplier_invoices si ON si.id=sil.invoice_id WHERE sil.receipt_line_id=$1 AND si.status='posted'`,[line.receipt_line_id]);
   const remaining=Number(receipt.rows[0].accepted_quantity)-Number(invoiced.rows[0].qty);
   if(Number(line.quantity)>remaining+0.000001)throw Object.assign(new Error("Invoiced quantity exceeds accepted and uninvoiced receipt quantity"),{statusCode:409});
   const lineTotal=Number(line.quantity)*Number(line.unit_price);total+=lineTotal;
   await c.query("INSERT INTO supplier_invoice_lines(invoice_id,receipt_line_id,quantity,unit_price,line_total) VALUES($1,$2,$3,$4,$5)",[inv.rows[0].id,line.receipt_line_id,line.quantity,line.unit_price,lineTotal]);
  }
  await c.query("UPDATE supplier_invoices SET subtotal=$2 WHERE id=$1",[inv.rows[0].id,total]);
  await c.query("COMMIT");res.status(201).json({invoice:{...inv.rows[0],subtotal:total},line_count:lines.length});
 }catch(e){await c.query("ROLLBACK");if(e.statusCode)return res.status(e.statusCode).json({error:e.message});next(e);}finally{c.release();}
});

router.post("/supplier-invoices/:id/post",permission,async(req,res,next)=>{
 if(!uuid.test(req.params.id))return res.status(400).json({error:"Invalid supplier invoice id"});
 const c=await pool.connect();
 try{
  await c.query("BEGIN");
  const inv=await c.query("SELECT * FROM supplier_invoices WHERE id=$1 FOR UPDATE",[req.params.id]);
  if(!inv.rowCount||inv.rows[0].status!=="draft")throw Object.assign(new Error("Only draft supplier invoices can be posted"),{statusCode:409});
  const period=await c.query("SELECT 1 FROM accounting_periods WHERE status='closed' AND $1::date BETWEEN starts_on AND ends_on LIMIT 1",[inv.rows[0].invoice_date]);
  if(period.rowCount)throw Object.assign(new Error("Supplier invoice date belongs to a closed accounting period"),{statusCode:409});
  const lines=await c.query(`SELECT sil.*,prl.unit_cost,prl.accepted_quantity,pr.inspection_status,pr.purchase_order_id
   FROM supplier_invoice_lines sil JOIN purchase_receipt_lines prl ON prl.id=sil.receipt_line_id
   JOIN purchase_receipts pr ON pr.id=prl.receipt_id WHERE sil.invoice_id=$1 FOR UPDATE OF sil,prl`,[req.params.id]);
  if(!lines.rowCount)throw Object.assign(new Error("Supplier invoice has no lines"),{statusCode:409});
  const mappings=await c.query("SELECT mapping_key,account_id FROM system_account_mappings WHERE mapping_key=ANY($1::varchar[])",[["grni","supplier_payables","purchase_price_variance"]]);
  const map=Object.fromEntries(mappings.rows.map(x=>[x.mapping_key,x.account_id]));
  if(!map.grni||!map.supplier_payables||!map.purchase_price_variance)throw Object.assign(new Error("Supplier accounting mappings are missing"),{statusCode:409});
  let grniValue=0,invoiceTotal=0;
  for(const line of lines.rows){
   if(line.inspection_status!=="accepted"||line.purchase_order_id!==inv.rows[0].purchase_order_id)throw Object.assign(new Error("Only accepted receipt lines from the linked purchase order can be invoiced"),{statusCode:409});
   const already=await c.query("SELECT COALESCE(SUM(sil.quantity),0) qty FROM supplier_invoice_lines sil JOIN supplier_invoices si ON si.id=sil.invoice_id WHERE sil.receipt_line_id=$1 AND si.status='posted' AND si.id<>$2",[line.receipt_line_id,req.params.id]);
   if(Number(already.rows[0].qty)+Number(line.quantity)>Number(line.accepted_quantity)+0.000001)throw Object.assign(new Error("Invoice quantity exceeds accepted quantity"),{statusCode:409});
   grniValue+=Number(line.quantity)*Number(line.unit_cost);invoiceTotal+=Number(line.line_total);
  }
  const variance=invoiceTotal-grniValue;
  const je=await c.query("INSERT INTO journal_entries(reference_no,source_type,source_id,entry_date,status) VALUES($1,'supplier_invoice',$2,$3,'posted') RETURNING id",["JE-"+inv.rows[0].reference_no,req.params.id,inv.rows[0].invoice_date]);
  if(grniValue>0)await c.query("INSERT INTO journal_lines(journal_entry_id,account_id,debit,credit) VALUES($1,$2,$3,0)",[je.rows[0].id,map.grni,grniValue]);
  if(variance>0.000001)await c.query("INSERT INTO journal_lines(journal_entry_id,account_id,debit,credit) VALUES($1,$2,$3,0)",[je.rows[0].id,map.purchase_price_variance,variance]);
  if(variance< -0.000001)await c.query("INSERT INTO journal_lines(journal_entry_id,account_id,debit,credit) VALUES($1,$2,0,$3)",[je.rows[0].id,map.purchase_price_variance,-variance]);
  if(invoiceTotal>0)await c.query("INSERT INTO journal_lines(journal_entry_id,account_id,debit,credit) VALUES($1,$2,0,$3)",[je.rows[0].id,map.supplier_payables,invoiceTotal]);
  await c.query("UPDATE supplier_invoices SET status='posted',journal_entry_id=$2,posted_by=$3,posted_at=now() WHERE id=$1",[req.params.id,je.rows[0].id,req.user.id]);
  let remainingInvoiceBalance=invoiceTotal;
  const credits=await c.query("SELECT sr.id,sr.credit_total-COALESCE((SELECT SUM(ra.amount) FROM supplier_return_allocations ra WHERE ra.return_id=sr.id),0) remaining FROM supplier_returns sr WHERE sr.supplier_id=$1 AND sr.status='posted' AND sr.credit_total-COALESCE((SELECT SUM(ra.amount) FROM supplier_return_allocations ra WHERE ra.return_id=sr.id),0)>0.000001 ORDER BY sr.created_at FOR UPDATE",[inv.rows[0].supplier_id]);
  for(const credit of credits.rows){
   if(remainingInvoiceBalance<=0.000001)break;
   const allocation=Math.min(remainingInvoiceBalance,Number(credit.remaining));
   if(allocation>0.000001){await c.query("INSERT INTO supplier_return_allocations(return_id,invoice_id,amount) VALUES($1,$2,$3)",[credit.id,req.params.id,allocation]);remainingInvoiceBalance-=allocation;}
  }
  await c.query("COMMIT");res.json({invoice_id:req.params.id,status:"posted",invoice_total:invoiceTotal,grni_cleared:grniValue,price_variance:variance,supplier_credit_applied:invoiceTotal-remainingInvoiceBalance,journal_entry_id:je.rows[0].id});
 }catch(e){await c.query("ROLLBACK");if(e.statusCode)return res.status(e.statusCode).json({error:e.message});next(e);}finally{c.release();}
});

router.get("/supplier-payments",permission,async(_req,res,next)=>{try{
 const r=await pool.query(`SELECT p.*,s.name supplier_name,pm.name_ar payment_method_name,pb.name_ar bank_name
  FROM supplier_payments p JOIN suppliers s ON s.id=p.supplier_id
  JOIN payment_methods pm ON pm.id=p.payment_method_id LEFT JOIN payment_banks pb ON pb.id=p.bank_id
  ORDER BY p.payment_date DESC,p.created_at DESC LIMIT 300`);
 res.json({items:r.rows});
}catch(e){next(e);}});

router.post("/supplier-payments",permission,async(req,res,next)=>{
 const {reference_no,supplier_id,payment_method_id,amount,payment_date,payment_reference=null,bank_id=null,transaction_reference=null,card_last_four=null,allocations}=req.body??{};
 if(!txt(reference_no,50)||!uuid.test(supplier_id||"")||!uuid.test(payment_method_id||"")||!num(amount)||(payment_reference!==null&&!txt(payment_reference,120))||
   !/^\d{4}-\d{2}-\d{2}$/.test(payment_date||"")||!Array.isArray(allocations)||!allocations.length||allocations.length>300||
   allocations.some(x=>!uuid.test(x.invoice_id||"")||!num(x.amount))||new Set(allocations.map(x=>x.invoice_id)).size!==allocations.length||
   (bank_id&&!uuid.test(bank_id))||(transaction_reference&&!txt(transaction_reference,120))||
   (card_last_four!==null&&!/^[0-9]{4}$/.test(String(card_last_four))))
  return res.status(400).json({error:"Invalid supplier payment fields"});
 const allocationTotal=allocations.reduce((s,x)=>s+Number(x.amount),0);
 if(Math.abs(allocationTotal-Number(amount))>0.01)return res.status(400).json({error:"Payment allocations must equal payment amount"});
 const c=await pool.connect();
 try{
  await c.query("BEGIN");
  const period=await c.query("SELECT 1 FROM accounting_periods WHERE status='closed' AND $1::date BETWEEN starts_on AND ends_on LIMIT 1",[payment_date]);
  if(period.rowCount)throw Object.assign(new Error("Payment date belongs to a closed accounting period"),{statusCode:409});
  const method=await c.query("SELECT id,code,name_ar,account_id FROM payment_methods WHERE id=$1 AND is_active=true",[payment_method_id]);
  if(!method.rowCount||!method.rows[0].account_id)throw Object.assign(new Error("Payment method has no active ledger account mapping"),{statusCode:409});
  const isCard=/card|visa|بطاقة|فيزا/i.test(method.rows[0].code+" "+method.rows[0].name_ar);
  if(isCard){
   if(!uuid.test(bank_id||"")||!txt(transaction_reference,120)||!/^[0-9]{4}$/.test(String(card_last_four||"")))throw Object.assign(new Error("Card settlement requires bank, transaction reference and last four digits"),{statusCode:400});
   const bank=await c.query("SELECT id FROM payment_banks WHERE id=$1 AND is_active=true",[bank_id]);if(!bank.rowCount)throw Object.assign(new Error("Selected bank is inactive"),{statusCode:400});
  }
  const pay=await c.query("INSERT INTO supplier_payments(reference_no,supplier_id,payment_method_id,amount,payment_date,payment_reference,bank_id,transaction_reference,card_last_four,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *",[reference_no.trim(),supplier_id,payment_method_id,amount,payment_date,payment_reference,isCard?bank_id:null,isCard?transaction_reference:null,isCard?card_last_four:null,req.user.id]);
  let allocated=0;
  for(const a of allocations){
   const invoice=await c.query("SELECT id,supplier_id,subtotal,status FROM supplier_invoices WHERE id=$1 FOR UPDATE",[a.invoice_id]);
   if(!invoice.rowCount||invoice.rows[0].supplier_id!==supplier_id||invoice.rows[0].status!=="posted")throw Object.assign(new Error("Allocations must target posted invoices of the selected supplier"),{statusCode:409});
   const prior=await c.query("SELECT (SELECT COALESCE(SUM(spa.amount),0) FROM supplier_payment_allocations spa JOIN supplier_payments sp ON sp.id=spa.payment_id WHERE spa.invoice_id=$1 AND sp.status='posted') paid,(SELECT COALESCE(SUM(ra.amount),0) FROM supplier_return_allocations ra JOIN supplier_returns sr ON sr.id=ra.return_id WHERE ra.invoice_id=$1 AND sr.status='posted') credits",[a.invoice_id]);
   const balance=Number(invoice.rows[0].subtotal)-Number(prior.rows[0].paid)-Number(prior.rows[0].credits);
   if(Number(a.amount)>balance+0.000001)throw Object.assign(new Error("Allocation exceeds invoice outstanding balance"),{statusCode:409});
   await c.query("INSERT INTO supplier_payment_allocations(payment_id,invoice_id,amount) VALUES($1,$2,$3)",[pay.rows[0].id,a.invoice_id,a.amount]);
   allocated+=Number(a.amount);
  }
  const je=await c.query("INSERT INTO journal_entries(reference_no,source_type,source_id,entry_date,status) VALUES($1,'supplier_payment',$2,$3,'posted') RETURNING id",["JEP-"+reference_no.trim(),pay.rows[0].id,payment_date]);
  const payable=await c.query("SELECT account_id FROM system_account_mappings WHERE mapping_key='supplier_payables'");
  if(!payable.rowCount)throw Object.assign(new Error("Supplier payable mapping is missing"),{statusCode:409});
  await c.query("INSERT INTO journal_lines(journal_entry_id,account_id,debit,credit) VALUES($1,$2,$3,0)",[je.rows[0].id,payable.rows[0].account_id,amount]);
  await c.query("INSERT INTO journal_lines(journal_entry_id,account_id,debit,credit) VALUES($1,$2,0,$3)",[je.rows[0].id,method.rows[0].account_id,amount]);
  await c.query("UPDATE supplier_payments SET journal_entry_id=$2 WHERE id=$1",[pay.rows[0].id,je.rows[0].id]);
  await c.query("COMMIT");res.status(201).json({payment:pay.rows[0],allocated_amount:allocated,journal_entry_id:je.rows[0].id});
 }catch(e){await c.query("ROLLBACK");if(e.statusCode)return res.status(e.statusCode).json({error:e.message});next(e);}finally{c.release();}
});


router.get("/supplier-account-statement/:supplierId",permission,async(req,res,next)=>{
 if(!uuid.test(req.params.supplierId))return res.status(400).json({error:"Invalid supplier id"});
 try{
  const supplier=await pool.query("SELECT id,code,name FROM suppliers WHERE id=$1",[req.params.supplierId]);
  if(!supplier.rowCount)return res.status(404).json({error:"Supplier not found"});
  const invoices=await pool.query("SELECT i.id,i.reference_no,i.supplier_invoice_no,i.invoice_date,i.due_date,i.subtotal,COALESCE((SELECT SUM(a.amount) FROM supplier_payment_allocations a JOIN supplier_payments p ON p.id=a.payment_id WHERE a.invoice_id=i.id AND p.status='posted'),0) paid_amount,COALESCE((SELECT SUM(ra.amount) FROM supplier_return_allocations ra JOIN supplier_returns sr ON sr.id=ra.return_id WHERE ra.invoice_id=i.id AND sr.status='posted'),0) credit_amount FROM supplier_invoices i WHERE i.supplier_id=$1 AND i.status='posted' ORDER BY i.invoice_date,i.created_at",[req.params.supplierId]);
  const payments=await pool.query("SELECT id,reference_no,payment_date,amount,payment_method_id,payment_reference,status FROM supplier_payments WHERE supplier_id=$1 ORDER BY payment_date,created_at",[req.params.supplierId]);
  const totals=await pool.query("SELECT (SELECT COALESCE(SUM(subtotal),0) FROM supplier_invoices WHERE supplier_id=$1 AND status='posted') invoiced,(SELECT COALESCE(SUM(a.amount),0) FROM supplier_payment_allocations a JOIN supplier_payments p ON p.id=a.payment_id JOIN supplier_invoices i ON i.id=a.invoice_id WHERE i.supplier_id=$1 AND i.status='posted' AND p.status='posted') paid,(SELECT COALESCE(SUM(ra.amount),0) FROM supplier_return_allocations ra JOIN supplier_returns sr ON sr.id=ra.return_id JOIN supplier_invoices i ON i.id=ra.invoice_id WHERE i.supplier_id=$1 AND i.status='posted' AND sr.status='posted') credits,(SELECT COALESCE(SUM(credit_total),0) FROM supplier_returns WHERE supplier_id=$1 AND status='posted') total_return_credit FROM suppliers WHERE id=$1",[req.params.supplierId]);
  const t=totals.rows[0];
  res.json({supplier:supplier.rows[0],invoices:invoices.rows,payments:payments.rows,totals:{...t,outstanding:Number(t.invoiced)-Number(t.paid)-Number(t.credits),unallocated_credit:Number(t.total_return_credit)-Number(t.credits)}});
 }catch(e){next(e);}
});

router.get("/supplier-aging",permission,async(req,res,next)=>{
 const asOf=req.query.as_of||new Date().toISOString().slice(0,10);
 if(!/^\d{4}-\d{2}-\d{2}$/.test(asOf))return res.status(400).json({error:"Invalid as_of date"});
 try{
  const r=await pool.query("WITH balances AS (SELECT i.id,i.supplier_id,COALESCE(i.due_date,i.invoice_date) due_date,i.subtotal-COALESCE((SELECT SUM(a.amount) FROM supplier_payment_allocations a JOIN supplier_payments p ON p.id=a.payment_id WHERE a.invoice_id=i.id AND p.status='posted'),0)-COALESCE((SELECT SUM(ra.amount) FROM supplier_return_allocations ra JOIN supplier_returns sr ON sr.id=ra.return_id WHERE ra.invoice_id=i.id AND sr.status='posted'),0) balance FROM supplier_invoices i WHERE i.status='posted' AND i.invoice_date<=$1::date) SELECT s.id supplier_id,s.code supplier_code,s.name supplier_name,COALESCE(SUM(b.balance),0) total_due,COALESCE(SUM(b.balance) FILTER(WHERE b.due_date >= $1::date),0) current_due,COALESCE(SUM(b.balance) FILTER(WHERE $1::date-b.due_date BETWEEN 1 AND 30),0) days_1_30,COALESCE(SUM(b.balance) FILTER(WHERE $1::date-b.due_date BETWEEN 31 AND 60),0) days_31_60,COALESCE(SUM(b.balance) FILTER(WHERE $1::date-b.due_date BETWEEN 61 AND 90),0) days_61_90,COALESCE(SUM(b.balance) FILTER(WHERE $1::date-b.due_date>90),0) over_90 FROM suppliers s LEFT JOIN balances b ON b.supplier_id=s.id GROUP BY s.id ORDER BY total_due DESC,s.name",[asOf]);
  res.json({as_of:asOf,items:r.rows,totals:r.rows.reduce((a,x)=>{for(const k of ["total_due","current_due","days_1_30","days_31_60","days_61_90","over_90"])a[k]=(a[k]||0)+Number(x[k]);return a;},{})});
 }catch(e){next(e);}
});

router.post("/supplier-invoices/:id/void",permission,async(req,res,next)=>{
 const {reason}=req.body??{};
 if(!uuid.test(req.params.id)||!txt(reason,1000))return res.status(400).json({error:"A cancellation reason is required"});
 const c=await pool.connect();
 try{
  await c.query("BEGIN");
  const inv=await c.query("SELECT * FROM supplier_invoices WHERE id=$1 FOR UPDATE",[req.params.id]);
  if(!inv.rowCount||inv.rows[0].status!=="posted")throw Object.assign(new Error("Only posted supplier invoices can be voided"),{statusCode:409});
  const allocated=await c.query("SELECT (SELECT COALESCE(SUM(a.amount),0) FROM supplier_payment_allocations a JOIN supplier_payments p ON p.id=a.payment_id WHERE a.invoice_id=$1 AND p.status='posted') paid,(SELECT COALESCE(SUM(ra.amount),0) FROM supplier_return_allocations ra JOIN supplier_returns sr ON sr.id=ra.return_id WHERE ra.invoice_id=$1 AND sr.status='posted') credits",[req.params.id]);
  if(Number(allocated.rows[0].paid)+Number(allocated.rows[0].credits)>0.000001)throw Object.assign(new Error("Reverse posted payments and supplier credit allocations before voiding this invoice"),{statusCode:409});
  const period=await c.query("SELECT 1 FROM accounting_periods WHERE status='closed' AND CURRENT_DATE BETWEEN starts_on AND ends_on LIMIT 1");
  if(period.rowCount)throw Object.assign(new Error("The current accounting period is closed"),{statusCode:409});
  const original=await c.query("SELECT id FROM journal_entries WHERE id=$1 AND status='posted' FOR UPDATE",[inv.rows[0].journal_entry_id]);
  if(!original.rowCount)throw Object.assign(new Error("Original posted journal entry not found"),{statusCode:409});
  const reversal=await c.query("INSERT INTO journal_entries(reference_no,source_type,source_id,entry_date,status) VALUES($1,'supplier_invoice_void',$2,CURRENT_DATE,'posted') RETURNING id",["VOID-INV-"+inv.rows[0].reference_no,req.params.id]);
  await c.query("INSERT INTO journal_lines(journal_entry_id,account_id,debit,credit) SELECT $1,account_id,credit,debit FROM journal_lines WHERE journal_entry_id=$2",[reversal.rows[0].id,original.rows[0].id]);
  await c.query("UPDATE journal_entries SET status='reversed' WHERE id=$1",[original.rows[0].id]);
  await c.query("UPDATE supplier_invoices SET status='voided' WHERE id=$1",[req.params.id]);
  await c.query("COMMIT");res.json({invoice_id:req.params.id,status:"voided",reversal_journal_id:reversal.rows[0].id,reason:reason.trim()});
 }catch(e){await c.query("ROLLBACK");if(e.statusCode)return res.status(e.statusCode).json({error:e.message});next(e);}finally{c.release();}
});

router.post("/supplier-payments/:id/void",permission,async(req,res,next)=>{
 const {reason,settlement_reversed=false}=req.body??{};
 if(!uuid.test(req.params.id)||!txt(reason,1000)||settlement_reversed!==true)return res.status(400).json({error:"A reason and confirmation that the payment was actually reversed are required"});
 const c=await pool.connect();
 try{
  await c.query("BEGIN");
  const payment=await c.query("SELECT * FROM supplier_payments WHERE id=$1 FOR UPDATE",[req.params.id]);
  if(!payment.rowCount||payment.rows[0].status!=="posted")throw Object.assign(new Error("Only posted supplier payments can be reversed"),{statusCode:409});
  const period=await c.query("SELECT 1 FROM accounting_periods WHERE status='closed' AND CURRENT_DATE BETWEEN starts_on AND ends_on LIMIT 1");
  if(period.rowCount)throw Object.assign(new Error("The current accounting period is closed"),{statusCode:409});
  const original=await c.query("SELECT id FROM journal_entries WHERE id=$1 AND status='posted' FOR UPDATE",[payment.rows[0].journal_entry_id]);
  if(!original.rowCount)throw Object.assign(new Error("Original posted journal entry not found"),{statusCode:409});
  const reversal=await c.query("INSERT INTO journal_entries(reference_no,source_type,source_id,entry_date,status) VALUES($1,'supplier_payment_void',$2,CURRENT_DATE,'posted') RETURNING id",["VOID-PAY-"+payment.rows[0].reference_no,req.params.id]);
  await c.query("INSERT INTO journal_lines(journal_entry_id,account_id,debit,credit) SELECT $1,account_id,credit,debit FROM journal_lines WHERE journal_entry_id=$2",[reversal.rows[0].id,original.rows[0].id]);
  await c.query("UPDATE journal_entries SET status='reversed' WHERE id=$1",[original.rows[0].id]);
  await c.query("UPDATE supplier_payments SET status='voided',void_reason=$2,voided_by=$3,voided_at=now() WHERE id=$1",[req.params.id,reason.trim(),req.user.id]);
  await c.query("COMMIT");res.json({payment_id:req.params.id,status:"voided",reversal_journal_id:reversal.rows[0].id,reason:reason.trim()});
 }catch(e){await c.query("ROLLBACK");if(e.statusCode)return res.status(e.statusCode).json({error:e.message});next(e);}finally{c.release();}
});


router.get("/supplier-return-eligible-lines/:receiptId",permission,async(req,res,next)=>{
 if(!uuid.test(req.params.receiptId))return res.status(400).json({error:"Invalid receipt id"});
 try{
  const r=await pool.query("SELECT pr.id receipt_id,pr.reference_no receipt_reference,pr.purchase_order_id,po.supplier_id,prl.id receipt_line_id,prl.product_id,p.sku,p.name_ar,prl.accepted_quantity,prl.unit_cost,sl.id stock_lot_id,sl.quantity_on_hand-GREATEST(0,COALESCE((SELECT SUM(CASE WHEN sr.status='draft' THEN srl.requested_quantity ELSE srl.accepted_quantity END) FROM supplier_return_lines srl JOIN supplier_returns sr ON sr.id=srl.return_id WHERE srl.receipt_line_id=prl.id AND sr.status IN ('draft','inspected')),0)) available_quantity FROM purchase_receipts pr JOIN purchase_orders po ON po.id=pr.purchase_order_id JOIN purchase_receipt_lines prl ON prl.receipt_id=pr.id JOIN products p ON p.id=prl.product_id JOIN stock_lots sl ON sl.id=prl.stock_lot_id WHERE pr.id=$1 AND pr.inspection_status='accepted' ORDER BY p.name_ar",[req.params.receiptId]);
  if(!r.rowCount)return res.status(404).json({error:"Accepted receipt or stock lots not found"});
  res.json({receipt:{id:r.rows[0].receipt_id,reference_no:r.rows[0].receipt_reference,purchase_order_id:r.rows[0].purchase_order_id,supplier_id:r.rows[0].supplier_id},items:r.rows.filter(x=>Number(x.available_quantity)>0)});
 }catch(e){next(e);}
});

router.get("/supplier-returns",permission,async(_req,res,next)=>{try{
 const r=await pool.query("SELECT sr.*,s.name supplier_name,po.reference_no purchase_order_reference,pr.reference_no receipt_reference FROM supplier_returns sr JOIN suppliers s ON s.id=sr.supplier_id JOIN purchase_orders po ON po.id=sr.purchase_order_id JOIN purchase_receipts pr ON pr.id=sr.purchase_receipt_id ORDER BY sr.created_at DESC LIMIT 300");
 res.json({items:r.rows});
}catch(e){next(e);}});

router.get("/supplier-returns/:id",permission,async(req,res,next)=>{
 if(!uuid.test(req.params.id))return res.status(400).json({error:"Invalid supplier return id"});
 try{
  const header=await pool.query("SELECT * FROM supplier_returns WHERE id=$1",[req.params.id]);
  if(!header.rowCount)return res.status(404).json({error:"Supplier return not found"});
  const lines=await pool.query("SELECT srl.*,p.sku,p.name_ar product_name FROM supplier_return_lines srl JOIN products p ON p.id=srl.product_id WHERE srl.return_id=$1 ORDER BY p.name_ar",[req.params.id]);
  res.json({supplier_return:header.rows[0],lines:lines.rows});
 }catch(e){next(e);}
});

router.post("/supplier-returns",permission,async(req,res,next)=>{
 const {reference_no,supplier_id,purchase_receipt_id,reason,lines}=req.body??{};
 if(!txt(reference_no,50)||!uuid.test(supplier_id||"")||!uuid.test(purchase_receipt_id||"")||!txt(reason,1000)||!Array.isArray(lines)||!lines.length||lines.length>300||lines.some(x=>!uuid.test(x.receipt_line_id||"")||!num(x.quantity)||!Number.isFinite(Number(x.credit_unit_price))||Number(x.credit_unit_price)<0)||new Set(lines.map(x=>x.receipt_line_id)).size!==lines.length)
  return res.status(400).json({error:"Invalid supplier return fields"});
 const c=await pool.connect();
 try{
  await c.query("BEGIN");
  const receipt=await c.query("SELECT pr.id,pr.purchase_order_id,pr.inspection_status,po.supplier_id FROM purchase_receipts pr JOIN purchase_orders po ON po.id=pr.purchase_order_id WHERE pr.id=$1 FOR UPDATE OF pr",[purchase_receipt_id]);
  if(!receipt.rowCount||receipt.rows[0].inspection_status!=="accepted"||receipt.rows[0].supplier_id!==supplier_id)throw Object.assign(new Error("Return must reference an accepted receipt for the selected supplier"),{statusCode:409});
  const ret=await c.query("INSERT INTO supplier_returns(reference_no,supplier_id,purchase_order_id,purchase_receipt_id,reason,requested_by) VALUES($1,$2,$3,$4,$5,$6) RETURNING *",[reference_no.trim(),supplier_id,receipt.rows[0].purchase_order_id,purchase_receipt_id,reason.trim(),req.user.id]);
  for(const line of lines){
   const source=await c.query("SELECT prl.id,prl.product_id,prl.stock_lot_id,prl.accepted_quantity,pr.inspection_status,sl.quantity_on_hand,sl.unit_cost FROM purchase_receipt_lines prl JOIN purchase_receipts pr ON pr.id=prl.receipt_id JOIN stock_lots sl ON sl.id=prl.stock_lot_id WHERE prl.id=$1 AND pr.id=$2 FOR UPDATE OF prl,sl",[line.receipt_line_id,purchase_receipt_id]);
   if(!source.rowCount||source.rows[0].inspection_status!=="accepted"||!source.rows[0].stock_lot_id)throw Object.assign(new Error("Return line is not linked to an accepted stock lot"),{statusCode:409});
   const already=await c.query("SELECT COALESCE(SUM(CASE WHEN sr.status='draft' THEN srl.requested_quantity ELSE srl.accepted_quantity END),0) qty FROM supplier_return_lines srl JOIN supplier_returns sr ON sr.id=srl.return_id WHERE srl.receipt_line_id=$1 AND sr.status IN ('draft','inspected')",[line.receipt_line_id]);
   if(Number(line.quantity)>Number(source.rows[0].quantity_on_hand)-Number(already.rows[0].qty)+0.000001)throw Object.assign(new Error("Requested return quantity exceeds available stock"),{statusCode:409});
   await c.query("INSERT INTO supplier_return_lines(return_id,receipt_line_id,stock_lot_id,product_id,requested_quantity,unit_cost,credit_unit_price) VALUES($1,$2,$3,$4,$5,$6,$7)",[ret.rows[0].id,line.receipt_line_id,source.rows[0].stock_lot_id,source.rows[0].product_id,line.quantity,source.rows[0].unit_cost,line.credit_unit_price]);
  }
  await c.query("COMMIT");res.status(201).json({supplier_return:ret.rows[0],line_count:lines.length});
 }catch(e){await c.query("ROLLBACK");if(e.statusCode)return res.status(e.statusCode).json({error:e.message});next(e);}finally{c.release();}
});

router.post("/supplier-returns/:id/inspect",requirePermission("inventory.manage"),async(req,res,next)=>{
 if(!uuid.test(req.params.id)||!Array.isArray(req.body?.lines)||!req.body.lines.length)return res.status(400).json({error:"Inspection lines are required"});
 const seen=new Set();
 for(const line of req.body.lines){
  if(!line||!uuid.test(line.id||"")||!Number.isFinite(Number(line.accepted_quantity))||Number(line.accepted_quantity)<0||!Number.isFinite(Number(line.rejected_quantity))||Number(line.rejected_quantity)<0||seen.has(line.id))return res.status(400).json({error:"Invalid supplier return inspection quantities"});
  seen.add(line.id);
 }
 const c=await pool.connect();
 try{
  await c.query("BEGIN");
  const ret=await c.query("SELECT * FROM supplier_returns WHERE id=$1 FOR UPDATE",[req.params.id]);
  if(!ret.rowCount||ret.rows[0].status!=="draft")throw Object.assign(new Error("Only draft supplier returns can be inspected"),{statusCode:409});
  const stored=await c.query("SELECT id,requested_quantity FROM supplier_return_lines WHERE return_id=$1 FOR UPDATE",[req.params.id]);
  if(stored.rowCount!==req.body.lines.length||stored.rows.some(x=>!req.body.lines.some(y=>y.id===x.id)))throw Object.assign(new Error("Inspection must include every return line exactly once"),{statusCode:400});
  let acceptedTotal=0;
  for(const line of req.body.lines){
   const original=stored.rows.find(x=>x.id===line.id);
   if(Math.abs(Number(line.accepted_quantity)+Number(line.rejected_quantity)-Number(original.requested_quantity))>0.000001)throw Object.assign(new Error("Accepted and rejected quantities must equal the requested quantity"),{statusCode:400});
   acceptedTotal+=Number(line.accepted_quantity);
   await c.query("UPDATE supplier_return_lines SET accepted_quantity=$2,rejected_quantity=$3,notes=$4 WHERE id=$1",[line.id,line.accepted_quantity,line.rejected_quantity,typeof line.notes==="string"?line.notes.slice(0,500):null]);
  }
  const status=acceptedTotal>0?"inspected":"rejected";
  await c.query("UPDATE supplier_returns SET status=$2,inspected_by=$3,inspected_at=now() WHERE id=$1",[req.params.id,status,req.user.id]);
  await c.query("COMMIT");res.json({supplier_return_id:req.params.id,status,accepted_quantity:acceptedTotal});
 }catch(e){await c.query("ROLLBACK");if(e.statusCode)return res.status(e.statusCode).json({error:e.message});next(e);}finally{c.release();}
});

router.post("/supplier-returns/:id/post",permission,async(req,res,next)=>{
 if(!uuid.test(req.params.id))return res.status(400).json({error:"Invalid supplier return id"});
 const c=await pool.connect();
 try{
  await c.query("BEGIN");
  const ret=await c.query("SELECT * FROM supplier_returns WHERE id=$1 FOR UPDATE",[req.params.id]);
  if(!ret.rowCount||ret.rows[0].status!=="inspected")throw Object.assign(new Error("Only inspected supplier returns can be posted"),{statusCode:409});
  const period=await c.query("SELECT 1 FROM accounting_periods WHERE status='closed' AND CURRENT_DATE BETWEEN starts_on AND ends_on LIMIT 1");
  if(period.rowCount)throw Object.assign(new Error("The current accounting period is closed"),{statusCode:409});
  const lines=await c.query("SELECT * FROM supplier_return_lines WHERE return_id=$1 AND accepted_quantity>0 FOR UPDATE",[req.params.id]);
  if(!lines.rowCount)throw Object.assign(new Error("No accepted return quantities to post"),{statusCode:409});
  const maps=await c.query("SELECT mapping_key,account_id FROM system_account_mappings WHERE mapping_key=ANY($1::varchar[])",[["inventory","supplier_payables","purchase_price_variance"]]);
  const map=Object.fromEntries(maps.rows.map(x=>[x.mapping_key,x.account_id]));
  if(!map.inventory||!map.supplier_payables||!map.purchase_price_variance)throw Object.assign(new Error("Supplier return accounting mappings are missing"),{statusCode:409});
  let inventoryCost=0,creditTotal=0;
  for(const line of lines.rows){
   const lot=await c.query("SELECT quantity_on_hand FROM stock_lots WHERE id=$1 FOR UPDATE",[line.stock_lot_id]);
   if(!lot.rowCount||Number(lot.rows[0].quantity_on_hand)+0.000001<Number(line.accepted_quantity))throw Object.assign(new Error("Insufficient remaining stock in the original receipt lot"),{statusCode:409});
   const cost=Number(line.accepted_quantity)*Number(line.unit_cost),credit=Number(line.accepted_quantity)*Number(line.credit_unit_price);
   inventoryCost+=cost;creditTotal+=credit;
   await c.query("UPDATE stock_lots SET quantity_on_hand=quantity_on_hand-$2 WHERE id=$1",[line.stock_lot_id,line.accepted_quantity]);
   await c.query("INSERT INTO stock_movements(reference_no,movement_type,product_id,warehouse_id,lot_id,quantity_out,unit_cost,source_type,source_id,created_by) SELECT $1,'adjustment',$2,warehouse_id,$3,$4,$5,'supplier_return',$6,$7 FROM stock_lots WHERE id=$3",["SRET-"+ret.rows[0].reference_no,line.product_id,line.stock_lot_id,line.accepted_quantity,line.unit_cost,req.params.id,req.user.id]);
  }
  const variance=inventoryCost-creditTotal;
  const je=await c.query("INSERT INTO journal_entries(reference_no,source_type,source_id,entry_date,status) VALUES($1,'supplier_return',$2,CURRENT_DATE,'posted') RETURNING id",["SRET-JE-"+ret.rows[0].reference_no,req.params.id]);
  if(creditTotal>0)await c.query("INSERT INTO journal_lines(journal_entry_id,account_id,debit,credit) VALUES($1,$2,$3,0)",[je.rows[0].id,map.supplier_payables,creditTotal]);
  if(inventoryCost>0)await c.query("INSERT INTO journal_lines(journal_entry_id,account_id,debit,credit) VALUES($1,$2,0,$3)",[je.rows[0].id,map.inventory,inventoryCost]);
  if(variance>0.000001)await c.query("INSERT INTO journal_lines(journal_entry_id,account_id,debit,credit) VALUES($1,$2,$3,0)",[je.rows[0].id,map.purchase_price_variance,variance]);
  if(variance< -0.000001)await c.query("INSERT INTO journal_lines(journal_entry_id,account_id,debit,credit) VALUES($1,$2,0,$3)",[je.rows[0].id,map.purchase_price_variance,-variance]);
  await c.query("UPDATE supplier_returns SET status='posted',credit_total=$2,inventory_cost_total=$3,journal_entry_id=$4,posted_by=$5,posted_at=now() WHERE id=$1",[req.params.id,creditTotal,inventoryCost,je.rows[0].id,req.user.id]);
  let remainingCredit=creditTotal;
  const invoices=await c.query("SELECT i.id,i.subtotal,COALESCE((SELECT SUM(a.amount) FROM supplier_payment_allocations a JOIN supplier_payments p ON p.id=a.payment_id WHERE a.invoice_id=i.id AND p.status='posted'),0) paid,COALESCE((SELECT SUM(ra.amount) FROM supplier_return_allocations ra JOIN supplier_returns sr ON sr.id=ra.return_id WHERE ra.invoice_id=i.id AND sr.status='posted'),0) credits FROM supplier_invoices i WHERE i.supplier_id=$1 AND i.status='posted' ORDER BY COALESCE(i.due_date,i.invoice_date),i.invoice_date FOR UPDATE",[ret.rows[0].supplier_id]);
  for(const invoice of invoices.rows){
   if(remainingCredit<=0.000001)break;
   const balance=Math.max(0,Number(invoice.subtotal)-Number(invoice.paid)-Number(invoice.credits));
   const allocation=Math.min(balance,remainingCredit);
   if(allocation>0.000001){await c.query("INSERT INTO supplier_return_allocations(return_id,invoice_id,amount) VALUES($1,$2,$3)",[req.params.id,invoice.id,allocation]);remainingCredit-=allocation;}
  }
  await c.query("COMMIT");res.json({supplier_return_id:req.params.id,status:"posted",credit_total:creditTotal,inventory_cost_total:inventoryCost,unallocated_supplier_credit:remainingCredit,journal_entry_id:je.rows[0].id});
 }catch(e){await c.query("ROLLBACK");if(e.statusCode)return res.status(e.statusCode).json({error:e.message});next(e);}finally{c.release();}
});

export default router;
