import { Router } from "express";
import { pool } from "../db.js";
import { completeSaleHandler } from "./sales.js";
import { calculateMonthlyDepreciation } from "../domain/assets.js";
import { canTransitionDeliveryStatus } from "../domain/delivery.js";
const router=Router();
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const txt=(v,n=180)=>typeof v==="string"&&v.trim().length>0&&v.trim().length<=n;
const num=(v,min=0)=>Number.isFinite(Number(v))&&Number(v)>=min;
const fail=(res,msg)=>res.status(400).json({error:msg});

// Master data
// Branch and warehouse selectors used by purchasing and stock workflows.
router.get("/branches",async(_req,res,next)=>{try{const r=await pool.query("SELECT id,code,name FROM branches WHERE is_active=true ORDER BY name");res.json({items:r.rows});}catch(e){next(e);}});
router.get("/warehouses",async(req,res,next)=>{try{const vals=[];let sql="SELECT w.id,w.code,w.name,w.branch_id,b.name branch_name FROM warehouses w JOIN branches b ON b.id=w.branch_id WHERE w.is_active=true";if(req.query.branch_id){if(!uuid.test(req.query.branch_id))return fail(res,"Invalid branch_id");vals.push(req.query.branch_id);sql+=" AND w.branch_id=$1";}sql+=" ORDER BY w.name";const r=await pool.query(sql,vals);res.json({items:r.rows});}catch(e){next(e);}});
router.get("/suppliers",async(_q,res,next)=>{try{const r=await pool.query("SELECT * FROM suppliers ORDER BY name");res.json({items:r.rows});}catch(e){next(e);}});
router.post("/suppliers",async(req,res,next)=>{const {code,name,phone=null,email=null,tax_number=null,address=null}=req.body??{};if(!txt(code,60)||!txt(name))return fail(res,"Supplier code and name are required");try{const r=await pool.query("INSERT INTO suppliers(code,name,phone,email,tax_number,address) VALUES($1,$2,$3,$4,$5,$6) RETURNING *",[code.trim(),name.trim(),phone,email,tax_number,address]);res.status(201).json(r.rows[0]);}catch(e){next(e);}});
router.get("/customers",async(_q,res,next)=>{try{const r=await pool.query("SELECT * FROM customers ORDER BY name");res.json({items:r.rows});}catch(e){next(e);}});
router.post("/customers",async(req,res,next)=>{const {code,name,phone=null,email=null,address=null}=req.body??{};if(!txt(code,60)||!txt(name))return fail(res,"Customer code and name are required");try{const r=await pool.query("INSERT INTO customers(code,name,phone,email,address) VALUES($1,$2,$3,$4,$5) RETURNING *",[code.trim(),name.trim(),phone,email,address]);res.status(201).json(r.rows[0]);}catch(e){next(e);}});

// Stock visibility: available quantities come from accepted lots only.
router.get("/inventory/stock",async(req,res,next)=>{try{const vals=[],where=[];if(req.query.product_id){if(!uuid.test(req.query.product_id))return fail(res,"Invalid product_id");vals.push(req.query.product_id);where.push("p.id=$"+vals.length);}if(req.query.warehouse_id){if(!uuid.test(req.query.warehouse_id))return fail(res,"Invalid warehouse_id");vals.push(req.query.warehouse_id);where.push("w.id=$"+vals.length);}const r=await pool.query(`SELECT p.id product_id,p.sku,p.name_ar,w.id warehouse_id,w.name warehouse_name,sl.lot_number,sl.expiry_date,sl.production_date,sl.purchase_date,s.name supplier_name,s.code supplier_code,sl.quantity_on_hand,sl.unit_cost FROM stock_lots sl JOIN products p ON p.id=sl.product_id JOIN warehouses w ON w.id=sl.warehouse_id LEFT JOIN suppliers s ON s.id=sl.supplier_id WHERE sl.is_saleable=true AND sl.quantity_on_hand>0 ${where.length?"AND "+where.join(" AND "):""} ORDER BY p.name_ar,sl.expiry_date NULLS LAST,sl.received_at`,vals);res.json({items:r.rows});}catch(e){next(e);}});
router.get("/inventory/movements",async(req,res,next)=>{try{const r=await pool.query("SELECT sm.*,p.sku,p.name_ar,w.name warehouse_name FROM stock_movements sm JOIN products p ON p.id=sm.product_id JOIN warehouses w ON w.id=sm.warehouse_id ORDER BY sm.created_at DESC LIMIT 500");res.json({items:r.rows});}catch(e){next(e);}});

// Human resources
router.get("/employees",async(_q,res,next)=>{try{const r=await pool.query("SELECT e.*,b.name branch_name FROM employees e JOIN branches b ON b.id=e.branch_id ORDER BY e.full_name");res.json({items:r.rows});}catch(e){next(e);}});
router.post("/employees",async(req,res,next)=>{const {employee_code,branch_id,full_name,user_id=null,job_title=null,phone=null,hire_date=null,monthly_salary=0}=req.body??{};if(!txt(employee_code,40)||!uuid.test(branch_id||"")||!txt(full_name)|| (user_id&&!uuid.test(user_id))||!num(monthly_salary))return fail(res,"Invalid employee fields");try{const r=await pool.query("INSERT INTO employees(employee_code,branch_id,full_name,user_id,job_title,phone,hire_date,monthly_salary) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *",[employee_code,branch_id,full_name,user_id,job_title,phone,hire_date,monthly_salary]);res.status(201).json(r.rows[0]);}catch(e){next(e);}});

// Fixed assets and maintenance
router.get("/assets",async(_q,res,next)=>{try{const r=await pool.query("SELECT a.*,b.name branch_name FROM fixed_assets a JOIN branches b ON b.id=a.branch_id ORDER BY a.asset_code");res.json({items:r.rows});}catch(e){next(e);}});
router.post("/assets",async(req,res,next)=>{const {asset_code,name,branch_id,category=null,purchase_date=null,purchase_cost=0,serial_number=null,useful_life_months=null,residual_value=0,depreciation_start_date=purchase_date}=req.body??{};if(!txt(asset_code,50)||!txt(name)||!uuid.test(branch_id||"")||!num(purchase_cost)||!num(residual_value)||Number(residual_value)>Number(purchase_cost)||(useful_life_months!==null&&(!Number.isInteger(Number(useful_life_months))||Number(useful_life_months)<=0))||(depreciation_start_date&&!/^\d{4}-\d{2}-\d{2}$/.test(depreciation_start_date)))return fail(res,"Invalid asset or depreciation fields");try{const r=await pool.query("INSERT INTO fixed_assets(asset_code,name,branch_id,category,purchase_date,purchase_cost,serial_number,useful_life_months,residual_value,depreciation_start_date) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *",[asset_code,name,branch_id,category,purchase_date,purchase_cost,serial_number,useful_life_months,residual_value,depreciation_start_date]);res.status(201).json(r.rows[0]);}catch(e){next(e);}});
router.get("/assets/depreciation/runs",async(_req,res,next)=>{try{const r=await pool.query("SELECT r.*,u.display_name created_by_name FROM asset_depreciation_runs r LEFT JOIN users u ON u.id=r.created_by ORDER BY r.period_month DESC LIMIT 120");res.json({items:r.rows});}catch(e){next(e);}});
router.post("/assets/depreciation/run",async(req,res,next)=>{
 const {period_month,reference_no}=req.body??{};
 if(!/^\d{4}-\d{2}-01$/.test(period_month||"")||!txt(reference_no,60))return fail(res,"A first-of-month date and unique reference are required");
 const c=await pool.connect();
 try{
  await c.query("BEGIN");
  const closed=await c.query("SELECT 1 FROM accounting_periods WHERE status='closed' AND $1::date BETWEEN starts_on AND ends_on LIMIT 1",[period_month]);
  if(closed.rowCount)throw Object.assign(new Error("The selected depreciation period is closed"),{statusCode:409});
  const assets=await c.query("SELECT * FROM fixed_assets WHERE status='active' AND useful_life_months>0 AND depreciation_start_date IS NOT NULL AND depreciation_start_date<=($1::date+INTERVAL '1 month - 1 day') AND accumulated_depreciation<purchase_cost-residual_value ORDER BY asset_code FOR UPDATE",[period_month]);
  const entries=[];
  for(const asset of assets.rows){
    const amountValue=calculateMonthlyDepreciation({purchaseCost:Number(asset.purchase_cost),residualValue:Number(asset.residual_value),usefulLifeMonths:Number(asset.useful_life_months),accumulatedDepreciation:Number(asset.accumulated_depreciation),depreciationStartDate:String(asset.depreciation_start_date).slice(0,10),periodMonth:period_month});
    if(amountValue>0)entries.push({asset,amount:amountValue,before:Number(asset.accumulated_depreciation),after:Number(asset.accumulated_depreciation)+amountValue});
  }
  if(!entries.length)throw Object.assign(new Error("No active depreciable assets are due in this month"),{statusCode:409});
  const maps=await c.query("SELECT m.mapping_key,m.account_id,a.account_type FROM system_account_mappings m JOIN accounts a ON a.id=m.account_id WHERE m.mapping_key=ANY($1::varchar[])",[["depreciation_expense","accumulated_depreciation"]]);
  const map=Object.fromEntries(maps.rows.map(x=>[x.mapping_key,x]));
  if(!map.depreciation_expense||map.depreciation_expense.account_type!=="expense"||!map.accumulated_depreciation||map.accumulated_depreciation.account_type!=="asset")
    throw Object.assign(new Error("Depreciation expense and accumulated depreciation account mappings are missing or invalid"),{statusCode:409});
  const total=Number(entries.reduce((sum,x)=>sum+x.amount,0).toFixed(6));
  const run=await c.query("INSERT INTO asset_depreciation_runs(reference_no,period_month,status,total_amount,created_by) VALUES($1,$2,'posted',$3,$4) RETURNING *",[reference_no,period_month,total,req.user.id]);
  const je=await c.query("INSERT INTO journal_entries(reference_no,source_type,source_id,entry_date,status) VALUES($1,'asset_depreciation',$2,$3,'posted') RETURNING id",["JE-DEP-"+run.rows[0].id.slice(0,24),run.rows[0].id,period_month]);
  await c.query("INSERT INTO journal_lines(journal_entry_id,account_id,debit,credit) VALUES($1,$2,$3,0),($1,$4,0,$3)",[je.rows[0].id,map.depreciation_expense.account_id,total,map.accumulated_depreciation.account_id]);
  for(const entry of entries){
    await c.query("INSERT INTO asset_depreciation_lines(run_id,asset_id,period_month,amount,accumulated_before,accumulated_after) VALUES($1,$2,$3,$4,$5,$6)",[run.rows[0].id,entry.asset.id,period_month,entry.amount,entry.before,entry.after]);
    await c.query("UPDATE fixed_assets SET accumulated_depreciation=$2 WHERE id=$1",[entry.asset.id,entry.after]);
  }
  const saved=await c.query("UPDATE asset_depreciation_runs SET journal_entry_id=$2 WHERE id=$1 RETURNING *",[run.rows[0].id,je.rows[0].id]);
  await c.query("COMMIT");
  res.status(201).json({run:saved.rows[0],asset_count:entries.length,journal_entry_id:je.rows[0].id});
 }catch(e){await c.query("ROLLBACK");if(e.statusCode)return res.status(e.statusCode).json({error:e.message});if(e.code==="23505")return res.status(409).json({error:"A depreciation run or reference already exists for this month"});next(e);}finally{c.release();}
});
router.post("/assets/depreciation/runs/:id/reverse",async(req,res,next)=>{
 const {reason}=req.body??{};
 if(!uuid.test(req.params.id)||!txt(reason,1000))return fail(res,"A depreciation reversal reason is required");
 const c=await pool.connect();
 try{
  await c.query("BEGIN");
  const run=await c.query("SELECT * FROM asset_depreciation_runs WHERE id=$1 AND status='posted' FOR UPDATE",[req.params.id]);
  if(!run.rowCount)throw Object.assign(new Error("Posted depreciation run not found or already reversed"),{statusCode:409});
  const closed=await c.query("SELECT 1 FROM accounting_periods WHERE status='closed' AND CURRENT_DATE BETWEEN starts_on AND ends_on LIMIT 1");
  if(closed.rowCount)throw Object.assign(new Error("The current accounting period is closed"),{statusCode:409});
  const lines=await c.query("SELECT * FROM asset_depreciation_lines WHERE run_id=$1 FOR UPDATE",[req.params.id]);
  for(const line of lines.rows){
    const later=await c.query("SELECT 1 FROM asset_depreciation_lines l JOIN asset_depreciation_runs r ON r.id=l.run_id WHERE l.asset_id=$1 AND l.period_month>$2 AND r.status='posted' LIMIT 1",[line.asset_id,run.rows[0].period_month]);
    if(later.rowCount)throw Object.assign(new Error("A later depreciation run exists for an asset in this batch; reverse later periods first"),{statusCode:409});
    const asset=await c.query("SELECT accumulated_depreciation FROM fixed_assets WHERE id=$1 FOR UPDATE",[line.asset_id]);
    if(!asset.rowCount||Math.abs(Number(asset.rows[0].accumulated_depreciation)-Number(line.accumulated_after))>0.000001)
      throw Object.assign(new Error("Asset accumulated depreciation changed after this run; manual reconciliation is required"),{statusCode:409});
  }
  const original=await c.query("SELECT id FROM journal_entries WHERE id=$1 AND status='posted' FOR UPDATE",[run.rows[0].journal_entry_id]);
  if(!original.rowCount)throw Object.assign(new Error("Original depreciation journal is missing or already reversed"),{statusCode:409});
  const originalLines=await c.query("SELECT account_id,debit,credit FROM journal_lines WHERE journal_entry_id=$1",[original.rows[0].id]);
  const reversal=await c.query("INSERT INTO journal_entries(reference_no,source_type,source_id,entry_date,status) VALUES($1,'asset_depreciation_reversal',$2,CURRENT_DATE,'posted') RETURNING id",["JE-DEP-REV-"+run.rows[0].id.slice(0,24),req.params.id]);
  for(const line of originalLines.rows)await c.query("INSERT INTO journal_lines(journal_entry_id,account_id,debit,credit) VALUES($1,$2,$3,$4)",[reversal.rows[0].id,line.account_id,line.credit,line.debit]);
  for(const line of lines.rows)await c.query("UPDATE fixed_assets SET accumulated_depreciation=accumulated_depreciation-$2 WHERE id=$1",[line.asset_id,line.amount]);
  await c.query("UPDATE journal_entries SET status='reversed' WHERE id=$1",[original.rows[0].id]);
  const saved=await c.query("UPDATE asset_depreciation_runs SET status='reversed',reversal_journal_entry_id=$2,reversed_by=$3,reversed_at=now(),reversal_reason=$4 WHERE id=$1 RETURNING *",[req.params.id,reversal.rows[0].id,req.user.id,reason.trim()]);
  await c.query("COMMIT");
  res.json({run:saved.rows[0],reversal_journal_entry_id:reversal.rows[0].id});
 }catch(e){await c.query("ROLLBACK");if(e.statusCode)return res.status(e.statusCode).json({error:e.message});next(e);}finally{c.release();}
});
router.post("/assets/:id/maintenance",async(req,res,next)=>{const {reference_no,description,scheduled_at=null}=req.body??{};if(!uuid.test(req.params.id)||!txt(reference_no,50)||!txt(description))return fail(res,"Invalid maintenance request");try{const r=await pool.query("INSERT INTO asset_maintenance(asset_id,reference_no,description,scheduled_at) VALUES($1,$2,$3,$4) RETURNING *",[req.params.id,reference_no,description,scheduled_at]);res.status(201).json(r.rows[0]);}catch(e){next(e);}});

// Delivery and ecommerce intake
router.get("/delivery/orders",async(_q,res,next)=>{try{const r=await pool.query("SELECT d.*,c.name customer_name,c.phone customer_phone,e.full_name courier_name,s.reference_no sale_reference,s.grand_total sale_total FROM delivery_orders d JOIN customers c ON c.id=d.customer_id LEFT JOIN employees e ON e.id=d.courier_employee_id LEFT JOIN sales s ON s.id=d.sale_id ORDER BY d.created_at DESC LIMIT 300");res.json({items:r.rows});}catch(e){next(e);}});
router.post("/delivery/orders",async(req,res,next)=>{const {reference_no,customer_id,address,sale_id=null,delivery_fee=0,source_channel="pos",external_order_reference=null}=req.body??{};const channels=["pos","phone","talabat","elmenus","breadfast","mrsool","generic"];if(!txt(reference_no,50)||!uuid.test(customer_id||"")||!txt(address,1000)||!num(delivery_fee)||!channels.includes(source_channel)||(sale_id&&!uuid.test(sale_id))||(external_order_reference&&!txt(external_order_reference,160)))return fail(res,"Invalid delivery order");try{const r=await pool.query("INSERT INTO delivery_orders(reference_no,customer_id,address,sale_id,delivery_fee,source_channel,external_order_reference) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *",[reference_no,customer_id,address,sale_id,delivery_fee,source_channel,external_order_reference]);res.status(201).json(r.rows[0]);}catch(e){next(e);}});
router.patch("/delivery/orders/:id/status",async(req,res,next)=>{
 const {status,courier_employee_id=null,note=null,failure_reason=null,cancelled_reason=null}=req.body??{};
 const allowed=["assigned","out_for_delivery","delivered","failed","cancelled"];
 if(!uuid.test(req.params.id)||!allowed.includes(status)||(courier_employee_id&&!uuid.test(courier_employee_id))||(note!==null&&!txt(note,1000)))return fail(res,"Invalid delivery status update");
 const c=await pool.connect();
 try{
  await c.query("BEGIN");
  const order=await c.query("SELECT * FROM delivery_orders WHERE id=$1 FOR UPDATE",[req.params.id]);
  if(!order.rowCount)throw Object.assign(new Error("Delivery order not found"),{statusCode:404});
  const current=order.rows[0].status;
  if(!canTransitionDeliveryStatus(current,status))throw Object.assign(new Error("Delivery status transition is not allowed from "+current+" to "+status),{statusCode:409});
  let courier=order.rows[0].courier_employee_id;
  if(courier_employee_id)courier=courier_employee_id;
  if(status==="assigned"){
    if(!courier)throw Object.assign(new Error("Assign an active courier before marking the order assigned"),{statusCode:400});
    const employee=await c.query("SELECT id FROM employees WHERE id=$1 AND employment_status='active' FOR SHARE",[courier]);
    if(!employee.rowCount)throw Object.assign(new Error("Courier employee is inactive or unavailable"),{statusCode:400});
  }
  if(status==="out_for_delivery"&&!courier)throw Object.assign(new Error("A courier must be assigned before dispatch"),{statusCode:409});
  if(status==="delivered"&&current!=="out_for_delivery")throw Object.assign(new Error("Only dispatched orders can be marked delivered"),{statusCode:409});
  if(status==="failed"&&!txt(failure_reason,1000))throw Object.assign(new Error("A failure reason is required"),{statusCode:400});
  if(status==="cancelled"&&!txt(cancelled_reason||note,1000))throw Object.assign(new Error("A cancellation reason is required"),{statusCode:400});
  const updated=await c.query("UPDATE delivery_orders SET status=$2,courier_employee_id=$3,delivered_at=CASE WHEN $2='delivered' THEN now() ELSE delivered_at END,status_updated_by=$4,status_updated_at=now(),failure_reason=CASE WHEN $2='failed' THEN $5 ELSE NULL END,cancelled_reason=CASE WHEN $2='cancelled' THEN $6 ELSE NULL END WHERE id=$1 RETURNING *",
    [req.params.id,status,courier,req.user.id,failure_reason||null,cancelled_reason||note||null]);
  await c.query("INSERT INTO delivery_order_status_history(delivery_order_id,previous_status,new_status,courier_employee_id,note,changed_by) VALUES($1,$2,$3,$4,$5,$6)",
    [req.params.id,current,status,courier,note||failure_reason||cancelled_reason||null,req.user.id]);
  await c.query("COMMIT");
  res.json(updated.rows[0]);
 }catch(e){await c.query("ROLLBACK");if(e.statusCode)return res.status(e.statusCode).json({error:e.message});next(e);}finally{c.release();}
});
router.get("/delivery/orders/:id/history",async(req,res,next)=>{if(!uuid.test(req.params.id))return fail(res,"Invalid delivery order id");try{const r=await pool.query("SELECT h.*,u.display_name changed_by_name,e.full_name courier_name FROM delivery_order_status_history h LEFT JOIN users u ON u.id=h.changed_by LEFT JOIN employees e ON e.id=h.courier_employee_id WHERE h.delivery_order_id=$1 ORDER BY h.changed_at DESC",[req.params.id]);res.json({items:r.rows});}catch(e){next(e);}});
router.post("/ecommerce/orders",async(req,res,next)=>{const {reference_no,customer_id=null,customer_name,phone,address,lines}=req.body??{};if(!txt(reference_no,50)||!txt(customer_name)||!txt(phone,40)||!txt(address,1000)||(customer_id&&!uuid.test(customer_id))||!Array.isArray(lines)||!lines.length||lines.length>100||lines.some(x=>!uuid.test(x.product_id||"")||!num(x.quantity,0.000001)))return fail(res,"Invalid ecommerce order");const c=await pool.connect();try{await c.query("BEGIN");const o=await c.query("INSERT INTO ecommerce_orders(reference_no,customer_id,customer_name,phone,address) VALUES($1,$2,$3,$4,$5) RETURNING *",[reference_no,customer_id,customer_name,phone,address]);for(const l of lines)await c.query("INSERT INTO ecommerce_order_lines(order_id,product_id,quantity) VALUES($1,$2,$3)",[o.rows[0].id,l.product_id,l.quantity]);await c.query("COMMIT");res.status(201).json({order:o.rows[0],lines:lines.length});}catch(e){await c.query("ROLLBACK");next(e);}finally{c.release();}});
router.get("/ecommerce/orders",async(_q,res,next)=>{try{const r=await pool.query("SELECT * FROM ecommerce_orders ORDER BY created_at DESC LIMIT 300");res.json({items:r.rows});}catch(e){next(e);}});
router.get("/ecommerce/orders/:id",async(req,res,next)=>{if(!uuid.test(req.params.id))return fail(res,"Invalid ecommerce order id");try{const order=await pool.query("SELECT * FROM ecommerce_orders WHERE id=$1",[req.params.id]);if(!order.rowCount)return res.status(404).json({error:"Ecommerce order not found"});const lines=await pool.query("SELECT el.*,p.sku,p.name_ar,u.code unit_code FROM ecommerce_order_lines el JOIN products p ON p.id=el.product_id JOIN units u ON u.id=p.base_unit_id WHERE el.order_id=$1 ORDER BY p.name_ar",[req.params.id]);res.json({order:order.rows[0],lines:lines.rows});}catch(e){next(e);}});
router.patch("/ecommerce/orders/:id/status",async(req,res,next)=>{const {status}=req.body??{};if(!uuid.test(req.params.id)||!["confirmed","preparing","cancelled"].includes(status))return fail(res,"Invalid ecommerce status transition");try{const r=await pool.query("UPDATE ecommerce_orders SET status=$2 WHERE id=$1 AND ((status='new' AND $2 IN ('confirmed','cancelled')) OR (status='confirmed' AND $2 IN ('preparing','cancelled'))) RETURNING *",[req.params.id,status]);if(!r.rowCount)return res.status(409).json({error:"Order not found or transition is not allowed"});res.json(r.rows[0]);}catch(e){next(e);}});
router.get("/ecommerce/conversion-context",async(req,res,next)=>{
 try{
  const [branches,payments,taxCodes,banks,cashSession]=await Promise.all([
    pool.query("SELECT id,code,name FROM branches WHERE is_active ORDER BY name"),
    pool.query("SELECT id,code,name_ar FROM payment_methods WHERE is_active ORDER BY code"),
    pool.query("SELECT id,code,name_ar,rate FROM tax_codes WHERE is_active ORDER BY code"),
    pool.query("SELECT id,code,name_ar,name_en FROM payment_banks WHERE is_active ORDER BY name_ar"),
    pool.query("SELECT id,reference_no,cashbox_id,opened_at FROM cash_sessions WHERE cashier_id=$1 AND status='open' ORDER BY opened_at DESC LIMIT 1",[req.user.id])
  ]);
  const main=branches.rows.find(x=>x.code==="MAIN")||branches.rows[0]||null;
  res.json({branches:branches.rows,branch:main,payment_methods:payments.rows,tax_codes:taxCodes.rows,banks:banks.rows,cash_session:cashSession.rows[0]||null});
 }catch(e){next(e);}
});
router.post("/ecommerce/orders/:id/quote",async(req,res,next)=>{
 const {delivery_fee=0,tax_code_id=null}=req.body??{};
 if(!uuid.test(req.params.id)||!Number.isFinite(Number(delivery_fee))||Number(delivery_fee)<0||(tax_code_id&&!uuid.test(tax_code_id)))return fail(res,"Invalid ecommerce quote request");
 try{
  const order=await pool.query("SELECT id,status FROM ecommerce_orders WHERE id=$1",[req.params.id]);
  if(!order.rowCount||!["confirmed","preparing"].includes(order.rows[0].status))return res.status(409).json({error:"Only confirmed or preparing orders can be quoted for conversion"});
  const lines=await pool.query(`SELECT el.product_id,el.quantity,p.sku,p.name_ar,p.base_unit_id,
    (SELECT pp.amount FROM product_prices pp WHERE pp.product_id=p.id AND pp.price_type='retail'
      AND pp.valid_from<=now() AND (pp.valid_to IS NULL OR pp.valid_to>now())
      ORDER BY pp.observed_at DESC,pp.created_at DESC LIMIT 1) retail_price
    FROM ecommerce_order_lines el JOIN products p ON p.id=el.product_id
    WHERE el.order_id=$1 AND p.is_active=true ORDER BY p.name_ar`,[req.params.id]);
  if(!lines.rowCount||lines.rows.some(x=>x.retail_price===null))return res.status(409).json({error:"Order contains no active products or a product without an approved retail price"});
  const subtotal=lines.rows.reduce((sum,line)=>sum+Number(line.quantity)*Number(line.retail_price),0);
  const rules=await pool.query("SELECT * FROM sales_discount_settings WHERE is_active=true ORDER BY updated_at DESC LIMIT 1");
  const rule=rules.rows[0]||null,base=subtotal;
  const orderDiscount=rule&&subtotal+0.000001>=Number(rule.min_order_amount)?Math.min(base,rule.order_discount_type==="percent"?base*Number(rule.order_discount_value)/100:Number(rule.order_discount_value)):0;
  const fee=Number(delivery_fee);
  const deliveryDiscount=rule&&subtotal+0.000001>=Number(rule.delivery_min_order_amount)?Math.min(fee,rule.delivery_discount_type==="percent"?fee*Number(rule.delivery_discount_value)/100:Number(rule.delivery_discount_value)):0;
  let taxRate=0;
  if(tax_code_id){const tax=await pool.query("SELECT rate FROM tax_codes WHERE id=$1 AND is_active=true",[tax_code_id]);if(!tax.rowCount)return res.status(400).json({error:"Selected tax code is inactive"});taxRate=Number(tax.rows[0].rate);}
  const taxableBase=Math.max(0,subtotal-orderDiscount),taxTotal=taxableBase*taxRate/100,total=taxableBase+fee-deliveryDiscount+taxTotal;
  res.json({order_id:req.params.id,lines:lines.rows.map(x=>({product_id:x.product_id,sku:x.sku,name_ar:x.name_ar,quantity:Number(x.quantity),unit_price:Number(x.retail_price)})),subtotal:Number(subtotal.toFixed(6)),order_discount_amount:Number(orderDiscount.toFixed(6)),delivery_fee:fee,delivery_discount_amount:Number(deliveryDiscount.toFixed(6)),tax_rate:taxRate,tax_total:Number(taxTotal.toFixed(6)),grand_total:Number(total.toFixed(6))});
 }catch(e){next(e);}
});
router.post("/ecommerce/orders/:id/convert-to-sale",async(req,res,next)=>{
 const {branch_id,payments,tax_code_id=null,delivery_fee=0}=req.body??{};
 if(!uuid.test(req.params.id)||!uuid.test(branch_id||"")||!Array.isArray(payments)||!payments.length||!Number.isFinite(Number(delivery_fee))||Number(delivery_fee)<0||(tax_code_id&&!uuid.test(tax_code_id)))
  return fail(res,"A valid branch, payment allocation and delivery fee are required");
 const c=await pool.connect();
 try{
  await c.query("BEGIN");
  const order=await c.query("SELECT * FROM ecommerce_orders WHERE id=$1 FOR UPDATE",[req.params.id]);
  if(!order.rowCount||!["confirmed","preparing"].includes(order.rows[0].status))
    throw Object.assign(new Error("Only confirmed or preparing ecommerce orders can be converted"),{statusCode:409});
  if(order.rows[0].sales_id){
    const existing=await c.query("SELECT * FROM sales WHERE id=$1",[order.rows[0].sales_id]);
    await c.query("COMMIT");
    return res.json({order:order.rows[0],sale:existing.rows[0],duplicate:true});
  }
  let customerId=order.rows[0].customer_id;
  if(!customerId){
    const customer=await c.query("INSERT INTO customers(code,name,phone,address) VALUES($1,$2,$3,$4) RETURNING id",
      ["WEB-"+order.rows[0].id.slice(0,8),order.rows[0].customer_name,order.rows[0].phone,order.rows[0].address]);
    customerId=customer.rows[0].id;
    await c.query("UPDATE ecommerce_orders SET customer_id=$2 WHERE id=$1",[req.params.id,customerId]);
  }
  const lines=await c.query(`SELECT el.product_id,el.quantity,p.base_unit_id,
    (SELECT pp.amount FROM product_prices pp WHERE pp.product_id=p.id AND pp.price_type='retail'
      AND pp.valid_from<=now() AND (pp.valid_to IS NULL OR pp.valid_to>now())
      ORDER BY pp.observed_at DESC,pp.created_at DESC LIMIT 1) retail_price
    FROM ecommerce_order_lines el JOIN products p ON p.id=el.product_id
    WHERE el.order_id=$1 AND p.is_active=true ORDER BY el.id FOR UPDATE OF p`,[req.params.id]);
  if(!lines.rowCount)throw Object.assign(new Error("Ecommerce order has no active products"),{statusCode:409});
  if(lines.rows.some(x=>x.retail_price===null))throw Object.assign(new Error("Every ecommerce product must have an active approved retail price"),{statusCode:409});
  const payload={
    reference_no:"WEB-"+order.rows[0].id.replaceAll("-","").slice(0,42),
    branch_id,customer_id:customerId,
    lines:lines.rows.map(x=>({product_id:x.product_id,unit_id:x.base_unit_id,quantity:Number(x.quantity),unit_price:Number(x.retail_price),discount_amount:0})),
    payments,idempotency_key:"ecommerce:"+req.params.id,tax_code_id,
    delivery:{customer_id:customerId,address:order.rows[0].address,delivery_fee:Number(delivery_fee),source_channel:"generic",external_order_reference:order.rows[0].reference_no}
  };
  await c.query("COMMIT");
  // Re-lock the order while the shared POS checkout runs. Concurrent conversions wait here,
  // then observe sales_id and return the already-created invoice instead of racing a duplicate.
  await c.query("BEGIN");
  const locked=await c.query("SELECT * FROM ecommerce_orders WHERE id=$1 FOR UPDATE",[req.params.id]);
  if(!locked.rowCount)throw Object.assign(new Error("Ecommerce order disappeared during conversion"),{statusCode:404});
  if(locked.rows[0].sales_id){
    const existing=await c.query("SELECT * FROM sales WHERE id=$1",[locked.rows[0].sales_id]);
    await c.query("COMMIT");
    return res.json({order:locked.rows[0],sale:existing.rows[0],duplicate:true});
  }
  let resultBody=null,resultStatus=200,handlerError=null;
  const response={status(code){resultStatus=code;return this;},json(body){resultBody=body;return this;}};
  await completeSaleHandler({...req,body:payload},response,error=>{handlerError=error;});
  if(handlerError)throw handlerError;
  if(resultStatus>=400){await c.query("ROLLBACK");return res.status(resultStatus).json(resultBody);}
  const sale=resultBody?.sale;
  if(!sale?.id)throw new Error("POS checkout did not return a completed sale");
  const updated=await c.query("UPDATE ecommerce_orders SET status='converted',sales_id=$2 WHERE id=$1 AND status IN ('confirmed','preparing') RETURNING *",[req.params.id,sale.id]);
  if(!updated.rowCount)throw Object.assign(new Error("Sale was created but ecommerce order status could not be updated; retry safely using the same order"),{statusCode:409});
  await c.query("COMMIT");
  res.status(201).json({order:updated.rows[0],sale,delivery:resultBody.delivery||null,duplicate:Boolean(resultBody.duplicate)});
 }catch(e){
  await c.query("ROLLBACK").catch(()=>{});
  if(e.statusCode)return res.status(e.statusCode).json({error:e.message});
  next(e);
 }finally{c.release();}
});

// General ledger journal entries posted by integrated operational workflows.
router.get("/accounting/journals",async(_req,res,next)=>{try{
 const r=await pool.query(`SELECT je.id,je.reference_no,je.source_type,je.source_id,je.entry_date,je.status,
   COALESCE(SUM(jl.debit),0) total_debit,COALESCE(SUM(jl.credit),0) total_credit
   FROM journal_entries je LEFT JOIN journal_lines jl ON jl.journal_entry_id=je.id
   GROUP BY je.id ORDER BY je.entry_date DESC,je.created_at DESC LIMIT 500`);
 res.json({items:r.rows});
}catch(e){next(e);}});
router.get("/accounting/journals/:id",async(req,res,next)=>{if(!uuid.test(req.params.id))return fail(res,"Invalid journal entry id");try{
 const entry=await pool.query("SELECT * FROM journal_entries WHERE id=$1",[req.params.id]);
 if(!entry.rowCount)return res.status(404).json({error:"Journal entry not found"});
 const lines=await pool.query("SELECT jl.*,a.code account_code,a.name_ar account_name FROM journal_lines jl JOIN accounts a ON a.id=jl.account_id WHERE jl.journal_entry_id=$1 ORDER BY a.code",[req.params.id]);
 res.json({entry:entry.rows[0],lines:lines.rows});
}catch(e){next(e);}});
// Accounting periods: closing a period prevents posting dates in that range in later posting workflows.
router.get("/accounting/periods",async(_q,res,next)=>{try{const r=await pool.query("SELECT * FROM accounting_periods ORDER BY starts_on DESC");res.json({items:r.rows});}catch(e){next(e);}});
router.post("/accounting/periods",async(req,res,next)=>{const {period_name,starts_on,ends_on}=req.body??{};if(!txt(period_name,40)||!/^\d{4}-\d{2}-\d{2}$/.test(starts_on||"")||!/^\d{4}-\d{2}-\d{2}$/.test(ends_on||"")||ends_on<starts_on)return fail(res,"Invalid accounting period");try{const r=await pool.query("INSERT INTO accounting_periods(period_name,starts_on,ends_on) VALUES($1,$2,$3) RETURNING *",[period_name,starts_on,ends_on]);res.status(201).json(r.rows[0]);}catch(e){next(e);}});
router.post("/accounting/periods/:id/close",async(req,res,next)=>{if(!uuid.test(req.params.id))return fail(res,"Invalid period close request");try{const r=await pool.query("UPDATE accounting_periods SET status='closed',closed_by=$2,closed_at=now() WHERE id=$1 AND status='open' RETURNING *",[req.params.id,req.user.id]);if(!r.rowCount)return res.status(409).json({error:"Period not found or already closed"});res.json(r.rows[0]);}catch(e){next(e);}});
export default router;
