import { Router } from "express";
import { pool } from "../db.js";

const router = Router();
const text = (v, max = 240) => typeof v === "string" && v.trim() && v.trim().length <= max;
const positive = (v) => Number.isFinite(Number(v)) && Number(v) > 0;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

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
  try {
    const { rows } = await pool.query(
      `SELECT p.*, c.name_ar AS category_name, u.code AS base_unit_code
       FROM products p LEFT JOIN categories c ON c.id=p.category_id
       JOIN units u ON u.id=p.base_unit_id
       WHERE ($1::boolean OR p.is_active)
       ORDER BY p.name_ar LIMIT $2 OFFSET $3`,
      [req.query.include_inactive === "true",limit,offset]
    );
    res.json({ items: rows, limit, offset });
  } catch(e) { next(e); }
});

router.post("/products", async (req,res,next) => {
  const { sku,name_ar,name_en=null,category_id=null,base_unit_id,is_weighted=false,tracks_expiry=false,barcodes=[] } = req.body ?? {};
  if (!text(sku,80) || !text(name_ar,240) || !uuid.test(base_unit_id||"") ||
      (category_id && !uuid.test(category_id)) || typeof is_weighted !== "boolean" ||
      typeof tracks_expiry !== "boolean" || !Array.isArray(barcodes) || barcodes.length>20 ||
      barcodes.some(b => !text(b,80))) {
    return res.status(400).json({ error: "Invalid product fields or barcode list" });
  }
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const inserted = await client.query(
      `INSERT INTO products(sku,name_ar,name_en,category_id,base_unit_id,is_weighted,tracks_expiry)
       VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
      [sku.trim(),name_ar.trim(),name_en,category_id,base_unit_id,is_weighted,tracks_expiry]
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
  const {code,name,phone=null} = req.body ?? {};
  if (!text(code,60)||!text(name,200)) return res.status(400).json({error:"Invalid supplier fields"});
  try {
    const {rows}=await pool.query(
      "INSERT INTO suppliers(code,name,phone) VALUES($1,$2,$3) RETURNING *",
      [code.trim(),name.trim(),phone]
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
  const {code,name,phone=null}=req.body ?? {};
  if (!text(code,60)||!text(name,200)) return res.status(400).json({error:"Invalid customer fields"});
  try {
    const {rows}=await pool.query(
      "INSERT INTO customers(code,name,phone) VALUES($1,$2,$3) RETURNING *",
      [code.trim(),name.trim(),phone]
    );
    res.status(201).json(rows[0]);
  } catch(e) { next(e); }
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
