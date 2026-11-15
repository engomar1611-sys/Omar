import {createHmac,timingSafeEqual} from "node:crypto";
import {pool} from "./db.js";

const secret=()=>process.env.JWT_SECRET||"";
const sign=value=>createHmac("sha256",secret()).update(value).digest("base64url");

export async function authenticate(req,res,next){
  try{
    if(secret().length<32)return res.status(503).json({error:"JWT_SECRET must contain at least 32 characters"});
    const header=req.headers.authorization||"";
    const match=header.match(/^Bearer ([A-Za-z0-9_.-]+)$/);
    if(!match)return res.status(401).json({error:"Authentication required"});
    const parts=match[1].split(".");
    if(parts.length!==2)return res.status(401).json({error:"Invalid access token"});
    const expected=sign(parts[0]);
    const supplied=parts[1];
    const a=Buffer.from(expected),b=Buffer.from(supplied);
    if(a.length!==b.length||!timingSafeEqual(a,b))return res.status(401).json({error:"Invalid access token"});
    const payload=JSON.parse(Buffer.from(parts[0],"base64url").toString("utf8"));
    if(!payload.sub||!Number.isFinite(payload.exp)||payload.exp<=Math.floor(Date.now()/1000))
      return res.status(401).json({error:"Access token expired"});
    const user=await pool.query("SELECT id,username,display_name FROM users WHERE id=$1 AND is_active=true",[payload.sub]);
    if(!user.rowCount)return res.status(401).json({error:"User is inactive or does not exist"});
    req.user=user.rows[0];
    next();
  }catch(e){next(e);}
}

export function createAccessToken(userId){
  const payload=Buffer.from(JSON.stringify({sub:userId,exp:Math.floor(Date.now()/1000)+8*60*60})).toString("base64url");
  return payload+"."+sign(payload);
}


export async function authorizeModule(req,res,next){
  const method=req.method.toUpperCase(),path=req.path;
  const rules=[
    [/^\/product-imports\/[^/]+\/approve$/,"catalog.import.approve"],
    [/^\/product-imports(\/|$)/,method==="POST"?"catalog.import":"catalog.view"],
    [/^\/products\/[^/]+\/supplier$/,"catalog.edit"],
    [/^\/products\/[^/]+\/(prices|internal-barcode|barcodes)$/,method==="GET"?"catalog.view":"catalog.edit"],
    [/^\/products\/[^/]+\/label$/,"catalog.view"],
    [/^\/products\/[^/]+$/,method==="PATCH"?"catalog.edit":"catalog.view"],
    [/^\/products$/,method==="POST"?"catalog.create":"catalog.view"],
    [/^\/(categories|units|brands)(\/|$)/,method==="POST"?"catalog.create":"catalog.view"],
    [/^\/pos(\/|$)/,"sales.manage"],
    [/^\/(purchase-orders|purchase-receipts)(\/|$)/,"purchasing.manage"],
    [/^\/(supplier-invoices|supplier-payments)(\/|$)/,"supplier.accounting"],
    [/^\/sales\/returns\/[^/]+\/inspect$/,"returns.inspect"],
    [/^\/sales\/returns(\/|$)/,method==="GET"?"returns.view":method==="POST"&&/^\/sales\/returns\/[^/]+\/inspect$/.test(req.path)?"returns.inspect":method==="POST"&&/^\/sales\/returns\/[^/]+\/(approve|refund)$/.test(req.path)?"returns.approve":"sales.manage"],
    [/^\/sales(\/|$)/,"sales.manage"],
    [/^\/(inventory|warehouses)(\/|$)/,"inventory.manage"],
    [/^\/suppliers(\/|$)/,"purchasing.manage"],
    [/^\/customers(\/|$)/,"sales.manage"],
    [/^\/employees(\/|$)/,"hr.manage"],
    [/^\/assets(\/|$)/,"assets.manage"],
    [/^\/delivery(\/|$)/,"delivery.manage"],
    [/^\/ecommerce(\/|$)/,"ecommerce.manage"],
    [/^\/accounting(\/|$)/,"accounting.manage"],
    [/^\/(integrations\/order-channels)(\/|$)/,"ecommerce.manage"],
    [/^\/reports(\/|$)/,"reports.view"],
    [/^\/(users|roles|permissions)(\/|$)/,"users.manage"]
  ];
  const rule=rules.find(([pattern])=>pattern.test(req.path));
  if(!rule)return next();
  try{
    const r=await pool.query("SELECT 1 FROM user_roles ur JOIN role_permissions rp ON rp.role_id=ur.role_id JOIN permissions p ON p.id=rp.permission_id WHERE ur.user_id=$1 AND p.code=$2 LIMIT 1",[req.user.id,rule[1]]);
    if(!r.rowCount)return res.status(403).json({error:"Permission denied",required_permission:rule[1]});
    next();
  }catch(e){next(e);}
}

export function requirePermission(code){
  return async(req,res,next)=>{
    try{
      if(!req.user?.id)return res.status(401).json({error:"Authentication required"});
      const r=await pool.query(
        `SELECT 1 FROM user_roles ur
         JOIN role_permissions rp ON rp.role_id=ur.role_id
         JOIN permissions p ON p.id=rp.permission_id
         WHERE ur.user_id=$1 AND p.code=$2 LIMIT 1`,
        [req.user.id,code]);
      if(!r.rowCount)return res.status(403).json({error:"Permission denied"});
      next();
    }catch(e){next(e);}
  };
}
