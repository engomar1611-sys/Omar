import { Router } from "express";
import { pool } from "../db.js";

const router=Router();
const txt=(v,n=240)=>typeof v==="string"&&v.trim().length>0&&v.trim().length<=n;
const num=(v)=>v!==null&&v!==undefined&&v!==""&&Number.isFinite(Number(v))&&Number(v)>0;

// Stage only: no products or prices become operational until a separately authorized approval workflow exists.
router.post("/product-imports",async(req,res,next)=>{
  const {source_name,source_url=null,rows}=req.body??{};
  if(!txt(source_name,200)||!Array.isArray(rows)||rows.length<1||rows.length>1000)
    return res.status(400).json({error:"source_name and 1..1000 rows are required"});
  const client=await pool.connect();
  try{
    await client.query("BEGIN");
    const batch=(await client.query(
      "INSERT INTO product_import_batches(source_name,source_url,row_count,status) VALUES($1,$2,$3,'review') RETURNING *",
      [source_name.trim(),source_url,rows.length])).rows[0];
    const codes=[...new Set(rows.flatMap(r=>[r?.category_code,r?.base_unit_code,r?.pack_unit_code].filter(Boolean)))];
    const dict=await client.query(
      "SELECT code,'category' AS kind FROM categories WHERE code=ANY($1::text[]) UNION ALL SELECT code,'unit' AS kind FROM units WHERE code=ANY($1::text[])",[codes]);
    const knownCats=new Set(dict.rows.filter(x=>x.kind==="category").map(x=>x.code));
    const knownUnits=new Set(dict.rows.filter(x=>x.kind==="unit").map(x=>x.code));
    const staged=[];
    for(let i=0;i<rows.length;i++){
      const r=rows[i]??{},errors=[];
      if(!txt(r.name_ar,240))errors.push("name_ar is required (max 240)");
      if(!txt(r.category_code,60)||!knownCats.has(r.category_code))errors.push("unknown or missing category_code");
      if(!txt(r.base_unit_code,20)||!knownUnits.has(r.base_unit_code))errors.push("unknown or missing base_unit_code");
      if(r.pack_size!==undefined&&r.pack_size!==""&&!num(r.pack_size))errors.push("pack_size must be positive");
      if(r.is_weighted!==undefined&&typeof r.is_weighted!=="boolean")errors.push("is_weighted must be boolean");
      if(r.tracks_expiry!==undefined&&typeof r.tracks_expiry!=="boolean")errors.push("tracks_expiry must be boolean");
      if(r.retail_price!==undefined&&r.retail_price!==""&&(!Number.isFinite(Number(r.retail_price))||Number(r.retail_price)<0))errors.push("retail_price must be non-negative");
      if(r.purchase_price!==undefined&&r.purchase_price!==""&&(!Number.isFinite(Number(r.purchase_price))||Number(r.purchase_price)<0))errors.push("purchase_price must be non-negative");
      if(r.manufacturer_barcode!==undefined&&r.manufacturer_barcode!==""&&!txt(r.manufacturer_barcode,80))errors.push("invalid manufacturer_barcode");
      if(r.brand_code!==undefined&&r.brand_code!==""&&!txt(r.brand_code,40))errors.push("invalid brand_code");
      staged.push({row_number:i+1,raw_data:r,validation_errors:errors,status:errors.length?"rejected":"pending"});
    }
    for(const r of staged){
      await client.query(
        "INSERT INTO product_import_rows(batch_id,row_number,raw_data,validation_errors,status) VALUES($1,$2,$3::jsonb,$4::jsonb,$5)",
        [batch.id,r.row_number,JSON.stringify(r.raw_data),JSON.stringify(r.validation_errors),r.status]);
    }
    const rejected=staged.filter(r=>r.status==="rejected").length;
    await client.query("UPDATE product_import_batches SET rejected_count=$2,accepted_count=$3 WHERE id=$1",
      [batch.id,rejected,staged.length-rejected]);
    await client.query("COMMIT");
    res.status(201).json({batch_id:batch.id,status:"review",row_count:staged.length,valid_for_review:staged.length-rejected,rejected,rows:staged.map(({row_number,validation_errors,status})=>({row_number,validation_errors,status}))});
  }catch(e){await client.query("ROLLBACK");next(e);}
  finally{client.release();}
});

router.get("/product-imports/:id",async(req,res,next)=>{
  try{
    const batch=await pool.query("SELECT * FROM product_import_batches WHERE id=$1",[req.params.id]);
    if(!batch.rowCount)return res.status(404).json({error:"Import batch not found"});
    const rows=await pool.query("SELECT row_number,raw_data,validation_errors,status FROM product_import_rows WHERE batch_id=$1 ORDER BY row_number",[req.params.id]);
    res.json({batch:batch.rows[0],rows:rows.rows});
  }catch(e){next(e);}
});

router.post("/product-imports/:id/approve",async(req,res,next)=>{
  const client=await pool.connect();
  try{
    await client.query("BEGIN");
    const batch=await client.query("SELECT * FROM product_import_batches WHERE id=$1 FOR UPDATE",[req.params.id]);
    if(!batch.rowCount){await client.query("ROLLBACK");return res.status(404).json({error:"Import batch not found"});}
    if(batch.rows[0].status!=="review"){await client.query("ROLLBACK");return res.status(409).json({error:"Batch is not awaiting review"});}
    const staged=await client.query("SELECT * FROM product_import_rows WHERE batch_id=$1 AND status='pending' ORDER BY row_number FOR UPDATE",[req.params.id]);
    const created=[];
    for(const row of staged.rows){
      const r=row.raw_data;
      const category=await client.query("SELECT id FROM categories WHERE code=$1 AND is_active=true",[r.category_code]);
      const unit=await client.query("SELECT id,dimension FROM units WHERE code=$1",[r.base_unit_code]);
      const packUnit=r.pack_unit_code?await client.query("SELECT id,dimension FROM units WHERE code=$1",[r.pack_unit_code]):null;
      const brand=r.brand_code?await client.query("SELECT id FROM brands WHERE code=$1 AND is_active=true",[r.brand_code]):null;
      if(!category.rowCount||!unit.rowCount||(r.pack_unit_code&&!packUnit.rowCount)||(r.brand_code&&(!brand||!brand.rowCount))){
        await client.query("UPDATE product_import_rows SET status='rejected',validation_errors=validation_errors || '[\"Reference code not found during approval\"]'::jsonb WHERE id=$1",[row.id]);
        continue;
      }
      const sku=r.sku&&String(r.sku).trim()?String(r.sku).trim():(await client.query("SELECT 'NF-'||lpad(nextval('product_sku_seq')::text,8,'0') AS sku")).rows[0].sku;
      const product=await client.query(
        `INSERT INTO products(sku,name_ar,name_en,category_id,brand_id,base_unit_id,is_weighted,tracks_expiry,pack_size,pack_unit_id,variant_description)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING id,sku,name_ar`,
        [sku,r.name_ar,r.name_en||null,category.rows[0].id,brand?.rows[0]?.id||null,unit.rows[0].id,!!r.is_weighted,!!r.tracks_expiry,r.pack_size||null,packUnit?.rows[0]?.id||null,r.variant_description||null]
      );
      if(r.manufacturer_barcode){
        await client.query("INSERT INTO product_barcodes(product_id,barcode,barcode_type) VALUES($1,$2,'standard')",[product.rows[0].id,String(r.manufacturer_barcode)]);
      }
      const priceSourceName=r.price_source||batch.rows[0].source_name;
      const sourceType=["supplier_quote","retail_observation","official_feed","manual"].includes(r.price_source_type)?r.price_source_type:"manual";
      const source=await client.query(
        "INSERT INTO price_sources(name,source_type,source_url,region) VALUES($1,$2,$3,$4) RETURNING id",
        [priceSourceName,sourceType,r.source_url||batch.rows[0].source_url||null,r.price_region||null]
      );
      for(const [field,type] of [["purchase_price","purchase"],["retail_price","retail"],["wholesale_price","wholesale"]]){
        if(r[field]!==undefined&&r[field]!==""&&Number.isFinite(Number(r[field]))&&Number(r[field])>=0){
          await client.query(
            "INSERT INTO product_prices(product_id,price_type,amount,source_id,observed_at) VALUES($1,$2,$3,$4,COALESCE($5::timestamptz,now()))",
            [product.rows[0].id,type,Number(r[field]),source.rows[0].id,r.price_observed_at||null]
          );
        }
      }
      await client.query("UPDATE product_import_rows SET status='accepted',product_id=$2 WHERE id=$1",[row.id,product.rows[0].id]);
      created.push(product.rows[0]);
    }
    const counts=await client.query("SELECT count(*) FILTER(WHERE status='accepted')::int AS accepted,count(*) FILTER(WHERE status='rejected')::int AS rejected FROM product_import_rows WHERE batch_id=$1",[req.params.id]);
    await client.query("UPDATE product_import_batches SET status='approved',accepted_count=$2,rejected_count=$3 WHERE id=$1",[req.params.id,counts.rows[0].accepted,counts.rows[0].rejected]);
    await client.query("COMMIT");
    res.json({batch_id:req.params.id,status:"approved",created_count:created.length,accepted_count:counts.rows[0].accepted,rejected_count:counts.rows[0].rejected,products:created});
  }catch(e){await client.query("ROLLBACK");next(e);}
  finally{client.release();}
});

export default router;
