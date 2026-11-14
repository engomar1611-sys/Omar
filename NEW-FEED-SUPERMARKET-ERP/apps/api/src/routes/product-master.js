import { Router } from "express";
import { pool } from "../db.js";

const router=Router();
const validText=(v,n=200)=>typeof v==="string"&&v.trim().length>0&&v.trim().length<=n;
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

router.get("/brands",async(_req,res,next)=>{
  try{const {rows}=await pool.query("SELECT * FROM brands WHERE is_active=true ORDER BY name_ar");res.json({items:rows});}
  catch(e){next(e);}
});
router.post("/brands",async(req,res,next)=>{
  const {code,name_ar,name_en=null,manufacturer=null,country_of_origin=null}=req.body??{};
  if(!validText(code,40)||!validText(name_ar,160))return res.status(400).json({error:"Brand code and Arabic name are required"});
  try{const {rows}=await pool.query(
    "INSERT INTO brands(code,name_ar,name_en,manufacturer,country_of_origin) VALUES($1,$2,$3,$4,$5) RETURNING *",
    [code.trim(),name_ar.trim(),name_en,manufacturer,country_of_origin]);
    res.status(201).json(rows[0]);}catch(e){next(e);}
});

router.get("/products/:id/prices",async(req,res,next)=>{
  if(!uuid.test(req.params.id))return res.status(400).json({error:"Invalid product id"});
  try{const {rows}=await pool.query(
    `SELECT pp.*,ps.name AS source_name,ps.region,ps.source_url
     FROM product_prices pp LEFT JOIN price_sources ps ON ps.id=pp.source_id
     WHERE pp.product_id=$1 ORDER BY pp.observed_at DESC LIMIT 100`,[req.params.id]);
    res.json({items:rows});}catch(e){next(e);}
});
router.post("/products/:id/prices",async(req,res,next)=>{
  const {price_type,amount,source_id=null,observed_at=null,notes=null}=req.body??{};
  if(!uuid.test(req.params.id)||!["purchase","retail","wholesale","promotion"].includes(price_type)||
    !Number.isFinite(Number(amount))||Number(amount)<0||(source_id&&!uuid.test(source_id)))
    return res.status(400).json({error:"Invalid price record"});
  try{
    const {rows}=await pool.query(
      `INSERT INTO product_prices(product_id,price_type,amount,source_id,observed_at,notes)
       VALUES($1,$2,$3,$4,COALESCE($5::timestamptz,now()),$6) RETURNING *`,
      [req.params.id,price_type,amount,source_id,observed_at,notes]);
    res.status(201).json(rows[0]);
  }catch(e){next(e);}
});

router.post("/products/:id/internal-barcode",async(req,res,next)=>{
  if(!uuid.test(req.params.id))return res.status(400).json({error:"Invalid product id"});
  const client=await pool.connect();
  try{
    await client.query("BEGIN");
    const product=await client.query("SELECT id FROM products WHERE id=$1 FOR UPDATE",[req.params.id]);
    if(!product.rowCount){await client.query("ROLLBACK");return res.status(404).json({error:"Product not found"});}
    const seq=await client.query("SELECT nextval('product_barcode_seq') AS n");
    const barcode="NF"+String(seq.rows[0].n).padStart(12,"0");
    const inserted=await client.query(
      "INSERT INTO product_barcodes(product_id,barcode,barcode_type) VALUES($1,$2,'internal') RETURNING *",
      [req.params.id,barcode]);
    await client.query("COMMIT");
    res.status(201).json(inserted.rows[0]);
  }catch(e){await client.query("ROLLBACK");next(e);}
  finally{client.release();}
});

router.get("/products/:id/label",async(req,res,next)=>{
  if(!uuid.test(req.params.id))return res.status(400).send("Invalid product id");
  try{
    const result=await pool.query(
      `SELECT p.sku,p.name_ar,p.pack_size,u.name_ar AS pack_unit,
       pb.barcode,COALESCE(price.amount,0) AS retail_price
       FROM products p JOIN units u ON u.id=p.base_unit_id
       LEFT JOIN LATERAL (SELECT barcode FROM product_barcodes WHERE product_id=p.id ORDER BY created_at DESC LIMIT 1) pb ON true
       LEFT JOIN LATERAL (SELECT amount FROM product_prices WHERE product_id=p.id AND price_type='retail' ORDER BY observed_at DESC LIMIT 1) price ON true
       WHERE p.id=$1`,[req.params.id]);
    if(!result.rowCount)return res.status(404).send("Product not found");
    const p=result.rows[0];
    const sizes={"30x20":{w:30,h:20},"50x30":{w:50,h:30},"70x40":{w:70,h:40},"100x50":{w:100,h:50}};
    const size=sizes[req.query.size]||sizes["50x30"];
    const esc=v=>String(v??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
    res.type("html").send(`<!doctype html><html lang="ar" dir="rtl"><meta charset="utf-8"><title>ملصق الصنف</title>
    <style>@page{size:auto;margin:2mm}body{font-family:Arial,sans-serif;margin:0}.label{width:${size.w}mm;min-height:${size.h}mm;border:1px solid #ddd;padding:2mm;text-align:center;break-inside:avoid;box-sizing:border-box}.name{font-weight:bold;font-size:12px}.sku{font-size:9px;color:#555}svg{width:100%;height:${Math.max(7,size.h*.38)}mm}.price{font-size:13px;font-weight:bold}</style>
    <div class="label"><div class="name">${esc(p.name_ar)}</div><div class="sku">${esc(p.sku)}</div><svg id="barcode"></svg><div>${esc(p.barcode||"")}</div><div class="price">${Number(p.retail_price).toFixed(2)} ج.م</div></div>
    <script src="https://cdn.jsdelivr.net/npm/jsbarcode@3.11.6/dist/JsBarcode.all.min.js"><\/script><script>if(${JSON.stringify(p.barcode||"")})JsBarcode("#barcode",${JSON.stringify(p.barcode||"")},{format:"CODE128",displayValue:false,margin:0});window.onload=()=>window.print();</script></html>`);
  }catch(e){next(e);}
});

export default router;
