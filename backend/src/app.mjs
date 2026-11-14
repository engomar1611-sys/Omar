import Fastify from 'fastify';
import jwt from '@fastify/jwt';
import bcrypt from 'bcryptjs';
import { randomUUID, randomBytes } from 'node:crypto';
import { pool } from './db/pool.mjs';
import { masterDataRoutes } from './master-data.mjs';
import { operationsRoutes } from './operations.mjs';
import { commercialRoutes } from './commercial.mjs';
import { formulationRoutes } from './formulations.mjs';
import { inventoryRoutes } from './inventory.mjs';
import { procurementRoutes } from './procurement.mjs';
import { salesDeliveryRoutes } from './sales-deliveries.mjs';
import { adminRoutes } from './admin.mjs';
import { hrRoutes, maintenanceRoutes, settingsRoutes } from './hr-maintenance-settings.mjs';
import { webUiRoutes } from './web-ui.mjs';
import { aiAssistantRoutes } from './ai-assistant.mjs';

const SESSION_HOURS = 8;
const MAX_FAILED_LOGINS = 5;
const LOCK_MINUTES = 15;

export function requirePermission(db, permissionCode) {
  if (!/^[A-Z][A-Z0-9_.:-]{1,79}$/.test(permissionCode)) {
    throw new Error('Invalid permission code');
  }
  return async (request, reply) => {
    const result = await db.query(
      `SELECT EXISTS (
         SELECT 1
           FROM user_roles ur
           JOIN role_permissions rp ON rp.role_id = ur.role_id
           JOIN permissions p ON p.id = rp.permission_id
           JOIN roles r ON r.id = ur.role_id
          WHERE ur.user_id = $1 AND p.code = $2
            AND p.is_active = TRUE AND r.is_active = TRUE
       ) AS allowed`,
      [request.authUser.user_id, permissionCode]
    );
    if (!result.rows[0]?.allowed) {
      return reply.code(403).send({ error: 'FORBIDDEN', message: 'ليست لديك صلاحية لتنفيذ هذا الإجراء' });
    }
  };
}

export function buildApp({ logger = true, db = pool, jwtSecret = process.env.AUTH_JWT_SECRET } = {}) {
  if (!jwtSecret && process.env.NODE_ENV === 'production') {
    throw new Error('AUTH_JWT_SECRET is required in production');
  }

  const app = Fastify({ logger });
  const signingSecret = jwtSecret || randomBytes(48).toString('hex');

  app.register(jwt, { secret: signingSecret, sign: { expiresIn: `${SESSION_HOURS}h` } });
  app.decorateRequest('authUser', null);

  app.decorate('authenticate', async (request, reply) => {
    try {
      await request.jwtVerify();
    } catch {
      return reply.code(401).send({ error: 'UNAUTHORIZED', message: 'يرجى تسجيل الدخول' });
    }

    const session = await db.query(
      `SELECT s.id, u.id AS user_id, u.username, u.display_name
         FROM auth_sessions s
         JOIN users u ON u.id = s.user_id
        WHERE s.id = $1 AND s.user_id = $2
          AND s.revoked_at IS NULL AND s.expires_at > NOW()
          AND u.is_active = TRUE`,
      [request.user.jti, request.user.sub]
    );
    if (session.rowCount !== 1) {
      return reply.code(401).send({ error: 'UNAUTHORIZED', message: 'جلسة الدخول غير صالحة أو انتهت' });
    }
    request.authUser = session.rows[0];
  });

  app.decorate('requirePermission', (permissionCode) => requirePermission(db, permissionCode));

  app.get('/health', async () => ({
    status: 'ok',
    service: 'new-feed-erp-api',
    timestamp: new Date().toISOString()
  }));

  app.get('/ready', async (_request, reply) => {
    try {
      await db.query('SELECT 1 AS connected');
      return { status: 'ready', database: 'connected' };
    } catch {
      return reply.code(503).send({ status: 'not_ready', database: 'unavailable' });
    }
  });

  app.get('/api/v1', async () => ({
    name: 'NEW FEED ERP API',
    version: '0.2.0',
    status: 'foundation'
  }));

  app.post('/api/v1/auth/login', {
    schema: {
      body: {
        type: 'object',
        additionalProperties: false,
        required: ['username', 'password'],
        properties: {
          username: { type: 'string', minLength: 1, maxLength: 80 },
          password: { type: 'string', minLength: 1, maxLength: 200 }
        }
      }
    }
  }, async (request, reply) => {
    const username = request.body.username.trim().toLowerCase();
    const password = request.body.password;
    const ipAddress = request.ip;

    const attemptResult = await db.query(
      'SELECT failed_attempts, locked_until FROM auth_login_attempts WHERE username = $1 AND ip_address = $2',
      [username, ipAddress]
    );
    const attempt = attemptResult.rows[0];
    if (attempt?.locked_until && new Date(attempt.locked_until).getTime() > Date.now()) {
      return reply.code(429).send({ error: 'LOGIN_LOCKED', message: 'تم إيقاف محاولات الدخول مؤقتاً. حاول لاحقاً.' });
    }

    const userResult = await db.query(
      'SELECT id, username, password_hash, display_name, is_active FROM users WHERE lower(username) = $1',
      [username]
    );
    const user = userResult.rows[0];
    const passwordMatches = user
      ? await bcrypt.compare(password, user.password_hash)
      : await bcrypt.compare(password, await bcrypt.hash(randomBytes(24).toString('hex'), 4));

    if (!user || !user.is_active || !passwordMatches) {
      await db.query(
        `INSERT INTO auth_login_attempts(username, ip_address, failed_attempts, locked_until, updated_at)
         VALUES ($1, $2, 1, NULL, NOW())
         ON CONFLICT (username, ip_address) DO UPDATE
           SET failed_attempts = auth_login_attempts.failed_attempts + 1,
               locked_until = CASE
                 WHEN auth_login_attempts.failed_attempts + 1 >= $3
                 THEN NOW() + ($4 * INTERVAL '1 minute')
                 ELSE NULL
               END,
               updated_at = NOW()`,
        [username, ipAddress, MAX_FAILED_LOGINS, LOCK_MINUTES]
      );
      return reply.code(401).send({ error: 'INVALID_CREDENTIALS', message: 'اسم المستخدم أو كلمة المرور غير صحيحة' });
    }

    await db.query(
      'DELETE FROM auth_login_attempts WHERE username = $1 AND ip_address = $2',
      [username, ipAddress]
    );

    const sessionId = randomUUID();
    const expiresAt = new Date(Date.now() + SESSION_HOURS * 60 * 60 * 1000);
    await db.query(
      'INSERT INTO auth_sessions(id, user_id, expires_at) VALUES ($1, $2, $3)',
      [sessionId, user.id, expiresAt]
    );

    const accessToken = app.jwt.sign({ sub: user.id, jti: sessionId });
    return {
      accessToken,
      tokenType: 'Bearer',
      expiresAt: expiresAt.toISOString(),
      user: { id: user.id, username: user.username, displayName: user.display_name }
    };
  });

  app.get('/api/v1/auth/me', { preHandler: app.authenticate }, async (request) => {
    const result = await db.query(
      `SELECT u.id, u.username, u.display_name,
              COALESCE(array_agg(DISTINCT r.code) FILTER (WHERE r.code IS NOT NULL), ARRAY[]::text[]) AS roles,
              COALESCE(array_agg(DISTINCT p.code) FILTER (WHERE p.code IS NOT NULL), ARRAY[]::text[]) AS permissions
         FROM users u
         LEFT JOIN user_roles ur ON ur.user_id = u.id
         LEFT JOIN roles r ON r.id = ur.role_id AND r.is_active = TRUE
         LEFT JOIN role_permissions rp ON rp.role_id = r.id
         LEFT JOIN permissions p ON p.id = rp.permission_id AND p.is_active = TRUE
        WHERE u.id = $1
        GROUP BY u.id, u.username, u.display_name`,
      [request.authUser.user_id]
    );
    if (result.rowCount !== 1) return { error: 'USER_NOT_FOUND' };
    const user = result.rows[0];
    return {
      id: user.id,
      username: user.username,
      displayName: user.display_name,
      roles: user.roles,
      permissions: user.permissions
    };
  });

  app.post('/api/v1/auth/logout', { preHandler: app.authenticate }, async (request, reply) => {
    await db.query(
      'UPDATE auth_sessions SET revoked_at = NOW() WHERE id = $1 AND revoked_at IS NULL',
      [request.user.jti]
    );
    return reply.code(204).send();
  });

  app.register(masterDataRoutes, { db });
  app.register(operationsRoutes, { db });
  app.register(commercialRoutes, { db });
  app.register(formulationRoutes, { db });
  app.register(inventoryRoutes, { db });
  app.register(procurementRoutes, { db });
  app.register(salesDeliveryRoutes, { db });
  app.register(adminRoutes, { db });
  app.register(hrRoutes, { db });
  app.register(maintenanceRoutes, { db });
  app.register(settingsRoutes, { db });
  app.register(aiAssistantRoutes, { db });
  app.register(webUiRoutes);

  return app;
}
