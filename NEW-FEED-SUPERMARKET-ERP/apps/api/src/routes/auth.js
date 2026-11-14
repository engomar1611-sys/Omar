import {Router} from "express";
import {randomBytes,scrypt as scryptCb,timingSafeEqual} from "node:crypto";
import {promisify} from "node:util";
import {pool} from "../db.js";
import {authenticate,createAccessToken} from "../auth.js";

const router=Router();
const scrypt=promisify(scryptCb);
const hashPassword=async(password)=>{
  const salt=randomBytes(16);
  const derived=await scrypt(password,salt,64);
  return "scrypt$"+salt.toString("base64url")+"$"+Buffer.from(derived).toString("base64url");
};
const verifyPassword=async(password,stored)=>{
  if(typeof stored!=="string"||!stored.startsWith("scrypt$"))return false;
  const parts=stored.split("$");
  if(parts.length!==3)return false;
  const salt=Buffer.from(parts[1],"base64url"),expected=Buffer.from(parts[2],"base64url");
  if(!salt.length||expected.length!==64)return false;
  const actual=Buffer.from(await scrypt(password,salt,64));
  return timingSafeEqual(actual,expected);
};

router.post("/bootstrap",async(req,res,next)=>{
  const {bootstrap_secret,username,display_name,password}=req.body??{};
  const configured=process.env.BOOTSTRAP_SECRET||"";
  if(configured.length<24)return res.status(503).json({error:"Set BOOTSTRAP_SECRET to at least 24 characters before first setup"});
  const a=Buffer.from(configured),b=Buffer.from(typeof bootstrap_secret==="string"?bootstrap_secret:"");
  if(a.length!==b.length||!timingSafeEqual(a,b))return res.status(403).json({error:"Invalid bootstrap secret"});
  if(typeof username!=="string"||username.trim().length<3||username.trim().length>80||
     typeof display_name!=="string"||!display_name.trim()||
     typeof password!=="string"||password.length<12||password.length>200)
    return res.status(400).json({error:"Username, display name and a password of at least 12 characters are required"});
  const client=await pool.connect();
  try{
    await client.query("BEGIN");
    const count=await client.query("SELECT COUNT(*)::int count FROM users");
    if(count.rows[0].count!==0)throw Object.assign(new Error("Initial administrator has already been created"),{statusCode:409});
    const user=await client.query(
      "INSERT INTO users(username,password_hash,display_name) VALUES($1,$2,$3) RETURNING id,username,display_name",
      [username.trim(),await hashPassword(password),display_name.trim()]);
    const role=await client.query(
      "INSERT INTO roles(code,name) VALUES('SUPER_ADMIN','مدير النظام') ON CONFLICT(code) DO UPDATE SET name=EXCLUDED.name RETURNING id");
    await client.query("INSERT INTO user_roles(user_id,role_id) VALUES($1,$2)",[user.rows[0].id,role.rows[0].id]);
    await client.query("COMMIT");
    res.status(201).json({user:user.rows[0],access_token:createAccessToken(user.rows[0].id),token_type:"Bearer",expires_in:28800});
  }catch(e){
    await client.query("ROLLBACK");
    if(e.statusCode)return res.status(e.statusCode).json({error:e.message});
    next(e);
  }finally{client.release();}
});

router.post("/login",async(req,res,next)=>{
  const {username,password}=req.body??{};
  if(typeof username!=="string"||typeof password!=="string"||!username.trim()||!password)
    return res.status(400).json({error:"Username and password are required"});
  if((process.env.JWT_SECRET||"").length<32)
    return res.status(503).json({error:"JWT_SECRET must contain at least 32 characters"});
  try{
    const r=await pool.query("SELECT id,username,display_name,password_hash FROM users WHERE username=$1 AND is_active=true",[username.trim()]);
    if(!r.rowCount||!(await verifyPassword(password,r.rows[0].password_hash)))
      return res.status(401).json({error:"Invalid username or password"});
    res.json({user:{id:r.rows[0].id,username:r.rows[0].username,display_name:r.rows[0].display_name},access_token:createAccessToken(r.rows[0].id),token_type:"Bearer",expires_in:28800});
  }catch(e){next(e);}
});

router.get("/me",authenticate,async(req,res)=>res.json({user:req.user}));
export default router;
