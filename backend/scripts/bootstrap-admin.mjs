import 'dotenv/config';
import bcrypt from 'bcryptjs';
import pg from 'pg';
import { validateConfig, config } from '../src/config/env.mjs';

validateConfig();

const username = process.env.BOOTSTRAP_ADMIN_USERNAME?.trim().toLowerCase();
const displayName = process.env.BOOTSTRAP_ADMIN_NAME?.trim();
const password = process.env.BOOTSTRAP_ADMIN_PASSWORD;

if (!username || !/^[a-z0-9._-]{3,80}$/.test(username)) {
  throw new Error('BOOTSTRAP_ADMIN_USERNAME must be 3-80 characters: a-z, 0-9, dot, underscore, or hyphen');
}
if (!displayName || displayName.length > 160) {
  throw new Error('BOOTSTRAP_ADMIN_NAME is required and must not exceed 160 characters');
}
if (!password || password.length < 14 || password.length > 200) {
  throw new Error('BOOTSTRAP_ADMIN_PASSWORD must contain 14-200 characters');
}

const { Client } = pg;
const client = new Client({ connectionString: config.databaseUrl });
const passwordHash = await bcrypt.hash(password, 12);

try {
  await client.connect();
  await client.query('BEGIN');
  await client.query("SELECT pg_advisory_xact_lock(hashtext('new-feed-bootstrap-admin'))");

  const existingUsers = await client.query('SELECT COUNT(*)::int AS count FROM users');
  if (existingUsers.rows[0].count !== 0) {
    throw new Error('Bootstrap stopped: users already exist. Use the user administration workflow instead.');
  }

  const role = await client.query(
    `INSERT INTO roles(code, name_ar, is_active)
     VALUES ('SYSTEM_ADMIN', 'مدير النظام', TRUE)
     ON CONFLICT (code) DO UPDATE SET is_active = TRUE
     RETURNING id`
  );
  const user = await client.query(
    `INSERT INTO users(username, password_hash, display_name, is_active)
     VALUES ($1, $2, $3, TRUE)
     RETURNING id`,
    [username, passwordHash, displayName]
  );

  await client.query(
    'INSERT INTO user_roles(user_id, role_id) VALUES ($1, $2)',
    [user.rows[0].id, role.rows[0].id]
  );
  await client.query(
    `INSERT INTO role_permissions(role_id, permission_id)
     SELECT $1, id FROM permissions
     ON CONFLICT DO NOTHING`,
    [role.rows[0].id]
  );
  await client.query(
    `INSERT INTO audit_logs(actor_user_id, action, entity_type, entity_id, details)
     VALUES ($1, 'BOOTSTRAP_ADMIN_CREATED', 'USER', $1, $2::jsonb)`,
    [user.rows[0].id, JSON.stringify({ username })]
  );

  await client.query('COMMIT');
  console.log('Initial system administrator created successfully.');
  console.log('Remove BOOTSTRAP_ADMIN_PASSWORD from the environment after this one-time operation.');
} catch (error) {
  await client.query('ROLLBACK').catch(() => {});
  console.error('Bootstrap failed:', error.message);
  process.exitCode = 1;
} finally {
  await client.end();
}
