import {Router} from "express";
import {pool} from "../db.js";
import {requirePermission} from "../auth.js";
const router=Router();
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const validRef=v=>typeof v==="string"&&v.trim().length>0&&v.trim().length<=50;
router.get("/sales/discount-settings",async(_req,res,next)=>{
 try{
  const r=await pool.query("SELECT * FROM sales_discount_settings WHERE is_active=true ORDER BY updated_at DESC LIMIT 1");
  res.json({settings:r.rows[0]||{min_order_amount:0,order_discount_type:"percent",order_discount_value:0,delivery_min_order_amount:0,delivery_discount_type:"percent",delivery_discount_value:0,is_active:true}});
 }catch(e){next(e);}
});
router.put("/sales/discount-settings",requirePermission("sales.discount.manage"),async(req,res,next)=>{
 const {min_order_amount=0,order_discount_type="percent",order_discount_value=0,delivery_min_order_amount=0,delivery_discount_type="percent",delivery_discount_value=0}=req.body??{};
 const validNum=v=>Number.isFinite(Number(v))&&Number(v)>=0;
 if(!validNum(min_order_amount)||!validNum(order_discount_value)||!validNum(delivery_min_order_amount)||!validNum(delivery_discount_value)||
   !["amount","percent"].includes(order_discount_type)||!["amount","percent"].includes(delivery_discount_type)||
   (order_discount_type==="percent"&&Number(order_discount_value)>100)||(delivery_discount_type==="percent"&&Number(delivery_discount_value)>100))
  return res.status(400).json({error:"Invalid discount thresholds or values"});
 const client=await pool.connect();
 try{
  await client.query("BEGIN");
  await client.query("UPDATE sales_discount_settings SET is_active=false WHERE is_active=true");
  const r=await client.query(`INSERT INTO sales_discount_settings(min_order_amount,order_discount_type,order_discount_value,delivery_min_order_amount,delivery_discount_type,delivery_discount_value,is_active,updated_by)
   VALUES($1,$2,$3,$4,$5,$6,true,$7) RETURNING *`,
   [min_order_amount,order_discount_type,order_discount_value,delivery_min_order_amount,delivery_discount_type,delivery_discount_value,req.user.id]);
  await client.query("COMMIT");res.json({settings:r.rows[0]});
 }catch(e){await client.query("ROLLBACK");next(e);}finally{client.release();}
});
router.get("/sales/:id/payments",async(req,res,next)=>{if(!uuid.test(req.params.id))return res.status(400).json({error:"Invalid sale id"});try{const r=await pool.query(`SELECT sp.id,sp.amount,sp.reference_text,sp.transaction_reference,sp.card_last_four,sp.terminal_amount,sp.terminal_captured_at,pm.code payment_method_code,pm.name_ar payment_method_name,pb.name_ar bank_name_ar,pb.name_en bank_name_en FROM sale_payments sp JOIN payment_methods pm ON pm.id=sp.payment_method_id LEFT JOIN payment_banks pb ON pb.id=sp.bank_id WHERE sp.sale_id=$1 ORDER BY sp.id`,[req.params.id]);res.json({items:r.rows});}catch(e){next(e);}});
router.get("/sales",async(_q,res,next)=>{try{const r=await pool.query("SELECT s.*,c.name customer_name,u.display_name cashier_name FROM sales s LEFT JOIN customers c ON c.id=s.customer_id JOIN users u ON u.id=s.cashier_id ORDER BY s.created_at DESC LIMIT 300");res.json({items:r.rows});}catch(e){next(e);}});
router.post("/sales/complete",async(req,res,next)=>{
 const {reference_no,branch_id,customer_id=null,lines,payments,idempotency_key=null,delivery=null}=req.body??{};
 const cashier_id=req.user.id;
 const deliveryCustomerId=delivery?.customer_id||customer_id;
 const deliveryValid=delivery===null||(delivery&&uuid.test(deliveryCustomerId||"")&&typeof delivery.address==="string"&&delivery.address.trim().length>0&&delivery.address.trim().length<=1000&&Number.isFinite(Number(delivery.delivery_fee||0))&&Number(delivery.delivery_fee||0)>=0&&["pos","phone","talabat","elmenus","breadfast","mrsool","generic"].includes(delivery.source_channel||"pos")&&(!delivery.external_order_reference||(typeof delivery.external_order_reference==="string"&&delivery.external_order_reference.length<=160)));
 if(!deliveryValid)return res.status(400).json({error:"Invalid delivery details"});
 if(!validRef(reference_no)||!uuid.test(branch_id||"")||!uuid.test(cashier_id||"")||(customer_id&&!uuid.test(customer_id))||
 !Array.isArray(lines)||!lines.length||lines.length>200||lines.some(x=>!uuid.test(x.product_id||"")||!uuid.test(x.unit_id||"")||!Number.isFinite(Number(x.quantity))||Number(x.quantity)<=0||!Number.isFinite(Number(x.unit_price))||Number(x.unit_price)<0||!Number.isFinite(Number(x.discount_amount||0))||Number(x.discount_amount||0)<0)||
 !Array.isArray(payments)||!payments.length||payments.some(x=>!uuid.test(x.payment_method_id||"")||!Number.isFinite(Number(x.amount))||Number(x.amount)<=0))
 return res.status(400).json({error:"Invalid sale fields"});
 const client=await pool.connect();
 try{
  await client.query("BEGIN");
  if(idempotency_key){const prior=await client.query("SELECT * FROM sales WHERE idempotency_key=$1",[idempotency_key]);if(prior.rowCount){const existingDelivery=await client.query("SELECT * FROM delivery_orders WHERE sale_id=$1",[prior.rows[0].id]);await client.query("COMMIT");return res.json({sale:prior.rows[0],delivery:existingDelivery.rows[0]||null,duplicate:true});}}
  if(lines.some(x=>Number(x.discount_amount||0)>0)){
   const allowed=await client.query("SELECT 1 FROM user_roles ur JOIN role_permissions rp ON rp.role_id=ur.role_id JOIN permissions p ON p.id=rp.permission_id WHERE ur.user_id=$1 AND p.code='sales.discount' LIMIT 1",[req.user.id]);
   if(!allowed.rowCount)throw Object.assign(new Error("User is not authorized to apply sales discounts"),{statusCode:403});
  }
  const sale=await client.query("INSERT INTO sales(reference_no,branch_id,customer_id,cashier_id,status,channel,idempotency_key) VALUES($1,$2,$3,$4,'open',$5,$6) RETURNING *",[reference_no.trim(),branch_id,delivery?deliveryCustomerId:customer_id,cashier_id,delivery?"delivery":"pos",idempotency_key]);
  let subtotal=0,discountTotal=0,cogs=0;
  for(const line of lines){
   const product=await client.query(`SELECT p.id,p.base_unit_id,p.tracks_expiry,COALESCE(pu.conversion_to_base,1) conversion,
      (SELECT pp.amount FROM product_prices pp WHERE pp.product_id=p.id AND pp.price_type='retail'
       AND pp.valid_from<=now() AND (pp.valid_to IS NULL OR pp.valid_to>now())
       ORDER BY pp.observed_at DESC,pp.created_at DESC LIMIT 1) retail_price
      FROM products p LEFT JOIN product_units pu ON pu.product_id=p.id AND pu.unit_id=$2
      WHERE p.id=$1 AND p.is_active=true AND (p.base_unit_id=$2 OR pu.unit_id IS NOT NULL) FOR UPDATE OF p`,[line.product_id,line.unit_id]);
   if(!product.rowCount)throw Object.assign(new Error("Product or sale unit is not active or configured"),{statusCode:400});
   const qty=Number(line.quantity),baseQty=qty*Number(product.rows[0].conversion),unitPrice=Number(line.unit_price),discount=Number(line.discount_amount||0);
   const approvedPrice=product.rows[0].retail_price===null?null:Number(product.rows[0].retail_price);
   if(approvedPrice===null||Math.abs(unitPrice-approvedPrice)>0.000001)
     throw Object.assign(new Error("Sale price does not match the active approved retail price"),{statusCode:409});
   const gross=qty*unitPrice;if(discount>gross+0.000001)throw Object.assign(new Error("Line discount exceeds line amount"),{statusCode:400});
   const lots=await client.query("SELECT id,quantity_on_hand,unit_cost,expiry_date FROM stock_lots WHERE product_id=$1 AND warehouse_id IN (SELECT id FROM warehouses WHERE branch_id=$2 AND is_active=true) AND is_saleable=true AND quantity_on_hand>0 AND (expiry_date IS NULL OR expiry_date>=CURRENT_DATE) ORDER BY expiry_date NULLS LAST,received_at,id FOR UPDATE",[line.product_id,branch_id]);
   const available=lots.rows.reduce((s,x)=>s+Number(x.quantity_on_hand),0);
   if(available+0.000001<baseQty)throw Object.assign(new Error("Insufficient non-expired stock for product "+line.product_id),{statusCode:409});
   const weightedAverageCost=available>0?lots.rows.reduce((s,x)=>s+Number(x.quantity_on_hand)*Number(x.unit_cost),0)/available:0;
   let remaining=baseQty,lineCogs=0;
   for(const lot of lots.rows){if(remaining<=0.000001)break;const take=Math.min(remaining,Number(lot.quantity_on_hand));await client.query("UPDATE stock_lots SET quantity_on_hand=quantity_on_hand-$2 WHERE id=$1",[lot.id,take]);await client.query("INSERT INTO stock_movements(reference_no,movement_type,product_id,warehouse_id,lot_id,quantity_out,unit_cost,source_type,source_id,created_by) SELECT $1,'sale_issue',$2,warehouse_id,$3,$4,$5,'sale',$6,$7 FROM stock_lots WHERE id=$3",[reference_no.trim(),line.product_id,lot.id,take,weightedAverageCost,sale.rows[0].id,cashier_id]);lineCogs+=take*weightedAverageCost;remaining-=take;}
   const lineTotal=gross-discount;subtotal+=gross;discountTotal+=discount;cogs+=lineCogs;
   await client.query("INSERT INTO sale_lines(sale_id,product_id,unit_id,quantity,unit_price,discount_amount,line_total) VALUES($1,$2,$3,$4,$5,$6,$7)",[sale.rows[0].id,line.product_id,line.unit_id,qty,unitPrice,discount,lineTotal]);
  }
  const deliveryFee=delivery?Number(delivery.delivery_fee||0):0;
  const ruleResult=await client.query("SELECT * FROM sales_discount_settings WHERE is_active=true ORDER BY updated_at DESC LIMIT 1");
  const rule=ruleResult.rows[0]||null;
  const orderDiscountBase=Math.max(0,subtotal-discountTotal);
  let orderDiscount=0,deliveryDiscount=0;
  if(rule&&subtotal+0.000001>=Number(rule.min_order_amount)){
    orderDiscount=rule.order_discount_type==="percent"?orderDiscountBase*Number(rule.order_discount_value)/100:Number(rule.order_discount_value);
    orderDiscount=Math.min(orderDiscountBase,Math.max(0,orderDiscount));
  }
  if(delivery&&rule&&subtotal+0.000001>=Number(rule.delivery_min_order_amount)){
    deliveryDiscount=rule.delivery_discount_type==="percent"?deliveryFee*Number(rule.delivery_discount_value)/100:Number(rule.delivery_discount_value);
    deliveryDiscount=Math.min(deliveryFee,Math.max(0,deliveryDiscount));
  }
  const netDeliveryFee=deliveryFee-deliveryDiscount;
  const total=subtotal-discountTotal-orderDiscount+netDeliveryFee,paymentTotal=payments.reduce((s,x)=>s+Number(x.amount),0);
  if(Math.abs(paymentTotal-total)>0.01)throw Object.assign(new Error("Payment total must equal the sale total"),{statusCode:400});
  const period=await client.query("SELECT 1 FROM accounting_periods WHERE status='closed' AND CURRENT_DATE BETWEEN starts_on AND ends_on LIMIT 1");
  if(period.rowCount)throw Object.assign(new Error("The current accounting period is closed"),{statusCode:409});
  const mappings=await client.query("SELECT mapping_key,account_id FROM system_account_mappings WHERE mapping_key=ANY($1::varchar[])",[["sales_revenue","cogs","inventory"]]);
  const accountMap=Object.fromEntries(mappings.rows.map(x=>[x.mapping_key,x.account_id]));
  if(!accountMap.sales_revenue||!accountMap.cogs||!accountMap.inventory)
    throw Object.assign(new Error("Required sales accounting mappings are missing; apply migration 012"),{statusCode:409});
  const journal=await client.query(
    "INSERT INTO journal_entries(reference_no,source_type,source_id,entry_date,status) VALUES($1,'sale',$2,CURRENT_DATE,'posted') RETURNING id",
    ["JE-"+sale.rows[0].id,sale.rows[0].id]);
  for(const p of payments){
    const method=await client.query("SELECT id,code,name_ar,account_id FROM payment_methods WHERE id=$1 AND is_active=true",[p.payment_method_id]);
    if(!method.rowCount||!method.rows[0].account_id)
      throw Object.assign(new Error("Payment method has no mapped ledger account"),{statusCode:409});
    const isCard=/card|visa|بطاقة|فيزا/i.test(String(method.rows[0].code||"")+" "+String(method.rows[0].name_ar||""));
    if(isCard){
      if(!uuid.test(p.bank_id||"")||!validRef(p.transaction_reference)||!/^[0-9]{4}$/.test(String(p.card_last_four||""))||
        !Number.isFinite(Number(p.terminal_amount))||Number(p.terminal_amount)<=0||Math.abs(Number(p.terminal_amount)-Number(p.amount))>0.01)
        throw Object.assign(new Error("Card payment requires bank, transaction reference, last 4 card digits and matching captured amount"),{statusCode:400});
      const bank=await client.query("SELECT id FROM payment_banks WHERE id=$1 AND is_active=true",[p.bank_id]);
      if(!bank.rowCount)throw Object.assign(new Error("Selected payment bank is not active"),{statusCode:400});
    }
    await client.query("INSERT INTO sale_payments(sale_id,payment_method_id,amount,reference_text,bank_id,transaction_reference,card_last_four,terminal_amount,terminal_captured_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,CASE WHEN $5::uuid IS NOT NULL THEN now() ELSE NULL END)",[sale.rows[0].id,p.payment_method_id,p.amount,p.reference_text||null,isCard?p.bank_id:null,isCard?p.transaction_reference.trim():null,isCard?p.card_last_four:null,isCard?Number(p.terminal_amount):null]);
    await client.query("INSERT INTO journal_lines(journal_entry_id,account_id,debit,credit) VALUES($1,$2,$3,0)",[journal.rows[0].id,method.rows[0].account_id,p.amount]);
  }
  if(total>0)await client.query("INSERT INTO journal_lines(journal_entry_id,account_id,debit,credit) VALUES($1,$2,0,$3)",[journal.rows[0].id,accountMap.sales_revenue,total]);
  if(cogs>0){
    await client.query("INSERT INTO journal_lines(journal_entry_id,account_id,debit,credit) VALUES($1,$2,$3,0)",[journal.rows[0].id,accountMap.cogs,cogs]);
    await client.query("INSERT INTO journal_lines(journal_entry_id,account_id,debit,credit) VALUES($1,$2,0,$3)",[journal.rows[0].id,accountMap.inventory,cogs]);
  }
  const done=await client.query("UPDATE sales SET subtotal=$2,discount_total=$3,delivery_fee=$4,grand_total=$5,order_discount_amount=$6,delivery_discount_amount=$7,delivery_fee_before_discount=$8,status='completed',completed_at=now() WHERE id=$1 RETURNING *",[sale.rows[0].id,subtotal,discountTotal+orderDiscount,netDeliveryFee,total,orderDiscount,deliveryDiscount,deliveryFee]);
  let deliveryOrder=null;
  if(delivery){
   const deliveryRef="DLV-"+reference_no.trim();
   const d=await client.query("INSERT INTO delivery_orders(reference_no,sale_id,customer_id,address,delivery_fee,source_channel,external_order_reference) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *",[deliveryRef,sale.rows[0].id,deliveryCustomerId,delivery.address.trim(),netDeliveryFee,delivery.source_channel||"pos",delivery.external_order_reference||null]);
   deliveryOrder=d.rows[0];
  }
  await client.query("COMMIT");
  res.status(201).json({sale:done.rows[0],delivery:deliveryOrder,discounts:{order_discount_amount:Number(orderDiscount.toFixed(6)),delivery_discount_amount:Number(deliveryDiscount.toFixed(6)),delivery_fee_before_discount:deliveryFee,delivery_fee_after_discount:netDeliveryFee},cogs:Number(cogs.toFixed(6)),payment_total:paymentTotal,journal_entry_id:journal.rows[0].id});
 }catch(e){await client.query("ROLLBACK");if(e.statusCode)return res.status(e.statusCode).json({error:e.message});next(e);}finally{client.release();}
});
export default router;
