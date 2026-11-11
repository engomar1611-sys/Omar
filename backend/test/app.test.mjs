import test from 'node:test';
import assert from 'node:assert/strict';
import bcrypt from 'bcryptjs';
import { buildApp } from '../src/app.mjs';

const USER_ID = '11111111-1111-4111-8111-111111111111';
const PASSWORD = 'ValidPassword!234';

function makeDb({ allowPermission = true } = {}) {
  let sessionId = null;
  let revoked = false;
  return {
    async query(sql, params = []) {
      if (sql.includes('SELECT failed_attempts, locked_until')) return { rows: [], rowCount: 0 };
      if (sql.includes('SELECT id, username, password_hash, display_name, is_active FROM users')) {
        return {
          rows: [{
            id: USER_ID,
            username: 'admin',
            password_hash: this.passwordHash,
            display_name: 'مدير النظام',
            is_active: true
          }],
          rowCount: 1
        };
      }
      if (sql.includes('DELETE FROM auth_login_attempts')) return { rows: [], rowCount: 1 };
      if (sql.includes('INSERT INTO auth_sessions')) {
        sessionId = params[0];
        return { rows: [], rowCount: 1 };
      }
      if (sql.includes('SELECT s.id, u.id AS user_id')) {
        if (!revoked && params[0] === sessionId && params[1] === USER_ID) {
          return {
            rows: [{ id: sessionId, user_id: USER_ID, username: 'admin', display_name: 'مدير النظام' }],
            rowCount: 1
          };
        }
        return { rows: [], rowCount: 0 };
      }
      if (sql.includes('SELECT u.id, u.username, u.display_name')) {
        return {
          rows: [{
            id: USER_ID,
            username: 'admin',
            display_name: 'مدير النظام',
            roles: ['SYSTEM_ADMIN'],
            permissions: ['ITEMS.READ']
          }],
          rowCount: 1
        };
      }
      if (sql.includes('SELECT EXISTS')) return { rows: [{ allowed: allowPermission }], rowCount: 1 };
      if (sql.includes('UPDATE auth_sessions')) {
        revoked = true;
        return { rows: [], rowCount: 1 };
      }
      if (sql.includes('INSERT INTO auth_login_attempts')) return { rows: [], rowCount: 1 };
      throw new Error(`Unexpected SQL in test: ${sql}`);
    },
    passwordHash: null
  };
}

test('health endpoint returns service status', async () => {
  const app = buildApp({ logger: false, jwtSecret: 'test-secret-with-at-least-32-characters', db: makeDb() });
  try {
    const response = await app.inject({ method: 'GET', url: '/health' });
    assert.equal(response.statusCode, 200);
    const body = response.json();
    assert.equal(body.status, 'ok');
    assert.equal(body.service, 'new-feed-erp-api');
    assert.ok(body.timestamp);
  } finally {
    await app.close();
  }
});

test('API root identifies NEW FEED ERP', async () => {
  const app = buildApp({ logger: false, jwtSecret: 'test-secret-with-at-least-32-characters', db: makeDb() });
  try {
    const response = await app.inject({ method: 'GET', url: '/api/v1' });
    assert.equal(response.statusCode, 200);
    assert.equal(response.json().name, 'NEW FEED ERP API');
  } finally {
    await app.close();
  }
});

test('login issues a token, me returns assigned roles and permissions, logout revokes the session', async () => {
  const db = makeDb();
  db.passwordHash = await bcrypt.hash(PASSWORD, 4);
  const app = buildApp({ logger: false, jwtSecret: 'test-secret-with-at-least-32-characters', db });
  try {
    const login = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { username: ' Admin ', password: PASSWORD }
    });
    assert.equal(login.statusCode, 200);
    const token = login.json().accessToken;
    assert.ok(token);

    const me = await app.inject({
      method: 'GET',
      url: '/api/v1/auth/me',
      headers: { authorization: `Bearer ${token}` }
    });
    assert.equal(me.statusCode, 200);
    assert.deepEqual(me.json().roles, ['SYSTEM_ADMIN']);
    assert.deepEqual(me.json().permissions, ['ITEMS.READ']);

    const logout = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/logout',
      headers: { authorization: `Bearer ${token}` }
    });
    assert.equal(logout.statusCode, 204);

    const afterLogout = await app.inject({
      method: 'GET',
      url: '/api/v1/auth/me',
      headers: { authorization: `Bearer ${token}` }
    });
    assert.equal(afterLogout.statusCode, 401);
  } finally {
    await app.close();
  }
});

test('protected endpoints reject requests without a bearer token', async () => {
  const app = buildApp({ logger: false, jwtSecret: 'test-secret-with-at-least-32-characters', db: makeDb() });
  try {
    const response = await app.inject({ method: 'GET', url: '/api/v1/auth/me' });
    assert.equal(response.statusCode, 401);
  } finally {
    await app.close();
  }
});

test('permission guard rejects a user without the required permission', async () => {
  const db = makeDb({ allowPermission: false });
  db.passwordHash = await bcrypt.hash(PASSWORD, 4);
  const app = buildApp({ logger: false, jwtSecret: 'test-secret-with-at-least-32-characters', db });
  app.get('/api/v1/test/permission', {
    preHandler: [app.authenticate, app.requirePermission('ITEMS.READ')]
  }, async () => ({ ok: true }));
  try {
    const login = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { username: 'admin', password: PASSWORD }
    });
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/test/permission',
      headers: { authorization: `Bearer ${login.json().accessToken}` }
    });
    assert.equal(response.statusCode, 403);
  } finally {
    await app.close();
  }
});
