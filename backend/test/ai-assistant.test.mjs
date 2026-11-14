import test from 'node:test';
import assert from 'node:assert/strict';
import bcrypt from 'bcryptjs';
import { buildApp } from '../src/app.mjs';
import { detectDataIntent } from '../src/ai-assistant.mjs';

const USER_ID = '11111111-1111-4111-8111-111111111111';
const PASSWORD = 'ValidPassword!234';

function makeDb({ allowPermission = true } = {}) {
  let sessionId;
  return {
    passwordHash: null,
    async query(sql, params = []) {
      if (sql.includes('SELECT failed_attempts, locked_until')) return { rows: [], rowCount: 0 };
      if (sql.includes('SELECT id, username, password_hash, display_name, is_active FROM users')) {
        return { rows: [{ id: USER_ID, username: 'admin', password_hash: this.passwordHash, display_name: 'مدير النظام', is_active: true }], rowCount: 1 };
      }
      if (sql.includes('DELETE FROM auth_login_attempts')) return { rows: [], rowCount: 1 };
      if (sql.includes('INSERT INTO auth_sessions')) { sessionId = params[0]; return { rows: [], rowCount: 1 }; }
      if (sql.includes('SELECT s.id, u.id AS user_id')) {
        return sessionId === params[0] && params[1] === USER_ID
          ? { rows: [{ id: sessionId, user_id: USER_ID, username: 'admin', display_name: 'مدير النظام' }], rowCount: 1 }
          : { rows: [], rowCount: 0 };
      }
      if (sql.includes('SELECT EXISTS')) return { rows: [{ allowed: allowPermission }], rowCount: 1 };
      if (sql.includes('INSERT INTO auth_login_attempts')) return { rows: [], rowCount: 1 };
      throw new Error('Unexpected SQL in AI assistant test: ' + sql);
    }
  };
}

async function createAuthenticatedApp(options = {}) {
  const db = makeDb(options);
  db.passwordHash = await bcrypt.hash(PASSWORD, 4);
  const app = buildApp({ logger: false, jwtSecret: 'test-secret-with-at-least-32-characters', db });
  const login = await app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { username: 'admin', password: PASSWORD } });
  assert.equal(login.statusCode, 200);
  return { app, token: login.json().accessToken };
}

test('AI status and chat require authentication', async () => {
  const app = buildApp({ logger: false, jwtSecret: 'test-secret-with-at-least-32-characters', db: makeDb() });
  try {
    assert.equal((await app.inject({ method: 'GET', url: '/api/v1/ai/status' })).statusCode, 401);
    assert.equal((await app.inject({ method: 'POST', url: '/api/v1/ai/chat', payload: { message: 'مرحبا' } })).statusCode, 401);
  } finally { await app.close(); }
});

test('AI assistant permission is enforced', async () => {
  const { app, token } = await createAuthenticatedApp({ allowPermission: false });
  try {
    const response = await app.inject({ method: 'GET', url: '/api/v1/ai/status', headers: { authorization: `Bearer ${token}` } });
    assert.equal(response.statusCode, 403);
  } finally { await app.close(); }
});

test('AI chat reports disabled configuration without exposing secrets', async () => {
  const previous = process.env.OPENAI_API_KEY;
  delete process.env.OPENAI_API_KEY;
  const { app, token } = await createAuthenticatedApp();
  try {
    const response = await app.inject({ method: 'POST', url: '/api/v1/ai/chat', headers: { authorization: `Bearer ${token}` }, payload: { message: 'مرحبا' } });
    assert.equal(response.statusCode, 503);
    assert.equal(response.json().error, 'AI_NOT_CONFIGURED');
  } finally {
    await app.close();
    if (previous === undefined) delete process.env.OPENAI_API_KEY; else process.env.OPENAI_API_KEY = previous;
  }
});

test('AI chat calls Responses API server-side and returns extracted text', async () => {
  const previousKey = process.env.OPENAI_API_KEY;
  const previousFetch = globalThis.fetch;
  process.env.OPENAI_API_KEY = 'test-key-never-log';
  let requestBody;
  globalThis.fetch = async (url, options) => {
    assert.equal(url, 'https://api.openai.com/v1/responses');
    assert.equal(options.headers.Authorization, 'Bearer test-key-never-log');
    requestBody = JSON.parse(options.body);
    return new Response(JSON.stringify({ id: 'resp_test', output: [{ type: 'message', content: [{ type: 'output_text', text: 'أهلاً بك في NEW FEED ERP' }] }] }), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  const { app, token } = await createAuthenticatedApp();
  try {
    const response = await app.inject({ method: 'POST', url: '/api/v1/ai/chat', headers: { authorization: `Bearer ${token}` }, payload: { message: 'عرفني بالنظام' } });
    assert.equal(response.statusCode, 200);
    assert.equal(response.json().answer, 'أهلاً بك في NEW FEED ERP');
    assert.equal(requestBody.store, false);
    assert.match(requestBody.instructions, /لا تدّعِ أنك اطلعت على بيانات النظام/);
  } finally {
    await app.close();
    globalThis.fetch = previousFetch;
    if (previousKey === undefined) delete process.env.OPENAI_API_KEY; else process.env.OPENAI_API_KEY = previousKey;
  }
});

test('AI chat validates empty and oversized messages', async () => {
  const { app, token } = await createAuthenticatedApp();
  try {
    const headers = { authorization: `Bearer ${token}` };
    assert.equal((await app.inject({ method: 'POST', url: '/api/v1/ai/chat', headers, payload: { message: '' } })).statusCode, 400);
    assert.equal((await app.inject({ method: 'POST', url: '/api/v1/ai/chat', headers, payload: { message: 'x'.repeat(4001) } })).statusCode, 400);
  } finally { await app.close(); }
});


test('AI assistant maps ERP questions to only supported read-only data sections', () => {
  assert.equal(detectDataIntent('ما هو رصيد المخزون من الخامات؟'), 'inventory');
  assert.equal(detectDataIntent('اعرض أوامر الإنتاج والتشغيلات'), 'production');
  assert.equal(detectDataIntent('ملخص فواتير المبيعات والعملاء'), 'sales');
  assert.equal(detectDataIntent('ما هي أوامر الشراء والموردين؟'), 'purchases');
  assert.equal(detectDataIntent('اعرض ميزان المراجعة والقيود المحاسبية'), 'accounting');
  assert.equal(detectDataIntent('ما هي مستحقات العملاء وأعمار الديون؟'), 'receivables');
  assert.equal(detectDataIntent('ما هي مستحقات الموردين وأعمار الديون؟'), 'payables');
  assert.equal(detectDataIntent('عرفني بالنظام'), null);
});


test('supplier payables aging separates future-due balances from overdue buckets', async () => {
  const source = await (await import('node:fs/promises')).readFile(new URL('../src/ai-assistant.mjs', import.meta.url), 'utf8');
  assert.match(source, /\(CURRENT_DATE-r\.aging_date\)::int age_days/);
  assert.match(source, /CASE WHEN age_days<0 THEN outstanding ELSE 0 END\)::numeric not_due/);
  assert.match(source, /CASE WHEN age_days BETWEEN 0 AND 30 THEN outstanding ELSE 0 END\)::numeric bucket_0_30/);
  assert.doesNotMatch(source, /GREATEST\(0,\(CURRENT_DATE-r\.aging_date\)\)/);
});


test('AI assistant routes expiry questions to inventory and exposes lot expiry status', async () => {
  const source = await (await import('node:fs/promises')).readFile(new URL('../src/ai-assistant.mjs', import.meta.url), 'utf8');
  assert.equal(detectDataIntent('ما هي التشغيلات القريبة من انتهاء الصلاحية؟'), 'inventory');
  assert.equal(detectDataIntent('اعرض الأصناف منتهية الصلاحية'), 'inventory');
  assert.match(source, /b\.expiry_date/);
  assert.match(source, /'EXPIRED'/);
  assert.match(source, /'EXPIRING_SOON'/);
  assert.match(source, /days_to_expiry/);
  assert.match(source, /PENDING_QC أو QUARANTINED/);
});
