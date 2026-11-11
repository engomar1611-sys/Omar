import pg from 'pg';
import { config } from '../config/env.mjs';

const { Pool } = pg;

export const pool = new Pool({
  connectionString: config.databaseUrl,
  max: 15,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 5_000,
  application_name: 'new-feed-erp-api'
});

pool.on('error', (error) => {
  console.error('Unexpected PostgreSQL pool error', error);
});

export async function checkDatabase() {
  const result = await pool.query('SELECT 1 AS connected');
  return result.rows[0]?.connected === 1;
}
