import "dotenv/config";
import express from "express";
import helmet from "helmet";
import cors from "cors";
import pg from "pg";

const { Pool } = pg;
const app = express();
const port = Number(process.env.PORT || 3000);
const host = process.env.HOST || "0.0.0.0";
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 20,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 5_000
});

app.disable("x-powered-by");
app.use(helmet());
app.use(cors({
  origin: (process.env.CORS_ORIGINS || "http://localhost:5173")
    .split(",").map((value) => value.trim()),
  credentials: true
}));
app.use(express.json({ limit: "1mb" }));

app.get("/api/health", (_req, res) => {
  res.json({
    application: "NEW FEED SUPERMARKET ERP",
    status: "ok",
    version: "0.1.0",
    timestamp: new Date().toISOString()
  });
});

app.get("/api/health/database", async (_req, res) => {
  try {
    const result = await pool.query("SELECT current_timestamp AS database_time");
    res.json({ status: "ok", databaseTime: result.rows[0].database_time });
  } catch (error) {
    res.status(503).json({
      status: "unavailable",
      message: "Database connection failed"
    });
  }
});

app.use("/api", (_req, res) => {
  res.status(404).json({ error: "API route not found" });
});

app.use((error, _req, res, _next) => {
  console.error(error);
  res.status(500).json({ error: "Internal server error" });
});

const server = app.listen(port, host, () => {
  console.log(`NEW FEED ERP API listening on http://${host}:${port}`);
});

async function shutdown() {
  server.close(async () => {
    await pool.end();
    process.exit(0);
  });
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
