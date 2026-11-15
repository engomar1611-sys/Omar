import { Router } from "express";
import { pool } from "../db.js";
import { requirePermission } from "../auth.js";

const router = Router();
const text = (v, max = 240) => typeof v === "string" && v.trim() && v.trim().length <= max;
const positive = (v) => Number.isFinite(Number(v)) && Number(v) > 0;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

router.get("/catalog/export-permission",requirePermission("catalog.export"),(_req,res)=>res.json({allowed:true}));

router.get("/categories", async (_req, res, next) => {
  try {
    const { rows } = await pool.query(
      "SELECT id,parent_id,code,name_ar,name_en,is_active FROM categories ORDER BY name_ar"
    );
    res.json({ items: rows });
  } catch (e) { next(e); }
});

router.post("/categories", async (req, res, next) => {
  const { code, name_ar, name_en = null, parent_id = null } = req.body ?? {};
  if (!text(code,60) || !text(name_ar,160) || (parent_id && !uuid.test(parent_id))) {
    return res.status(400).json({ error: "Invalid category fields" });
  }
  try {
    const { rows } = await pool.query(
      "INSERT INTO categories(code,name_ar,name_en,parent_id) VALUES($1,$2,$3,$4) RETURNING *",
      [code.trim(),name_ar.trim(),name_en,parent_id]
    );
    res.status(201).json(rows[0]);
  } catch (e) { next(e); }
});

router.get("/units", async (_req,res,next) => {
  try {
    const { rows } = await pool.query("SELECT * FROM units ORDER BY dimension,code");
    res.json({ items: rows });
  } catch(e) { next(e); }
});

router.post("/units", async (req,res,next) => {
  const { code,name_ar,name_en=null,dimension,base_factor } = req.body ?? {};
  if (!text(code,20) || !text(name_ar,80) || !["count","mass","volume","length"].includes(dimension) || !positive(base_factor)) {
    return res.status(400).json({ error: "Invalid unit fields" });
  }
  try {
    const { rows } = await pool.query(
      "INSERT INTO units(code,name_ar,name_en,dimension,base_factor) VALUES($1,$2,$3,$4,$5) RETURNING *",
      [code.trim(),name_ar.trim(),name_en,dimension,base_factor]
    );
    res.status(201).json(rows[0]);
  } catch(e) { next(e); }
});

router.get("/products", async (req,res,next) => {
  const limit = Math.min(Math.max(Number(req.query.limit)||50,1),200);
  const offset = Math.max(Number(req.query.offset)||0,0);
  const term=String(req.query.q||req.query.search||"").trim().slice(0,120);
  try {
    const { rows } = await pool.query(
      `SELECT p.*, c.name_ar AS category_name, u.code AS base_unit_code,
              rp.amount AS retail_price, pp.amount AS purchase_price,
              primary_supplier.supplier_id, primary_supplier.supplier_name,
              primary_supplier.supplier_code, primary_supplier.supplier_product_code,
              COALESCE((SELECT json_agg(pb.barcode ORDER BY pb.barcode)
                        FROM product_barcodes pb WHERE pb.product_id=p.id),'[]'::json) AS barcodes
       FROM products p LEFT JOIN categories c ON c.id=p.category_id
       JOIN units u ON u.id=p.base_unit_id
       LEFT JOIN LATERAL (
         SELECT amount FROM product_prices
         WHERE product_id=p.id AND price_type='retail'
           AND valid_from<=now() AND (valid_to IS NULL OR valid_to>now())
         ORDER BY observed_at DESC,created_at DESC LIMIT 1
       ) rp ON TRUE
       LEFT JOIN LATERAL (
         SELECT amount FROM product_prices
         WHERE product_id=p.id AND price_type='purchase'
         ORDER BY observed_at DESC,created_at DESC LIMIT 1
       ) pp ON TRUE
       LEFT JOIN LATERAL (
         SELECT ps.supplier_id,s.name supplier_name,s.code supplier_code,ps.supplier_product_code
         FROM product_suppliers ps JOIN suppliers s ON s.id=ps.supplier_id
         WHERE ps.product_id=p.id ORDER BY ps.is_primary DESC,s.name LIMIT 1
       ) primary_supplier ON TRUE
       WHERE ($1::boolean OR p.is_active)
         AND ($2='' OR p.name_ar ILIKE '%'||$2||'%' OR COALESCE(p.name_en,'') ILIKE '%'||$2||'%'
              OR p.sku ILIKE '%'||$2||'%'
              OR EXISTS(SELECT 1 FROM product_barcodes pb WHERE pb.product_id=p.id AND pb.barcode ILIKE '%'||$2||'%'))
       ORDER BY p.name_ar LIMIT $3 OFFSET $4`,
      [req.query.include_inactive === "true",term,limit,offset]
    );
    res.json({ items: rows, limit, offset, search:term });
  } catch(e) { next(e); }
});

router.put("/products/:id/supplier",requirePermission("catalog.edit"),async(req,res,next)=>{
  const {supplier_id=null,supplier_product_code=null,last_purchase_price=null}=req.body??{};
  if(!uuid.test(req.params.id)||(supplier_id!==null&&!uuid.test(supplier_id))||
     (supplier_product_code!==null&&(typeof supplier_product_code!=="string"||supplier_product_code.length>100))||
     (last_purchase_price!==null&&(!Number.isFinite(Number(last_purchase_price))||Number(last_purchase_price)<0)))
    return res.status(400).json({error:"Invalid product supplier fields"});
  const client=await pool.connect();
  try{
    await client.query("BEGIN");
    const product=await client.query("SELECT id FROM products WHERE id=$1 FOR UPDATE",[req.params.id]);
    if(!product.rowCount)throw Object.assign(new Error("Product not found"),{statusCode:404});
    if(supplier_id){
      const supplier=await client.query("SELECT id FROM suppliers WHERE id=$1 AND is_active=true",[supplier_id]);
      if(!supplier.rowCount)throw Object.assign(new Error("Supplier not found or inactive"),{statusCode:400});
      await client.query("UPDATE product_suppliers SET is_primary=false WHERE product_id=$1",[req.params.id]);
      const saved=await client.query(`INSERT INTO product_suppliers(supplier_id,product_id,supplier_product_code,last_purchase_price,is_primary)
        VALUES($1,$2,$3,$4,true)
        ON CONFLICT(supplier_id,product_id) DO UPDATE SET supplier_product_code=EXCLUDED.supplier_product_code,
        last_purchase_price=COALESCE(EXCLUDED.last_purchase_price,product_suppliers.last_purchase_price),is_primary=true
        RETURNING *`,[supplier_id,req.params.id,supplier_product_code,last_purchase_price]);
      await client.query("COMMIT");return res.json({supplier:saved.rows[0]});
    }
    await client.query("UPDATE product_suppliers SET is_primary=false WHERE product_id=$1",[req.params.id]);
    await client.query("COMMIT");res.json({supplier:null});
  }catch(e){await client.query("ROLLBACK");if(e.statusCode)return res.status(e.statusCode).json({error:e.message});next(e);}
  finally{client.release();}
});

router.patch("/products/:id", async(req,res,next) => {
  if(!uuid.test(req.params.id))return res.status(400).json({error:"Invalid product id"});
  const {sku,name_ar,name_en=null,category_id=null,brand_id=null,base_unit_id,is_weighted,tracks_expiry,pack_size=null,pack_unit_id=null,variant_description=null,is_active=true}=req.body??{};
  if(!text(name_ar,240)||!uuid.test(base_unit_id||"")||(category_id&&!uuid.test(category_id))||(brand_id&&!uuid.test(brand_id))||(pack_unit_id&&!uuid.test(pack_unit_id))||(pack_size!==null&&!positive(pack_size))||typeof is_weighted!=="boolean"||typeof tracks_expiry!=="boolean"||typeof is_active!=="boolean"||(sku!==undefined&&!text(sku,80)))
    return res.status(400).json({error:"Invalid product fields"});
  try{
    const r=await pool.query(
      `UPDATE products SET sku=COALESCE($2,sku),name_ar=$3,name_en=$4,category_id=$5,brand_id=$6,base_unit_id=$7,
       is_weighted=$8,tracks_expiry=$9,pack_size=$10,pack_unit_id=$11,variant_description=$12,is_active=$13
       WHERE id=$1 RETURNING *`,
      [req.params.id,sku?.trim()||null,name_ar.trim(),name_en,category_id,brand_id,base_unit_id,is_weighted,tracks_expiry,pack_size,pack_unit_id,variant_description,is_active]);
    if(!r.rowCount)return res.status(404).json({error:"Product not found"});
    res.json(r.rows[0]);
  }catch(e){next(e);}
});

router.post("/products", async (req,res,next) => {
  const { sku=null,name_ar,name_en=null,category_id=null,brand_id=null,base_unit_id,is_weighted=false,tracks_expiry=false,pack_size=null,pack_unit_id=null,variant_description=null,barcodes=[] } = req.body ?? {};
  if ((sku!==null && !text(sku,80)) || !text(name_ar,240) || !uuid.test(base_unit_id||"") ||
      (category_id && !uuid.test(category_id)) || (brand_id && !uuid.test(brand_id)) ||
      (pack_unit_id && !uuid.test(pack_unit_id)) || (pack_size!==null && !positive(pack_size)) || typeof is_weighted !== "boolean" ||
      typeof tracks_expiry !== "boolean" || !Array.isArray(barcodes) || barcodes.length>20 ||
      barcodes.some(b => !text(b,80))) {
    return res.status(400).json({ error: "Invalid product fields or barcode list" });
  }
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const skuResult = sku
      ? { rows: [{ sku: sku.trim() }] }
      : await client.query("SELECT 'NF-' || lpad(nextval('product_sku_seq')::text,8,'0') AS sku");
    const finalSku = skuResult.rows[0].sku;
    const inserted = await client.query(
      `INSERT INTO products(sku,name_ar,name_en,category_id,brand_id,base_unit_id,is_weighted,tracks_expiry,pack_size,pack_unit_id,variant_description)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
      [finalSku,name_ar.trim(),name_en,category_id,brand_id,base_unit_id,is_weighted,tracks_expiry,pack_size,pack_unit_id,variant_description]
    );
    for (const barcode of [...new Set(barcodes.map(b=>b.trim()))]) {
      await client.query(
        "INSERT INTO product_barcodes(product_id,barcode) VALUES($1,$2)",
        [inserted.rows[0].id,barcode]
      );
    }
    await client.query("COMMIT");
    res.status(201).json(inserted.rows[0]);
  } catch(e) {
    await client.query("ROLLBACK");
    next(e);
  } finally { client.release(); }
});

router.get("/products/:id/barcodes", async (req,res,next) => {
  if (!uuid.test(req.params.id)) return res.status(400).json({error:"Invalid product id"});
  try {
    const { rows } = await pool.query(
      "SELECT id,barcode,barcode_type,unit_id,is_scale_barcode FROM product_barcodes WHERE product_id=$1 ORDER BY barcode",
      [req.params.id]
    );
    res.json({ items: rows });
  } catch(e) { next(e); }
});

router.post("/products/:id/barcodes", async (req,res,next) => {
  const { barcode,barcode_type="standard",unit_id=null,is_scale_barcode=false } = req.body ?? {};
  if (!uuid.test(req.params.id) || !text(barcode,80) || !["standard","scale","internal"].includes(barcode_type) ||
      (unit_id && !uuid.test(unit_id)) || typeof is_scale_barcode!=="boolean") {
    return res.status(400).json({error:"Invalid barcode fields"});
  }
  try {
    const { rows } = await pool.query(
      `INSERT INTO product_barcodes(product_id,barcode,barcode_type,unit_id,is_scale_barcode)
       VALUES($1,$2,$3,$4,$5) RETURNING *`,
      [req.params.id,barcode.trim(),barcode_type,unit_id,is_scale_barcode]
    );
    res.status(201).json(rows[0]);
  } catch(e) { next(e); }
});

router.get("/suppliers", async (_req,res,next) => {
  try {
    const { rows } = await pool.query("SELECT * FROM suppliers ORDER BY name");
    res.json({items:rows});
  } catch(e) { next(e); }
});

router.post("/suppliers", async (req,res,next) => {
  const {code,name,phone=null,email=null,tax_number=null,address=null} = req.body ?? {};
  if (!text(code,60)||!text(name,200)) return res.status(400).json({error:"Invalid supplier fields"});
  try {
    const {rows}=await pool.query(
      "INSERT INTO suppliers(code,name,phone,email,tax_number,address) VALUES($1,$2,$3,$4,$5,$6) RETURNING *",
      [code.trim(),name.trim(),phone,email,tax_number,address]
    );
    res.status(201).json(rows[0]);
  } catch(e) { next(e); }
});

router.get("/customers", async (_req,res,next) => {
  try {
    const {rows}=await pool.query("SELECT * FROM customers ORDER BY name");
    res.json({items:rows});
  } catch(e) { next(e); }
});

router.post("/customers", async (req,res,next) => {
  const {code,name,phone=null,email=null,address=null}=req.body ?? {};
  if (!text(code,60)||!text(name,200)) return res.status(400).json({error:"Invalid customer fields"});
  try {
    const {rows}=await pool.query(
      "INSERT INTO customers(code,name,phone,email,address) VALUES($1,$2,$3,$4,$5) RETURNING *",
      [code.trim(),name.trim(),phone,email,address]
    );
    res.status(201).json(rows[0]);
  } catch(e) { next(e); }
});

router.get("/suppliers/:id/products",async(req,res,next)=>{
  if(!uuid.test(req.params.id))return res.status(400).json({error:"Invalid supplier id"});
  try{
    const {rows}=await pool.query(`SELECT ps.*,p.sku,p.name_ar,p.name_en,u.code base_unit_code
      FROM product_suppliers ps JOIN products p ON p.id=ps.product_id JOIN units u ON u.id=p.base_unit_id
      WHERE ps.supplier_id=$1 ORDER BY p.name_ar`,[req.params.id]);
    res.json({items:rows});
  }catch(e){next(e);}
});
router.post("/suppliers/:id/products",async(req,res,next)=>{
  const {product_id,supplier_product_code=null,last_purchase_price=null,is_primary=false}=req.body??{};
  if(!uuid.test(req.params.id)||!uuid.test(product_id||"")||(last_purchase_price!==null&&(!Number.isFinite(Number(last_purchase_price))||Number(last_purchase_price)<0))||typeof is_primary!=="boolean")
    return res.status(400).json({error:"Invalid supplier product fields"});
  const client=await pool.connect();
  try{
    await client.query("BEGIN");
    if(is_primary)await client.query("UPDATE product_suppliers SET is_primary=FALSE WHERE product_id=$1",[product_id]);
    const r=await client.query(`INSERT INTO product_suppliers(supplier_id,product_id,supplier_product_code,last_purchase_price,is_primary)
      VALUES($1,$2,$3,$4,$5) ON CONFLICT(supplier_id,product_id) DO UPDATE SET
      supplier_product_code=EXCLUDED.supplier_product_code,last_purchase_price=EXCLUDED.last_purchase_price,is_primary=EXCLUDED.is_primary
      RETURNING *`,[req.params.id,product_id,supplier_product_code,last_purchase_price,is_primary]);
    await client.query("COMMIT");res.status(201).json(r.rows[0]);
  }catch(e){await client.query("ROLLBACK");next(e);}finally{client.release();}
});
router.get("/warehouses", async (_req,res,next) => {
  try {
    const {rows}=await pool.query(
      "SELECT w.*,b.code AS branch_code FROM warehouses w JOIN branches b ON b.id=w.branch_id ORDER BY w.name"
    );
    res.json({items:rows});
  } catch(e) { next(e); }
});

router.post("/warehouses", async (req,res,next) => {
  const {code,name,branch_id}=req.body ?? {};
  if (!text(code,40)||!text(name,160)||!uuid.test(branch_id||"")) return res.status(400).json({error:"Invalid warehouse fields"});
  try {
    const {rows}=await pool.query(
      "INSERT INTO warehouses(code,name,branch_id) VALUES($1,$2,$3) RETURNING *",
      [code.trim(),name.trim(),branch_id]
    );
    res.status(201).json(rows[0]);
  } catch(e) { next(e); }
});

export default router;
