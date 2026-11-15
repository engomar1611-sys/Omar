import {Router} from "express";
import {pool} from "../db.js";
const router=Router();

router.get("/payment-banks",async(req,res,next)=>{try{const q=String(req.query.q||"").trim();const r=await pool.query("SELECT id,code,name_ar,name_en FROM payment_banks WHERE is_active=true AND ($1='' OR name_ar ILIKE $2 OR name_en ILIKE $2 OR code ILIKE $2) ORDER BY name_ar LIMIT 100",[q,q?"%"+q+"%":""]);res.json({items:r.rows});}catch(e){next(e);}});

router.get("/pos/context",async(req,res,next)=>{
  try{
    const [branch,payments]=await Promise.all([
      pool.query("SELECT id,code,name FROM branches WHERE code='MAIN' AND is_active=true LIMIT 1"),
      pool.query("SELECT id,code,name_ar FROM payment_methods WHERE is_active=true ORDER BY code")
    ]);
    if(!branch.rowCount)return res.status(409).json({error:"Create an active branch before opening POS"});
    const permissions=await pool.query(`SELECT DISTINCT p.code FROM user_roles ur JOIN role_permissions rp ON rp.role_id=ur.role_id JOIN permissions p ON p.id=rp.permission_id WHERE ur.user_id=$1`,[req.user.id]);
    res.json({user:req.user,branch:branch.rows[0],payment_methods:payments.rows,permission_codes:permissions.rows.map(x=>x.code)});
  }catch(e){next(e);}
});
export default router;
