import "dotenv/config";
import express from "express";
import helmet from "helmet";
import cors from "cors";
import { pool } from "./db.js";
import catalogRoutes from "./routes/catalog.js";
import purchasingRoutes from "./routes/purchasing.js";

const app = express();
const port = Number(process.env.PORT || 3000);
const host = process.env.HOST || "0.0.0.0";

app.disable("x-powered-by");
app.use(helmet());
app.use(cors({
  origin: (process.env.CORS_ORIGINS || "http://localhost:5173").split(",").map((v) => v.trim()),
  credentials: true
}));
app.use(express.json({ limit: "1mb" }));

app.get("/api/health", (_req, res) => res.json({
  application: "NEW FEED SUPERMARKET ERP",
  status: "ok",
  version: "0.1.0",
  timestamp: new Date().toISOString()
}));

app.get("/api/health/database", async (_req, res) => {
  try {
    const result = await pool.query("SELECT current_timestamp AS database_time");
    res.json({ status: "ok", databaseTime: result.rows[0].database_time });
  } catch {
    res.status(503).json({ status: "unavailable", message: "Database connection failed" });
  }
});

app.use("/api", catalogRoutes);
app.use("/api", purchasingRoutes);
app.use("/api", (_req, res) => res.status(404).json({ error: "API route not found" }));

app.use((error, _req, res, _next) => {
  if (error?.code === "23505") return res.status(409).json({ error: "A record with this unique value already exists" });
  if (error?.code === "23503") return res.status(400).json({ error: "Referenced record does not exist" });
  console.error(error);
  res.status(500).json({ error: "Internal server error" });
});

const server = app.listen(port, host, () => console.log(`NEW FEED ERP API listening on http://${host}:${port}`));
async function shutdown() {
  server.close(async () => { await pool.end(); process.exit(0); });
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
