import { readFile, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { validateConfig, config } from '../src/config/env.mjs';

validateConfig();
const { Client } = pg;
const migrationDirectory = fileURLToPath(new URL('../migrations/', import.meta.url));
const migrationFiles = (await readdir(migrationDirectory))
  .filter((name) => /^\d+_[a-z0-9_-]+\.sql$/i.test(name))
  .sort();
const client = new Client({ connectionString: config.databaseUrl });

try {
  await client.connect();
  await client.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version VARCHAR(120) PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  for (const fileName of migrationFiles) {
    const version = fileName.replace(/\.sql$/i, '');
    const existing = await client.query(
      'SELECT 1 FROM schema_migrations WHERE version = $1',
      [version]
    );
    if (existing.rowCount > 0) {
      console.log(`Migration already applied: ${version}`);
      continue;
    }

    const sql = await readFile(new URL(`../migrations/${fileName}`, import.meta.url), 'utf8');
    await client.query('BEGIN');
    try {
      await client.query(sql);
      await client.query('INSERT INTO schema_migrations(version) VALUES ($1)', [version]);
      await client.query('COMMIT');
      console.log(`Applied migration: ${version}`);
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    }
  }
} catch (error) {
  console.error('Migration failed:', error);
  process.exitCode = 1;
} finally {
  await client.end();
}
