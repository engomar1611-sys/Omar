import {Router} from "express";
import {randomBytes,scrypt as scryptCb} from "node:crypto";
import {promisify} from "node:util";
import {pool} from "../db.js";

const router=Router();
const scrypt=promisify(scryptCb);
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const hash=async password=>{
 const salt=randomBytes(16),derived=await scrypt(password,salt,64);
 return "scrypt$"+salt.toString("base64url")+"$"+Buffer.from(derived).toString("base64url");
};
const validText=(v,n=100)=>typeof v==="string"&&v.trim().length>0&&v.trim().length<=n;

router.get("/users",async(_req,res,next)=>{try{
 const r=await pool.query(`SELECT u.id,u.username,u.display_name,u.is_active,u.created_at,
   COALESCE(array_agg(DISTINCT roles.code) FILTER(WHERE roles.code IS NOT NULL),'{}') role_codes
   FROM users u LEFT JOIN user_roles ur ON ur.user_id=u.id LEFT JOIN roles ON roles.id=ur.role_id
   GROUP BY u.id ORDER BY u.username`);
 res.json({items:r.rows});
}catch(e){next(e);}});

router.post("/users",async(req,res,next)=>{
 const {username,display_name,password,role_codes=[]}=req.body??{};
 if(!validText(username,80)||username.trim().length<3||!validText(display_name,160)||
    typeof password!=="string"||password.length<12||password.length>200||
    !Array.isArray(role_codes)||role_codes.length>20||role_codes.some(x=>!validText(x,60)))
  return res.status(400).json({error:"Invalid user fields; password must contain at least 12 characters"});
 const roles=role_codes.length?role_codes:["CASHIER"];
 const client=await pool.connect();
 try{
  await client.query("BEGIN");
  const found=await client.query("SELECT id,code FROM roles WHERE code=ANY($1::varchar[])",[roles]);
  if(found.rowCount!==roles.length)throw Object.assign(new Error("One or more role codes do not exist"),{statusCode:400});
  const u=await client.query("INSERT INTO users(username,password_hash,display_name) VALUES($1,$2,$3) RETURNING id,username,display_name,is_active,created_at",[username.trim(),await hash(password),display_name.trim()]);
  for(const role of found.rows)await client.query("INSERT INTO user_roles(user_id,role_id) VALUES($1,$2)",[u.rows[0].id,role.id]);
  await client.query("COMMIT");
  res.status(201).json({...u.rows[0],role_codes:found.rows.map(x=>x.code)});
 }catch(e){await client.query("ROLLBACK");if(e.statusCode)return res.status(e.statusCode).json({error:e.message});next(e);}
 finally{client.release();}
});

router.patch("/users/:id/status",async(req,res,next)=>{
 const {is_active}=req.body??{};
 if(!uuid.test(req.params.id)||typeof is_active!=="boolean")return res.status(400).json({error:"Invalid user status"});
 if(req.params.id===req.user.id&&!is_active)return res.status(409).json({error:"You cannot deactivate your own active session"});
 try{
  const r=await pool.query("UPDATE users SET is_active=$2 WHERE id=$1 RETURNING id,username,display_name,is_active",[req.params.id,is_active]);
  if(!r.rowCount)return res.status(404).json({error:"User not found"});
  res.json(r.rows[0]);
 }catch(e){next(e);}
});

router.get("/roles",async(_req,res,next)=>{try{
 const r=await pool.query(`SELECT r.id,r.code,r.name,
   COALESCE(array_agg(DISTINCT p.code) FILTER(WHERE p.code IS NOT NULL),'{}') permission_codes
   FROM roles r LEFT JOIN role_permissions rp ON rp.role_id=r.id LEFT JOIN permissions p ON p.id=rp.permission_id
   GROUP BY r.id ORDER BY r.code`);
 res.json({items:r.rows});
}catch(e){next(e);}});

router.get("/permissions",async(_req,res,next)=>{try{
 const r=await pool.query("SELECT code,description FROM permissions ORDER BY code");
 res.json({items:r.rows});
}catch(e){next(e);}});

router.put("/roles/:code/permissions",async(req,res,next)=>{
 const {permission_codes}=req.body??{};
 if(!validText(req.params.code,60)||!Array.isArray(permission_codes)||permission_codes.length>100||
    permission_codes.some(x=>!validText(x,100)))return res.status(400).json({error:"Invalid role permission list"});
 if(req.params.code==="SUPER_ADMIN")return res.status(409).json({error:"SUPER_ADMIN permissions cannot be reduced through this endpoint"});
 const client=await pool.connect();
 try{
  await client.query("BEGIN");
  const role=await client.query("SELECT id FROM roles WHERE code=$1 FOR UPDATE",[req.params.code]);
  if(!role.rowCount)throw Object.assign(new Error("Role not found"),{statusCode:404});
  const perms=await client.query("SELECT id,code FROM permissions WHERE code=ANY($1::varchar[])",[permission_codes]);
  if(perms.rowCount!==new Set(permission_codes).size)throw Object.assign(new Error("One or more permission codes do not exist"),{statusCode:400});
  await client.query("DELETE FROM role_permissions WHERE role_id=$1",[role.rows[0].id]);
  for(const p of perms.rows)await client.query("INSERT INTO role_permissions(role_id,permission_id) VALUES($1,$2)",[role.rows[0].id,p.id]);
  await client.query("COMMIT");
  res.json({role_code:req.params.code,permission_codes:perms.rows.map(x=>x.code)});
 }catch(e){await client.query("ROLLBACK");if(e.statusCode)return res.status(e.statusCode).json({error:e.message});next(e);}
 finally{client.release();}
});
export default router;
