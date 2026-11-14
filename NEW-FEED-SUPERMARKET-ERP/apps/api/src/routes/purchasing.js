import { Router } from "express";
import { pool } from "../db.js";

const router = Router();
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const validText = (v,n=60) => typeof v==="string" && v.trim().length>0 && v.trim().length<=n;
const positive = (v) => Number.isFinite(Number(v)) && Number(v)>0;

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
  const {reference_no,supplier_id,branch_id,created_by=null,lines}=req.body??{};
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
  const {reference_no,warehouse_id,received_by=null,lines}=req.body??{};
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
      `INSERT INTO purchase_receipts(reference_no,purchase_order_id,warehouse_id,received_by)
       VALUES($1,$2,$3,$4) RETURNING *`,
      [reference_no.trim(),req.params.id,warehouse_id,received_by]
    );
    for(const line of lines){
      const ordered=await client.query(
        `SELECT COALESCE(SUM(pol.quantity),0) AS ordered,
                COALESCE((SELECT SUM(prl.quantity)
                          FROM purchase_receipt_lines prl
                          JOIN purchase_receipts pr ON pr.id=prl.receipt_id
                          WHERE pr.purchase_order_id=pol.purchase_order_id
                            AND pr.status='accepted'
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
        `INSERT INTO stock_lots(product_id,warehouse_id,lot_number,expiry_date,quantity_on_hand,unit_cost)
         VALUES($1,$2,$3,$4,$5,$6) RETURNING id`,
        [line.product_id,warehouse_id,line.lot_number||null,line.expiry_date||null,line.quantity,line.unit_cost]
      );
      await client.query(
        `INSERT INTO purchase_receipt_lines(receipt_id,product_id,quantity,unit_cost,lot_number,expiry_date,stock_lot_id)
         VALUES($1,$2,$3,$4,$5,$6,$7)`,
        [receipt.rows[0].id,line.product_id,line.quantity,line.unit_cost,line.lot_number||null,line.expiry_date||null,lot.rows[0].id]
      );
      await client.query(
        `INSERT INTO stock_movements(reference_no,movement_type,product_id,warehouse_id,lot_id,quantity_in,unit_cost,source_type,source_id,created_by)
         VALUES($1,'purchase_receipt',$2,$3,$4,$5,$6,'purchase_receipt',$7,$8)`,
        [reference_no.trim(),line.product_id,warehouse_id,lot.rows[0].id,line.quantity,line.unit_cost,receipt.rows[0].id,received_by]
      );
    }
    const balance=await client.query(
      `SELECT EXISTS(
         SELECT 1 FROM purchase_order_lines pol
         WHERE pol.purchase_order_id=$1
           AND pol.quantity > COALESCE((
             SELECT SUM(prl.quantity) FROM purchase_receipt_lines prl
             JOIN purchase_receipts pr ON pr.id=prl.receipt_id
             WHERE pr.purchase_order_id=pol.purchase_order_id
               AND pr.status='accepted' AND prl.product_id=pol.product_id
           ),0) + 0.000001
       ) AS has_remaining`,[req.params.id]
    );
    await client.query(
      "UPDATE purchase_orders SET status=$2 WHERE id=$1",
      [req.params.id,balance.rows[0].has_remaining?"part_received":"received"]
    );
    await client.query("COMMIT");
    res.status(201).json({receipt:receipt.rows[0],accepted_lines:lines.length});
  }catch(e){await client.query("ROLLBACK");next(e);}
  finally{client.release();}
});

export default router;
