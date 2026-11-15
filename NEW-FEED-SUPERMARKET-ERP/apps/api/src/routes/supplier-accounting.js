import {Router} from "express";
import {pool} from "../db.js";
import {requirePermission} from "../auth.js";

const router=Router();
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const txt=(v,n=100)=>typeof v==="string"&&v.trim().length>0&&v.trim().length<=n;
const num=v=>Number.isFinite(Number(v))&&Number(v)>0;
const permission=requirePermission("supplier.accounting");

router.get("/supplier-invoices",permission,async(req,res,next)=>{try{
 const r=await pool.query(`SELECT i.*,s.name supplier_name,po.reference_no purchase_order_reference,
   COALESCE(SUM(a.amount),0) paid_amount
   FROM supplier_invoices i JOIN suppliers s ON s.id=i.supplier_id
   JOIN purchase_orders po ON po.id=i.purchase_order_id
   LEFT JOIN supplier_payment_allocations a ON a.invoice_id=i.id
   GROUP BY i.id,s.name,po.reference_no ORDER BY i.created_at DESC LIMIT 300`);
 res.json({items:r.rows});
}catch(e){next(e);}});

router.post("/supplier-invoices",permission,async(req,res,next)=>{
 const {reference_no,supplier_invoice_no,supplier_id,purchase_order_id,invoice_date,due_date=null,lines}=req.body??{};
 if(!txt(reference_no,50)||!txt(supplier_invoice_no,100)||!uuid.test(supplier_id||"")||!uuid.test(purchase_order_id||"")||
   !/^\d{4}-\d{2}-\d{2}$/.test(invoice_date||"")||(due_date&&!/^\d{4}-\d{2}-\d{2}$/.test(due_date))||
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
  await c.query("COMMIT");res.json({invoice_id:req.params.id,status:"posted",invoice_total:invoiceTotal,grni_cleared:grniValue,price_variance:variance,journal_entry_id:je.rows[0].id});
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
 if(!txt(reference_no,50)||!uuid.test(supplier_id||"")||!uuid.test(payment_method_id||"")||!num(amount)||
   !/^\d{4}-\d{2}-\d{2}$/.test(payment_date||"")||!Array.isArray(allocations)||!allocations.length||allocations.length>300||
   allocations.some(x=>!uuid.test(x.invoice_id||"")||!num(x.amount))||
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
   const prior=await c.query("SELECT COALESCE(SUM(spa.amount),0) paid FROM supplier_payment_allocations spa JOIN supplier_payments sp ON sp.id=spa.payment_id WHERE spa.invoice_id=$1",[a.invoice_id]);
   const balance=Number(invoice.rows[0].subtotal)-Number(prior.rows[0].paid);
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

export default router;
