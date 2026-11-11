import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import pg from 'pg';
import { validateConfig, config } from '../src/config/env.mjs';

validateConfig();
const { Client } = pg;
const migrationPath = fileURLToPath(new URL('../migrations/001_initial_schema.sql', import.meta.url));
const sql = await readFile(migrationPath, 'utf8');
const client = new Client({ connectionString: config.databaseUrl });

try {
  await client.connect();
  await client.query('BEGIN');
  await client.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version VARCHAR(120) PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  const version = '001_initial_schema';
  const existing = await client.query(
    'SELECT 1 FROM schema_migrations WHERE version = $1',
    [version]
  );
  if (existing.rowCount === 0) {
    await client.query(sql);
    await client.query('INSERT INTO schema_migrations(version) VALUES ($1)', [version]);
    console.log(`Applied migration: ${version}`);
  } else {
    console.log(`Migration already applied: ${version}`);
  }
  await client.query('COMMIT');
} catch (error) {
  await client.query('ROLLBACK').catch(() => {});
  console.error('Migration failed:', error);
  process.exitCode = 1;
} finally {
  await client.end();
}
