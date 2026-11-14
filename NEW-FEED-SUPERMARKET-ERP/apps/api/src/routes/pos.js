import {Router} from "express";
import {pool} from "../db.js";
const router=Router();

router.get("/pos/context",async(req,res,next)=>{
  try{
    const [branch,payments]=await Promise.all([
      pool.query("SELECT id,code,name FROM branches WHERE code='MAIN' AND is_active=true LIMIT 1"),
      pool.query("SELECT id,code,name_ar FROM payment_methods WHERE is_active=true ORDER BY code")
    ]);
    if(!branch.rowCount)return res.status(409).json({error:"Create an active branch before opening POS"});
    res.json({user:req.user,branch:branch.rows[0],payment_methods:payments.rows});
  }catch(e){next(e);}
});
export default router;
