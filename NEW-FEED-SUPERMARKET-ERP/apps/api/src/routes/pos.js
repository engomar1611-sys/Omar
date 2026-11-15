import {Router} from "express";
import {pool} from "../db.js";
const router=Router();

router.get("/payment-banks",async(req,res,next)=>{try{const q=String(req.query.q||"").trim();const r=await pool.query("SELECT id,code,name_ar,name_en FROM payment_banks WHERE is_active=true AND ($1='' OR name_ar ILIKE $2 OR name_en ILIKE $2 OR code ILIKE $2) ORDER BY name_ar LIMIT 100",[q,q?"%"+q+"%":""]);res.json({items:r.rows});}catch(e){next(e);}});

router.get("/pos/context",async(req,res,next)=>{
  try{
    const [branch,payments,taxCodes,cashSession,loyaltySettings]=await Promise.all([
      pool.query("SELECT id,code,name FROM branches WHERE code='MAIN' AND is_active=true LIMIT 1"),
      pool.query("SELECT id,code,name_ar FROM payment_methods WHERE is_active=true ORDER BY code"),
      pool.query("SELECT id,code,name_ar,rate FROM tax_codes WHERE is_active=true ORDER BY code"),
      pool.query("SELECT id,reference_no,cashbox_id,opened_at FROM cash_sessions WHERE cashier_id=$1 AND status='open' ORDER BY opened_at DESC LIMIT 1",[req.user.id]),
      pool.query("SELECT points_per_egp,egp_per_point,is_active FROM loyalty_program_settings WHERE id=1")
    ]);
    if(!branch.rowCount)return res.status(409).json({error:"Create an active branch before opening POS"});
    const permissions=await pool.query(`SELECT DISTINCT p.code FROM user_roles ur JOIN role_permissions rp ON rp.role_id=ur.role_id JOIN permissions p ON p.id=rp.permission_id WHERE ur.user_id=$1`,[req.user.id]);
    res.json({user:req.user,branch:branch.rows[0],payment_methods:payments.rows,tax_codes:taxCodes.rows,cash_session:cashSession.rows[0]||null,loyalty_settings:loyaltySettings.rows[0]||{points_per_egp:0,egp_per_point:0,is_active:false},permission_codes:permissions.rows.map(x=>x.code)});
  }catch(e){next(e);}
});
export default router;
