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
      if (sql.includes('FROM item_barcodes b JOIN items i')) return {
        rows: [{ barcode: '6221234567890', item_id: '33333333-3333-4333-8333-333333333333', item_code: 'CORN-01', item_name: 'ذرة صفراء', is_primary: true }],
        rowCount: 1
      };
      if (sql.includes('FROM unit_conversions c')) return {
        rows: [{
          id: '44444444-4444-4444-8444-444444444444',
          from_unit_id: '22222222-2222-4222-8222-222222222222',
          to_unit_id: '55555555-5555-4555-8555-555555555555',
          factor: '1000.00000000',
          from_unit_code: 'KG',
          from_unit_name: 'كيلوجرام',
          to_unit_code: 'G',
          to_unit_name: 'جرام'
        }],
        rowCount: 1
      };
      if (sql.includes('FROM units_of_measure ORDER BY code')) return {
        rows: [{ id: '22222222-2222-4222-8222-222222222222', code: 'KG', name_ar: 'كيلوجرام', decimal_places: 3 }],
        rowCount: 1
      };
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

test('master data units endpoint requires authentication and returns unit records', async () => {
  const db = makeDb();
  db.passwordHash = await bcrypt.hash(PASSWORD, 4);
  const app = buildApp({ logger: false, jwtSecret: 'test-secret-with-at-least-32-characters', db });
  try {
    const denied = await app.inject({ method: 'GET', url: '/api/v1/master/units' });
    assert.equal(denied.statusCode, 401);
    const login = await app.inject({
      method: 'POST', url: '/api/v1/auth/login',
      payload: { username: 'admin', password: PASSWORD }
    });
    const response = await app.inject({
      method: 'GET', url: '/api/v1/master/units',
      headers: { authorization: `Bearer ${login.json().accessToken}` }
    });
    assert.equal(response.statusCode, 200);
    assert.equal(response.json()[0].code, 'KG');
  } finally {
    await app.close();
  }
});

test('master data endpoints reject invalid unit definitions', async () => {
  const db = makeDb();
  db.passwordHash = await bcrypt.hash(PASSWORD, 4);
  const app = buildApp({ logger: false, jwtSecret: 'test-secret-with-at-least-32-characters', db });
  try {
    const login = await app.inject({
      method: 'POST', url: '/api/v1/auth/login',
      payload: { username: 'admin', password: PASSWORD }
    });
    const response = await app.inject({
      method: 'POST', url: '/api/v1/master/units',
      headers: { authorization: `Bearer ${login.json().accessToken}` },
      payload: { code: '', nameAr: 'كيلوجرام', decimalPlaces: 9 }
    });
    assert.equal(response.statusCode, 400);
    assert.equal(response.json().error, 'VALIDATION_ERROR');
  } finally {
    await app.close();
  }
});

test('barcode lookup resolves a scanned barcode to its active item', async () => {
  const db = makeDb();
  db.passwordHash = await bcrypt.hash(PASSWORD, 4);
  const app = buildApp({ logger: false, jwtSecret: 'test-secret-with-at-least-32-characters', db });
  try {
    const login = await app.inject({
      method: 'POST', url: '/api/v1/auth/login',
      payload: { username: 'admin', password: PASSWORD }
    });
    const response = await app.inject({
      method: 'GET', url: '/api/v1/master/barcodes/6221234567890',
      headers: { authorization: `Bearer ${login.json().accessToken}` }
    });
    assert.equal(response.statusCode, 200);
    assert.equal(response.json().item_code, 'CORN-01');
  } finally {
    await app.close();
  }
});


test('unit conversions listing is protected and returns readable conversion details', async () => {
  const db = makeDb();
  db.passwordHash = await bcrypt.hash(PASSWORD, 4);
  const app = buildApp({ logger: false, jwtSecret: 'test-secret-with-at-least-32-characters', db });
  try {
    const denied = await app.inject({ method: 'GET', url: '/api/v1/master/unit-conversions' });
    assert.equal(denied.statusCode, 401);
    const login = await app.inject({
      method: 'POST', url: '/api/v1/auth/login',
      payload: { username: 'admin', password: PASSWORD }
    });
    const response = await app.inject({
      method: 'GET', url: '/api/v1/master/unit-conversions',
      headers: { authorization: `Bearer ${login.json().accessToken}` }
    });
    assert.equal(response.statusCode, 200);
    assert.equal(response.json()[0].from_unit_code, 'KG');
    assert.equal(response.json()[0].to_unit_code, 'G');
    assert.equal(Number(response.json()[0].factor), 1000);
  } finally {
    await app.close();
  }
});


test('purchasing, quality, inventory and production endpoints require authentication', async () => {
  const app = buildApp({ logger: false, jwtSecret: 'test-secret-with-at-least-32-characters', db: makeDb() });
  try {
    const paths = [
      '/api/v1/suppliers',
      '/api/v1/purchases',
      '/api/v1/goods-receipts',
      '/api/v1/inventory/balances',
      '/api/v1/production/orders'
    ];
    for (const url of paths) {
      const response = await app.inject({ method: 'GET', url });
      assert.equal(response.statusCode, 401, url);
    }
    const response = await app.inject({ method: 'POST', url: '/api/v1/goods-receipts/11111111-1111-4111-8111-111111111111/quality', payload: { inspections: [] } });
    assert.equal(response.statusCode, 401);
  } finally {
    await app.close();
  }
});


test('commercial and accounting endpoints require authentication', async () => {
  const app = buildApp({ logger: false, jwtSecret: 'test-secret-with-at-least-32-characters', db: makeDb() });
  try {
    const paths = [
      '/api/v1/customers',
      '/api/v1/sales/invoices',
      '/api/v1/accounting/journals'
    ];
    for (const url of paths) {
      const response = await app.inject({ method: 'GET', url });
      assert.equal(response.statusCode, 401, url);
    }
    for (const [url, payload] of [
      ['/api/v1/accounting/receipts', {}],
      ['/api/v1/sales/returns', {}],
      ['/api/v1/accounting/expenses', {}],
      ['/api/v1/quality/finished-goods/11111111-1111-4111-8111-111111111111/inspect', { result: 'PASS' }]
    ]) {
      const response = await app.inject({ method: 'POST', url, payload });
      assert.equal(response.statusCode, 401, url);
    }
  } finally {
    await app.close();
  }
});

test('payables, supplier returns, period close and returned-goods quality endpoints require authentication', async () => {
  const app = buildApp({ logger: false, jwtSecret: 'test-secret-with-at-least-32-characters', db: makeDb() });
  try {
    const cases = [
      ['/api/v1/accounting/supplier-payments', {}],
      ['/api/v1/purchases/returns', {}],
      ['/api/v1/accounting/periods/close', {}],
      ['/api/v1/quality/sales-returns/11111111-1111-4111-8111-111111111111/inspect', { result: 'PASS' }]
    ];
    for (const [url, payload] of cases) {
      const response = await app.inject({ method: 'POST', url, payload });
      assert.equal(response.statusCode, 401, url);
    }
  } finally {
    await app.close();
  }
});


test('formulation lifecycle and inventory adjustment endpoints require authentication', async () => {
  const app = buildApp({ logger: false, jwtSecret: 'test-secret-with-at-least-32-characters', db: makeDb() });
  try {
    for (const url of ['/api/v1/formulations', '/api/v1/inventory/movements', '/api/v1/reports/trial-balance', '/api/v1/reports/inventory-valuation', '/api/v1/reports/production-costs', '/api/v1/reports/sales-summary']) {
      const response = await app.inject({ method: 'GET', url });
      assert.equal(response.statusCode, 401, url);
    }
    for (const [url, payload] of [
      ['/api/v1/formulations', {}],
      ['/api/v1/inventory/adjustments', {}],
      ['/api/v1/formulations/11111111-1111-4111-8111-111111111111/approve', {}],
      ['/api/v1/inventory/adjustments/11111111-1111-4111-8111-111111111111/approve', {}],
      ['/api/v1/production/orders/11111111-1111-4111-8111-111111111111/losses', {}]
    ]) {
      const response = await app.inject({ method: 'POST', url, payload });
      assert.equal(response.statusCode, 401, url);
    }
  } finally {
    await app.close();
  }
});
