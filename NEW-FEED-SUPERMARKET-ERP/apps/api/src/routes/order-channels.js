import { Router } from "express";
import { pool } from "../db.js";

const router = Router();
const providers = new Set(["talabat","elmenus","breadfast","mrsool","generic"]);
const text = (v,n=160) => typeof v === "string" && v.trim().length > 0 && v.trim().length <= n;
const validUrl = (v) => !v || (typeof v === "string" && v.length <= 1000 && /^https:\/\//i.test(v));

router.get("/integrations/order-channels", async (_req,res,next) => {
  try {
    const r = await pool.query("SELECT id,provider_code,display_name,store_reference,api_base_url,sync_mode,is_enabled,connection_status,last_sync_at,last_error,created_at,updated_at FROM order_channel_integrations ORDER BY display_name");
    res.json({items:r.rows});
  } catch(e) { next(e); }
});

router.put("/integrations/order-channels/:provider", async (req,res,next) => {
  const provider = req.params.provider;
  const {display_name,store_reference=null,api_base_url=null,sync_mode="manual"} = req.body ?? {};
  if (!providers.has(provider) || !text(display_name,120) ||
      (store_reference !== null && !text(store_reference,160)) ||
      !validUrl(api_base_url) || !["manual","webhook","api"].includes(sync_mode)) {
    return res.status(400).json({error:"Invalid order channel configuration. API URLs must use HTTPS."});
  }
  try {
    const r = await pool.query(`
      INSERT INTO order_channel_integrations(provider_code,display_name,store_reference,api_base_url,sync_mode,is_enabled,connection_status)
      VALUES($1,$2,$3,$4,$5,FALSE,'awaiting_credentials')
      ON CONFLICT(provider_code) DO UPDATE SET
        display_name=EXCLUDED.display_name,store_reference=EXCLUDED.store_reference,
        api_base_url=EXCLUDED.api_base_url,sync_mode=EXCLUDED.sync_mode,
        connection_status=CASE WHEN order_channel_integrations.is_enabled THEN 'adapter_required' ELSE 'awaiting_credentials' END,
        updated_at=now()
      RETURNING id,provider_code,display_name,store_reference,api_base_url,sync_mode,is_enabled,connection_status,last_sync_at,last_error
    `,[provider,display_name.trim(),store_reference,api_base_url,sync_mode]);
    res.json(r.rows[0]);
  } catch(e) { next(e); }
});

router.patch("/integrations/order-channels/:id/status", async (req,res,next) => {
  const {is_enabled} = req.body ?? {};
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(req.params.id) || typeof is_enabled !== "boolean") {
    return res.status(400).json({error:"Invalid channel status"});
  }
  try {
    const r = await pool.query(`UPDATE order_channel_integrations
      SET is_enabled=$2,connection_status=CASE WHEN $2 THEN 'adapter_required' ELSE 'disabled' END,
      updated_at=now() WHERE id=$1
      RETURNING id,provider_code,display_name,is_enabled,connection_status`,[req.params.id,is_enabled]);
    if(!r.rowCount) return res.status(404).json({error:"Order channel not found"});
    res.json(r.rows[0]);
  } catch(e) { next(e); }
});

export default router;
