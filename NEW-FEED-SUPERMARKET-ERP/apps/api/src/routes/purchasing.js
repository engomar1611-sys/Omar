import { Router } from "express";
import { pool } from "../db.js";

const router = Router();
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const validText = (v,n=60) => typeof v==="string" && v.trim().length>0 && v.trim().length<=n;
const positive = (v) => Number.isFinite(Number(v)) && Number(v)>0;

router.get("/purchase-receipts",async(_req,res,next)=>{try{
 const r=await pool.query(`SELECT pr.*,po.reference_no purchase_order_reference,s.name supplier_name,w.name warehouse_name
 FROM purchase_receipts pr JOIN purchase_orders po ON po.id=pr.purchase_order_id
 JOIN suppliers s ON s.id=po.supplier_id JOIN warehouses w ON w.id=pr.warehouse_id
 ORDER BY pr.received_at DESC LIMIT 200`);
 res.json({items:r.rows});
}catch(e){next(e);}});
router.get("/purchase-receipts/:id",async(req,res,next)=>{if(!uuid.test(req.params.id))return res.status(400).json({error:"Invalid receipt id"});try{
 const receipt=await pool.query("SELECT pr.*,po.reference_no purchase_order_reference,s.name supplier_name,w.name warehouse_name FROM purchase_receipts pr JOIN purchase_orders po ON po.id=pr.purchase_order_id JOIN suppliers s ON s.id=po.supplier_id JOIN warehouses w ON w.id=pr.warehouse_id WHERE pr.id=$1",[req.params.id]);
 if(!receipt.rowCount)return res.status(404).json({error:"Receipt not found"});
 const lines=await pool.query("SELECT prl.*,p.sku,p.name_ar product_name,p.tracks_expiry FROM purchase_receipt_lines prl JOIN products p ON p.id=prl.product_id WHERE prl.receipt_id=$1 ORDER BY p.name_ar",[req.params.id]);
 res.json({receipt:receipt.rows[0],lines:lines.rows});
}catch(e){next(e);}});
router.get("/purchase-orders/:id",async(req,res,next)=>{if(!uuid.test(req.params.id))return res.status(400).json({error:"Invalid purchase order id"});try{
 const order=await pool.query("SELECT po.*,s.name supplier_name,b.name branch_name FROM purchase_orders po JOIN suppliers s ON s.id=po.supplier_id JOIN branches b ON b.id=po.branch_id WHERE po.id=$1",[req.params.id]);
 if(!order.rowCount)return res.status(404).json({error:"Purchase order not found"});
 const lines=await pool.query("SELECT pol.*,p.sku,p.name_ar product_name,u.code unit_code FROM purchase_order_lines pol JOIN products p ON p.id=pol.product_id JOIN units u ON u.id=pol.unit_id WHERE pol.purchase_order_id=$1 ORDER BY p.name_ar",[req.params.id]);
 res.json({purchase_order:order.rows[0],lines:lines.rows});
}catch(e){next(e);}});
router.get("/purchase-orders", async (_req,res,next) => {
  try {
    const {rows}=await pool.query(
      `SELECT po.*, s.name AS supplier_name, b.name AS branch_name
       FROM purchase_orders po JOIN suppliers s ON s.id=po.supplier_id
       JOIN branches b ON b.id=po.branch_id ORDER BY po.created_at DESC LIMIT 200`
    );
    res.json({items:rows});
  } catch(e){next(e);}
});

router.post("/purchase-orders", async (req,res,next) => {
  const {reference_no,supplier_id,branch_id,lines}=req.body??{};
  const created_by=req.user.id;
  if(!validText(reference_no,50)||!uuid.test(supplier_id||"")||!uuid.test(branch_id||"")||
     (created_by&&!uuid.test(created_by))||!Array.isArray(lines)||lines.length===0||lines.length>500||
     lines.some(x=>!uuid.test(x.product_id||"")||!uuid.test(x.unit_id||"")||!positive(x.quantity)||
       !Number.isFinite(Number(x.unit_price))||Number(x.unit_price)<0)){
    return res.status(400).json({error:"Invalid purchase order or line fields"});
  }
  const client=await pool.connect();
  try{
    await client.query("BEGIN");
    const po=await client.query(
      `INSERT INTO purchase_orders(reference_no,supplier_id,branch_id,created_by,status)
       VALUES($1,$2,$3,$4,'submitted') RETURNING *`,
      [reference_no.trim(),supplier_id,branch_id,created_by]
    );
    for(const line of lines){
      await client.query(
        `INSERT INTO purchase_order_lines(purchase_order_id,product_id,unit_id,quantity,unit_price)
         VALUES($1,$2,$3,$4,$5)`,
        [po.rows[0].id,line.product_id,line.unit_id,line.quantity,line.unit_price]
      );
    }
    await client.query("COMMIT");
    res.status(201).json({purchase_order:po.rows[0],line_count:lines.length});
  }catch(e){await client.query("ROLLBACK");next(e);}
  finally{client.release();}
});

router.post("/purchase-orders/:id/approve", async (req,res,next) => {
  if(!uuid.test(req.params.id)) return res.status(400).json({error:"Invalid purchase order id"});
  try{
    const result=await pool.query(
      `UPDATE purchase_orders SET status='approved'
       WHERE id=$1 AND status='submitted' RETURNING *`,[req.params.id]
    );
    if(!result.rowCount) return res.status(409).json({error:"Order is not in submitted state"});
    res.json(result.rows[0]);
  }catch(e){next(e);}
});

router.post("/purchase-orders/:id/receive", async (req,res,next) => {
  const {reference_no,warehouse_id,lines}=req.body??{};
  const received_by=req.user.id;
  if(!uuid.test(req.params.id)||!validText(reference_no,60)||!uuid.test(warehouse_id||"")||
     (received_by&&!uuid.test(received_by))||!Array.isArray(lines)||lines.length===0||lines.length>500||
     lines.some(x=>!uuid.test(x.product_id||"")||!positive(x.quantity)||
       !Number.isFinite(Number(x.unit_cost))||Number(x.unit_cost)<0||
       (x.expiry_date&&!/^\d{4}-\d{2}-\d{2}$/.test(x.expiry_date)))){
    return res.status(400).json({error:"Invalid receipt fields"});
  }
  const client=await pool.connect();
  try{
    await client.query("BEGIN");
    const order=await client.query(
      "SELECT * FROM purchase_orders WHERE id=$1 FOR UPDATE",[req.params.id]
    );
    if(!order.rowCount||!["approved","ordered","part_received"].includes(order.rows[0].status)){
      await client.query("ROLLBACK");
      return res.status(409).json({error:"Purchase order must be approved before receipt"});
    }
    const wh=await client.query("SELECT id FROM warehouses WHERE id=$1 FOR UPDATE",[warehouse_id]);
    if(!wh.rowCount) throw Object.assign(new Error("Warehouse not found"),{code:"23503"});
    const receipt=await client.query(
      `INSERT INTO purchase_receipts(reference_no,purchase_order_id,warehouse_id,received_by,inspection_status)
       VALUES($1,$2,$3,$4,'pending_inspection') RETURNING *`,
      [reference_no.trim(),req.params.id,warehouse_id,received_by]
    );
    for(const line of lines){
      const ordered=await client.query(
        `SELECT COALESCE(SUM(pol.quantity),0) AS ordered,
                COALESCE((SELECT SUM(CASE WHEN pr.inspection_status='pending_inspection' THEN prl.quantity ELSE prl.accepted_quantity END)
                          FROM purchase_receipt_lines prl
                          JOIN purchase_receipts pr ON pr.id=prl.receipt_id
                          WHERE pr.purchase_order_id=pol.purchase_order_id
                            AND pr.inspection_status IN ('pending_inspection','accepted')
                            AND prl.product_id=pol.product_id),0) AS received
         FROM purchase_order_lines pol
         WHERE pol.purchase_order_id=$1 AND pol.product_id=$2
         GROUP BY pol.purchase_order_id`,
        [req.params.id,line.product_id]
      );
      if(!ordered.rowCount) throw Object.assign(new Error("Product is not part of this purchase order"),{statusCode:400});
      const remaining=Number(ordered.rows[0].ordered)-Number(ordered.rows[0].received);
      if(Number(line.quantity)>remaining+0.000001)
        throw Object.assign(new Error("Received quantity exceeds the remaining ordered quantity"),{statusCode:409});
      const product=await client.query("SELECT tracks_expiry FROM products WHERE id=$1",[line.product_id]);
      if(!product.rowCount) throw Object.assign(new Error("Product not found"),{code:"23503"});
      if(product.rows[0].tracks_expiry&&!line.expiry_date) throw Object.assign(new Error("Expiry date is required for this product"),{statusCode:400});
      const lot=await client.query(
        `INSERT INTO stock_lots(product_id,warehouse_id,lot_number,expiry_date,quantity_on_hand,unit_cost,is_saleable)
         VALUES($1,$2,$3,$4,0,$5,FALSE) RETURNING id`,
        [line.product_id,warehouse_id,line.lot_number||null,line.expiry_date||null,line.unit_cost]
      );
      await client.query(
        `INSERT INTO purchase_receipt_lines(receipt_id,product_id,quantity,unit_cost,lot_number,expiry_date,stock_lot_id)
         VALUES($1,$2,$3,$4,$5,$6,$7)`,
        [receipt.rows[0].id,line.product_id,line.quantity,line.unit_cost,line.lot_number||null,line.expiry_date||null,lot.rows[0].id]
      );
    }
    // Receipt remains in progress until warehouse inspection accepts quantities.
    await client.query("UPDATE purchase_orders SET status='part_received' WHERE id=$1",[req.params.id]);
    await client.query("COMMIT");
    res.status(201).json({receipt:receipt.rows[0],accepted_lines:lines.length});
  }catch(e){await client.query("ROLLBACK");next(e);}
  finally{client.release();}
});


router.post("/purchase-receipts/:id/inspect", async (req,res,next) => {
  const {lines}=req.body??{};
  const inspected_by=req.user.id;
  if(!uuid.test(req.params.id)||(inspected_by&&!uuid.test(inspected_by))||
     !Array.isArray(lines)||!lines.length||lines.length>500||
     lines.some(x=>!uuid.test(x.receipt_line_id||"")||
       !Number.isFinite(Number(x.accepted_quantity))||Number(x.accepted_quantity)<0||
       !Number.isFinite(Number(x.rejected_quantity))||Number(x.rejected_quantity)<0))
    return res.status(400).json({error:"Invalid inspection fields"});
  const client=await pool.connect();
  try{
    await client.query("BEGIN");
    const receipt=await client.query("SELECT * FROM purchase_receipts WHERE id=$1 FOR UPDATE",[req.params.id]);
    if(!receipt.rowCount||receipt.rows[0].inspection_status!=="pending_inspection")
      throw Object.assign(new Error("Receipt is not awaiting inspection"),{statusCode:409});
    const expected=await client.query("SELECT id,product_id,quantity,unit_cost,stock_lot_id FROM purchase_receipt_lines WHERE receipt_id=$1 FOR UPDATE",[req.params.id]);
    if(expected.rowCount!==lines.length) throw Object.assign(new Error("Inspection must include every receipt line exactly once"),{statusCode:400});
    const seen=new Set();
    let acceptedValue=0;
    for(const x of lines){
      if(seen.has(x.receipt_line_id)) throw Object.assign(new Error("Duplicate receipt line"),{statusCode:400});
      seen.add(x.receipt_line_id);
      const row=expected.rows.find(r=>r.id===x.receipt_line_id);
      if(!row) throw Object.assign(new Error("Receipt line not found"),{statusCode:400});
      const accepted=Number(x.accepted_quantity),rejected=Number(x.rejected_quantity);
      if(Math.abs(accepted+rejected-Number(row.quantity))>0.000001)
        throw Object.assign(new Error("Accepted plus rejected quantity must equal received quantity"),{statusCode:400});
      await client.query("UPDATE purchase_receipt_lines SET accepted_quantity=$2,rejected_quantity=$3 WHERE id=$1",[row.id,accepted,rejected]);
      await client.query("UPDATE stock_lots SET quantity_on_hand=$2,is_saleable=($2>0) WHERE id=$1",[row.stock_lot_id,accepted]);
      if(accepted>0){
        acceptedValue+=accepted*Number(row.unit_cost);
        await client.query(
          "INSERT INTO stock_movements(reference_no,movement_type,product_id,warehouse_id,lot_id,quantity_in,unit_cost,source_type,source_id,created_by) SELECT $1,'purchase_receipt',$2,warehouse_id,$3,$4,$5,'purchase_receipt',$6,$7 FROM stock_lots WHERE id=$3",
          [receipt.rows[0].reference_no,row.product_id,row.stock_lot_id,accepted,row.unit_cost,req.params.id,inspected_by]
        );
      }
    }
    const anyAccepted=lines.some(x=>Number(x.accepted_quantity)>0);
    await client.query("UPDATE purchase_receipts SET inspection_status=$2 WHERE id=$1",[req.params.id,anyAccepted?"accepted":"rejected"]);
    if(acceptedValue>0){
      const period=await client.query("SELECT 1 FROM accounting_periods WHERE status='closed' AND CURRENT_DATE BETWEEN starts_on AND ends_on LIMIT 1");
      if(period.rowCount)throw Object.assign(new Error("The current accounting period is closed"),{statusCode:409});
      const mappings=await client.query("SELECT mapping_key,account_id FROM system_account_mappings WHERE mapping_key=ANY($1::varchar[])",[["inventory","grni"]]);
      const map=Object.fromEntries(mappings.rows.map(x=>[x.mapping_key,x.account_id]));
      if(!map.inventory||!map.grni)throw Object.assign(new Error("Inventory/GRNI account mappings are missing; apply migration 012"),{statusCode:409});
      const je=await client.query("INSERT INTO journal_entries(reference_no,source_type,source_id,entry_date,status) VALUES($1,'purchase_receipt',$2,CURRENT_DATE,'posted') RETURNING id",["JE-"+req.params.id,req.params.id]);
      await client.query("INSERT INTO journal_lines(journal_entry_id,account_id,debit,credit) VALUES($1,$2,$3,0)",[je.rows[0].id,map.inventory,acceptedValue]);
      await client.query("INSERT INTO journal_lines(journal_entry_id,account_id,debit,credit) VALUES($1,$2,0,$3)",[je.rows[0].id,map.grni,acceptedValue]);
    }
    const orderId=receipt.rows[0].purchase_order_id;
    const remaining=await client.query(
      "SELECT EXISTS(SELECT 1 FROM purchase_order_lines pol WHERE pol.purchase_order_id=$1 AND pol.quantity > COALESCE((SELECT SUM(prl.accepted_quantity) FROM purchase_receipt_lines prl JOIN purchase_receipts pr ON pr.id=prl.receipt_id WHERE pr.purchase_order_id=pol.purchase_order_id AND pr.inspection_status='accepted' AND prl.product_id=pol.product_id),0)+0.000001) AS has_remaining",
      [orderId]
    );
    await client.query("UPDATE purchase_orders SET status=$2 WHERE id=$1",[orderId,remaining.rows[0].has_remaining?"part_received":"received"]);
    await client.query("COMMIT");
    res.json({receipt_id:req.params.id,inspection_status:anyAccepted?"accepted":"rejected",accepted_lines:lines.filter(x=>Number(x.accepted_quantity)>0).length,rejected_lines:lines.filter(x=>Number(x.rejected_quantity)>0).length});
  }catch(e){await client.query("ROLLBACK");if(e.statusCode)return res.status(e.statusCode).json({error:e.message});next(e);}
  finally{client.release();}
});

export default router;
