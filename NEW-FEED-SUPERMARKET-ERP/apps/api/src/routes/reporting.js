import {Router} from "express";
import {pool} from "../db.js";
import {requirePermission} from "../auth.js";
const router=Router();
const dateRe=/^\d{4}-\d{2}-\d{2}$/;
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const dates=(req,res)=>{const from=req.query.from||new Date().toISOString().slice(0,10),to=req.query.to||from;if(!dateRe.test(from)||!dateRe.test(to)||to<from){res.status(400).json({error:"Invalid date range"});return null;}return {from,to};};

router.get("/reports/export-permission",requirePermission("reports.export"),(_req,res)=>res.json({allowed:true}));
router.get("/reports/options",async(req,res,next)=>{
 const q=String(req.query.q||"").trim().slice(0,120);
 try{
  const [products,categories,warehouses]=await Promise.all([
   pool.query("SELECT id,sku,name_ar FROM products WHERE is_active=true AND ($1='' OR name_ar ILIKE '%'||$1||'%' OR sku ILIKE '%'||$1||'%') ORDER BY name_ar LIMIT 200",[q]),
   pool.query("SELECT id,code,name_ar FROM categories WHERE is_active=true ORDER BY name_ar"),
   pool.query("SELECT id,code,name FROM warehouses WHERE is_active=true ORDER BY name")
  ]);
  res.json({products:products.rows,categories:categories.rows,warehouses:warehouses.rows});
 }catch(e){next(e);}
});
router.get("/reports/daily-sales",async(req,res,next)=>{
 const date=req.query.date||new Date().toISOString().slice(0,10);
 if(!dateRe.test(date))return res.status(400).json({error:"Invalid date"});
 try{
  const totals=await pool.query(`SELECT COUNT(*)::int invoice_count,COALESCE(SUM(subtotal),0) subtotal,
   COALESCE(SUM(discount_total),0) discounts,COALESCE(SUM(tax_total),0) taxes,COALESCE(SUM(delivery_fee),0) delivery_fees,
   COALESCE(SUM(grand_total),0) net_sales
   FROM sales WHERE status='completed' AND COALESCE(completed_at,created_at)::date=$1::date`,[date]);
  const payments=await pool.query(`SELECT pm.name_ar payment_method,COUNT(*)::int transactions,COALESCE(SUM(sp.amount),0) amount
   FROM sale_payments sp JOIN payment_methods pm ON pm.id=sp.payment_method_id JOIN sales s ON s.id=sp.sale_id
   WHERE s.status='completed' AND COALESCE(s.completed_at,s.created_at)::date=$1::date
   GROUP BY pm.name_ar ORDER BY amount DESC`,[date]);
  const products=await pool.query(`WITH line_data AS (
   SELECT s.id sale_id,s.order_discount_amount,sl.product_id,sl.quantity,sl.line_total,
    SUM(sl.line_total) OVER(PARTITION BY s.id) sale_lines_total
   FROM sale_lines sl JOIN sales s ON s.id=sl.sale_id
   WHERE s.status='completed' AND COALESCE(s.completed_at,s.created_at)::date=$1::date
  )
  SELECT p.id product_id,p.sku,p.name_ar,COALESCE(SUM(ld.quantity),0) quantity,
   COALESCE(SUM(ld.line_total-CASE WHEN ld.sale_lines_total>0 THEN ld.order_discount_amount*ld.line_total/ld.sale_lines_total ELSE 0 END),0) net_sales
  FROM line_data ld JOIN products p ON p.id=ld.product_id
  GROUP BY p.id,p.sku,p.name_ar ORDER BY quantity DESC LIMIT 20`,[date]);
  res.json({date,summary:totals.rows[0],payments:payments.rows,top_products:products.rows});
 }catch(e){next(e);}
});

router.get("/reports/product-sales",async(req,res,next)=>{
 const range=dates(req,res);if(!range)return;
 const {from,to}=range,product=req.query.product_id||null,category=req.query.category_id||null;
 if(product&&!uuid.test(product))return res.status(400).json({error:"Invalid product_id"});
 if(category&&!uuid.test(category))return res.status(400).json({error:"Invalid category_id"});
 const values=[from,to,product,category];
 try{
  const r=await pool.query(`WITH line_data AS (
   SELECT s.id sale_id,s.order_discount_amount,sl.product_id,sl.unit_id,sl.quantity,sl.unit_price,sl.discount_amount,sl.line_total,
    SUM(sl.line_total) OVER(PARTITION BY s.id) sale_lines_total
   FROM sale_lines sl JOIN sales s ON s.id=sl.sale_id
   WHERE s.status='completed' AND COALESCE(s.completed_at,s.created_at)::date BETWEEN $1::date AND $2::date
  )
  SELECT p.id product_id,p.sku,p.name_ar,c.name_ar category_name,u.code unit_code,
   COALESCE(SUM(ld.quantity),0) sold_quantity,COALESCE(SUM(ld.quantity*ld.unit_price),0) gross_sales,
   COALESCE(SUM(ld.discount_amount),0) line_discounts,
   COALESCE(SUM(CASE WHEN ld.sale_lines_total>0 THEN ld.order_discount_amount*ld.line_total/ld.sale_lines_total ELSE 0 END),0) allocated_order_discount,
   COALESCE(SUM(ld.line_total-CASE WHEN ld.sale_lines_total>0 THEN ld.order_discount_amount*ld.line_total/ld.sale_lines_total ELSE 0 END),0) net_sales,
   COUNT(DISTINCT ld.sale_id)::int invoice_count
   FROM line_data ld JOIN products p ON p.id=ld.product_id LEFT JOIN categories c ON c.id=p.category_id JOIN units u ON u.id=ld.unit_id
   WHERE ($3::uuid IS NULL OR p.id=$3) AND ($4::uuid IS NULL OR p.category_id=$4)
   GROUP BY p.id,p.sku,p.name_ar,c.name_ar,u.code ORDER BY net_sales DESC`,values);
  res.json({from,to,items:r.rows,totals:{sold_quantity:r.rows.reduce((a,x)=>a+Number(x.sold_quantity),0),net_sales:r.rows.reduce((a,x)=>a+Number(x.net_sales),0)}});
 }catch(e){next(e);}
});

router.get("/reports/category-sales",async(req,res,next)=>{
 const range=dates(req,res);if(!range)return;
 const category=req.query.category_id;if(category&&!uuid.test(category))return res.status(400).json({error:"Invalid category_id"});
 try{
  const r=await pool.query(`WITH line_data AS (
   SELECT s.id sale_id,s.order_discount_amount,sl.product_id,sl.quantity,sl.line_total,
    SUM(sl.line_total) OVER(PARTITION BY s.id) sale_lines_total
   FROM sale_lines sl JOIN sales s ON s.id=sl.sale_id
   WHERE s.status='completed' AND COALESCE(s.completed_at,s.created_at)::date BETWEEN $1::date AND $2::date
  )
  SELECT c.id category_id,c.code category_code,c.name_ar category_name,
   COALESCE(SUM(ld.quantity),0) sold_quantity,
   COALESCE(SUM(ld.line_total-CASE WHEN ld.sale_lines_total>0 THEN ld.order_discount_amount*ld.line_total/ld.sale_lines_total ELSE 0 END),0) line_net_sales,
   COUNT(DISTINCT ld.sale_id)::int invoice_count
   FROM line_data ld JOIN products p ON p.id=ld.product_id JOIN categories c ON c.id=p.category_id
   WHERE ($3::uuid IS NULL OR c.id=$3)
   GROUP BY c.id,c.code,c.name_ar ORDER BY line_net_sales DESC`,[range.from,range.to,category||null]);
  res.json({from:range.from,to:range.to,items:r.rows});
 }catch(e){next(e);}
});
router.get("/reports/inventory",async(req,res,next)=>{
 const warehouse=req.query.warehouse_id;
 if(warehouse&&!uuid.test(warehouse))return res.status(400).json({error:"Invalid warehouse_id"});
 try{
  const r=await pool.query(`SELECT p.id product_id,p.sku,p.name_ar,c.name_ar category_name,w.id warehouse_id,w.name warehouse_name,
   COALESCE(SUM(sl.quantity_on_hand),0) quantity,
   COALESCE(SUM(sl.quantity_on_hand*sl.unit_cost)/NULLIF(SUM(sl.quantity_on_hand),0),0) weighted_avg_cost,
   COALESCE(SUM(sl.quantity_on_hand*sl.unit_cost),0) stock_value,
   COUNT(sl.id)::int lots_count
   FROM products p LEFT JOIN categories c ON c.id=p.category_id
   LEFT JOIN stock_lots sl ON sl.product_id=p.id AND sl.quantity_on_hand>0
   LEFT JOIN warehouses w ON w.id=sl.warehouse_id
   WHERE p.is_active=true AND ($1::uuid IS NULL OR w.id=$1)
   GROUP BY p.id,p.sku,p.name_ar,c.name_ar,w.id,w.name ORDER BY p.name_ar,w.name`,[warehouse||null]);
  res.json({items:r.rows,totals:{stock_value:r.rows.reduce((a,x)=>a+Number(x.stock_value),0),quantity:r.rows.reduce((a,x)=>a+Number(x.quantity),0)}});
 }catch(e){next(e);}
});

router.get("/reports/purchases",async(req,res,next)=>{
 const range=dates(req,res);if(!range)return;const {from,to}=range;
 const supplier=req.query.supplier_id;if(supplier&&!uuid.test(supplier))return res.status(400).json({error:"Invalid supplier_id"});
 try{
  const r=await pool.query(`SELECT po.id,po.reference_no,po.created_at,po.status,s.code supplier_code,s.name supplier_name,
   COUNT(pol.id)::int lines_count,COALESCE(SUM(pol.quantity),0) quantity,COALESCE(SUM(pol.quantity*pol.unit_price),0) order_value
   FROM purchase_orders po JOIN suppliers s ON s.id=po.supplier_id
   LEFT JOIN purchase_order_lines pol ON pol.purchase_order_id=po.id
   WHERE po.created_at::date BETWEEN $1::date AND $2::date AND ($3::uuid IS NULL OR s.id=$3)
   GROUP BY po.id,s.code,s.name ORDER BY po.created_at DESC`,[from,to,supplier||null]);
  res.json({from,to,items:r.rows,totals:{orders:r.rowCount,order_value:r.rows.reduce((a,x)=>a+Number(x.order_value),0)}});
 }catch(e){next(e);}
});

router.get("/reports/customers",async(req,res,next)=>{
 const range=dates(req,res);if(!range)return;
 try{
  const r=await pool.query(`SELECT c.id,c.customer_number,c.code,c.name,c.phone,COUNT(s.id)::int invoice_count,
   COALESCE(SUM(s.grand_total),0) sales_value,MAX(COALESCE(s.completed_at,s.created_at)) last_purchase
   FROM customers c LEFT JOIN sales s ON s.customer_id=c.id AND s.status='completed'
   AND COALESCE(s.completed_at,s.created_at)::date BETWEEN $1::date AND $2::date
   GROUP BY c.id ORDER BY sales_value DESC`,[range.from,range.to]);
  res.json({from:range.from,to:range.to,items:r.rows});
 }catch(e){next(e);}
});

router.get("/reports/suppliers",async(req,res,next)=>{
 const range=dates(req,res);if(!range)return;
 try{
  const r=await pool.query(`SELECT s.id,s.supplier_number,s.code,s.name,s.phone,COUNT(DISTINCT po.id)::int purchase_orders,
   COALESCE(SUM(pol.quantity*pol.unit_price),0) ordered_value
   FROM suppliers s LEFT JOIN purchase_orders po ON po.supplier_id=s.id AND po.created_at::date BETWEEN $1::date AND $2::date
   LEFT JOIN purchase_order_lines pol ON pol.purchase_order_id=po.id
   GROUP BY s.id ORDER BY ordered_value DESC`,[range.from,range.to]);
  res.json({from:range.from,to:range.to,items:r.rows});
 }catch(e){next(e);}
});

router.get("/reports/accounting",async(req,res,next)=>{
 const range=dates(req,res);if(!range)return;
 try{
  const r=await pool.query(`SELECT je.id,je.reference_no,je.source_type,je.entry_date,je.status,
   COALESCE(SUM(jl.debit),0) total_debit,COALESCE(SUM(jl.credit),0) total_credit
   FROM journal_entries je LEFT JOIN journal_lines jl ON jl.journal_entry_id=je.id
   WHERE je.entry_date BETWEEN $1::date AND $2::date
   GROUP BY je.id ORDER BY je.entry_date DESC,je.created_at DESC`,[range.from,range.to]);
  res.json({from:range.from,to:range.to,items:r.rows,totals:{debit:r.rows.reduce((a,x)=>a+Number(x.total_debit),0),credit:r.rows.reduce((a,x)=>a+Number(x.total_credit),0)}});
 }catch(e){next(e);}
});

router.get("/reports/delivery",async(req,res,next)=>{
 const range=dates(req,res);if(!range)return;
 try{
  const [rows,summary,channels]=await Promise.all([
   pool.query(`SELECT d.id,d.reference_no,d.status,d.source_channel,d.external_order_reference,
    d.created_at,d.delivered_at,d.delivery_fee,c.name customer_name,c.phone customer_phone,
    e.full_name courier_name,s.reference_no sale_reference,COALESCE(s.grand_total,0) sale_total,
    COALESCE(lines.line_count,0)::int line_count,COALESCE(lines.item_quantity,0) item_quantity
    FROM delivery_orders d JOIN customers c ON c.id=d.customer_id
    LEFT JOIN employees e ON e.id=d.courier_employee_id
    LEFT JOIN sales s ON s.id=d.sale_id
    LEFT JOIN LATERAL (SELECT COUNT(*) line_count,COALESCE(SUM(quantity),0) item_quantity
      FROM sale_lines WHERE sale_id=d.sale_id) lines ON TRUE
    WHERE d.created_at::date BETWEEN $1::date AND $2::date
    ORDER BY d.created_at DESC LIMIT 5000`,[range.from,range.to]),
   pool.query(`SELECT COUNT(*)::int order_count,
    COUNT(*) FILTER(WHERE d.status='delivered')::int delivered_count,
    COUNT(*) FILTER(WHERE d.status IN ('failed','cancelled'))::int failed_or_cancelled_count,
    COALESCE(SUM(d.delivery_fee),0) delivery_fees,
    COALESCE(SUM(CASE WHEN d.status='delivered' THEN s.grand_total ELSE 0 END),0) delivered_sales,
    COALESCE(SUM(CASE WHEN d.status NOT IN ('cancelled','failed') THEN s.grand_total ELSE 0 END),0) active_order_sales
    FROM delivery_orders d LEFT JOIN sales s ON s.id=d.sale_id
    WHERE d.created_at::date BETWEEN $1::date AND $2::date`,[range.from,range.to]),
   pool.query(`SELECT COALESCE(d.source_channel,'pos') source_channel,COUNT(*)::int orders,
    COALESCE(SUM(d.delivery_fee),0) delivery_fees,COALESCE(SUM(s.grand_total),0) sales
    FROM delivery_orders d LEFT JOIN sales s ON s.id=d.sale_id
    WHERE d.created_at::date BETWEEN $1::date AND $2::date
    GROUP BY d.source_channel ORDER BY orders DESC`,[range.from,range.to])
  ]);
  res.json({from:range.from,to:range.to,items:rows.rows,summary:summary.rows[0],channels:channels.rows});
 }catch(e){next(e);}
});

router.get("/reports/ecommerce",async(req,res,next)=>{
 const range=dates(req,res);if(!range)return;
 try{
  const r=await pool.query(`SELECT status,COUNT(*)::int orders,COUNT(sales_id)::int converted_orders
   FROM ecommerce_orders WHERE created_at::date BETWEEN $1::date AND $2::date GROUP BY status ORDER BY status`,[range.from,range.to]);
  res.json({from:range.from,to:range.to,items:r.rows});
 }catch(e){next(e);}
});

router.get("/reports/inventory-movements",async(req,res,next)=>{
 const range=dates(req,res);if(!range)return;
 try{
  const r=await pool.query(`SELECT sm.reference_no,sm.movement_type,p.sku,p.name_ar,w.name warehouse_name,
   sm.quantity_in,sm.quantity_out,sm.unit_cost,sm.created_at
   FROM stock_movements sm JOIN products p ON p.id=sm.product_id JOIN warehouses w ON w.id=sm.warehouse_id
   WHERE sm.created_at::date BETWEEN $1::date AND $2::date
   ORDER BY sm.created_at DESC LIMIT 2000`,[range.from,range.to]);
  res.json({from:range.from,to:range.to,items:r.rows});
 }catch(e){next(e);}
});
router.get("/reports/returns",async(req,res,next)=>{
 const range=dates(req,res);if(!range)return;
 try{
  const r=await pool.query(`SELECT sr.reference_no,s.reference_no sale_reference,c.name customer_name,sr.status,sr.reason,sr.created_at,
   COALESCE(SUM(srl.refund_amount),0) refund_total
   FROM sale_returns sr JOIN sales s ON s.id=sr.sale_id LEFT JOIN customers c ON c.id=s.customer_id
   LEFT JOIN sale_return_lines srl ON srl.return_id=sr.id
   WHERE sr.created_at::date BETWEEN $1::date AND $2::date
   GROUP BY sr.id,s.reference_no,c.name ORDER BY sr.created_at DESC`,[range.from,range.to]);
  res.json({from:range.from,to:range.to,items:r.rows});
 }catch(e){next(e);}
});
router.get("/reports/hr-assets",async(_req,res,next)=>{
 try{
  const [employees,shifts,assets,maintenance]=await Promise.all([
   pool.query("SELECT employment_status status,COUNT(*)::int count FROM employees GROUP BY employment_status ORDER BY employment_status"),
   pool.query("SELECT status,COUNT(*)::int count FROM employee_shifts WHERE starts_at::date=CURRENT_DATE GROUP BY status ORDER BY status"),
   pool.query("SELECT status,COUNT(*)::int count,COALESCE(SUM(purchase_cost),0) purchase_cost FROM fixed_assets GROUP BY status ORDER BY status"),
   pool.query("SELECT status,COUNT(*)::int count,COALESCE(SUM(cost),0) maintenance_cost FROM asset_maintenance WHERE scheduled_at=CURRENT_DATE OR completed_at=CURRENT_DATE GROUP BY status ORDER BY status")
  ]);
  res.json({employees:employees.rows,today_shifts:shifts.rows,assets:assets.rows,today_maintenance:maintenance.rows});
 }catch(e){next(e);}
});

export default router;
