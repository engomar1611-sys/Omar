import test from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import ExcelJS from 'exceljs';
import { buildApp } from '../src/app.mjs';
import { buildCsv, toRows } from '../src/finance-extras.mjs';

const enabled = Boolean(process.env.DATABASE_URL && process.env.BOOTSTRAP_ADMIN_USERNAME && process.env.BOOTSTRAP_ADMIN_PASSWORD);

test('CSV export neutralises formulas, keeps numbers and Arabic headers', () => {
  const csv = buildCsv([{ account_code: '0012', name_ar: '=HYPERLINK("x")', balance: '-15.50' }]);
  assert.ok(csv.startsWith('﻿'));
  assert.match(csv, /كود الحساب,الاسم,الرصيد/);
  assert.match(csv, /0012,"'=HYPERLINK\(""x""\)",-15.5/);
  assert.deepEqual(toRows({ lines: [{ a: 1 }] }), [{ a: 1 }]);
});

test('PostgreSQL: cost centers, reversal-correct ledgers, financial statements and Excel export',
  { skip: !enabled }, async () => {
    const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
    const app = buildApp({ logger: false, db: pool, jwtSecret: process.env.AUTH_JWT_SECRET });
    const suffix = Date.now().toString();
    try {
      const login = await app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { username: process.env.BOOTSTRAP_ADMIN_USERNAME, password: process.env.BOOTSTRAP_ADMIN_PASSWORD } });
      assert.equal(login.statusCode, 200, login.body);
      const headers = { authorization: 'Bearer ' + login.json().accessToken, 'content-type': 'application/json' };
      const get = (url) => app.inject({ method: 'GET', url, headers });

      // مراكز التكلفة
      const cc = await app.inject({ method: 'POST', url: '/api/v1/accounting/cost-centers', headers, payload: { code: 'T' + suffix, nameAr: 'مركز اختبار' } });
      assert.equal(cc.statusCode, 201, cc.body);
      const dup = await app.inject({ method: 'POST', url: '/api/v1/accounting/cost-centers', headers, payload: { code: 'T' + suffix, nameAr: 'مكرر' } });
      assert.equal(dup.statusCode, 409);
      const child = await app.inject({ method: 'POST', url: '/api/v1/accounting/cost-centers', headers, payload: { code: 'C' + suffix, nameAr: 'فرعي', parentId: cc.json().id } });
      assert.equal(child.statusCode, 201, child.body);
      const cycle = await app.inject({ method: 'PATCH', url: '/api/v1/accounting/cost-centers/' + cc.json().id, headers, payload: { parentId: child.json().id } });
      assert.equal(cycle.statusCode, 409, 'cycle must be rejected');
      const off = await app.inject({ method: 'PATCH', url: '/api/v1/accounting/cost-centers/' + child.json().id, headers, payload: { isActive: false } });
      assert.equal(off.json().is_active, false);
      const inactive = await app.inject({ method: 'POST', url: '/api/v1/accounting/expenses', headers, payload: { expenseNo: 'XI' + suffix, accountId: (await pool.query("SELECT id FROM gl_accounts WHERE account_type='EXPENSE' ORDER BY code LIMIT 1")).rows[0].id, amount: 1, paymentMethod: 'CASH', description: 'x', costCenterId: child.json().id } });
      assert.equal(inactive.statusCode, 409, 'inactive cost center rejected');

      // مصروف بمركز تكلفة ثم عكسه: الأرصدة يجب أن تعود كما كانت
      const expAcc = (await pool.query("SELECT id,code FROM gl_accounts WHERE account_type='EXPENSE' ORDER BY code LIMIT 1")).rows[0];
      const tbBefore = (await get('/api/v1/reports/trial-balance')).json();
      const find = (rows, code) => Number(rows.find((r) => r.code === code)?.balance ?? 0);
      const e1 = await app.inject({ method: 'POST', url: '/api/v1/accounting/expenses', headers, payload: { expenseNo: 'FX' + suffix, accountId: expAcc.id, amount: 250, paymentMethod: 'CASH', description: 'مصروف اختبار', costCenterId: cc.json().id } });
      assert.equal(e1.statusCode, 201, e1.body);
      const e2 = await app.inject({ method: 'POST', url: '/api/v1/accounting/expenses', headers, payload: { expenseNo: 'FY' + suffix, accountId: expAcc.id, amount: 100, paymentMethod: 'CASH', description: 'مصروف سيُعكس', costCenterId: cc.json().id } });
      assert.equal(e2.statusCode, 201, e2.body);
      const rev = await app.inject({ method: 'POST', url: `/api/v1/accounting/expenses/${e2.json().id}/reverse`, headers, payload: { reason: 'اختبار' } });
      assert.equal(rev.statusCode, 200, rev.body);
      const tbAfter = (await get('/api/v1/reports/trial-balance')).json();
      assert.equal(find(tbAfter, expAcc.code) - find(tbBefore, expAcc.code), 250, 'reversed expense must net to zero in trial balance');
      assert.equal(find(tbAfter, '1000') - find(tbBefore, '1000'), -250, 'cash must net -250 only');
      const lines = (await pool.query('SELECT cost_center_id FROM journal_lines l JOIN journal_entries j ON j.id=l.journal_entry_id WHERE j.source_id=$1', [e2.json().id])).rows;
      assert.ok(lines.length >= 2 && lines.every((l) => l.cost_center_id === null || l.cost_center_id === cc.json().id));

      // قائمة الدخل لمركز التكلفة
      const is = await get('/api/v1/reports/income-statement?costCenterId=' + cc.json().id);
      assert.equal(is.statusCode, 200, is.body);
      assert.equal(is.json().totalExpenses, 250);
      assert.equal(is.json().netIncome, -250);
      assert.equal(is.json().rows.at(-1).label, 'صافي الخسارة');
      const ccs = (await get('/api/v1/reports/cost-center-summary')).json().find((r) => r.cost_center_code === 'T' + suffix);
      assert.equal(Number(ccs.expense_total), 250);

      // المركز المالي متوازن
      const bs = await get('/api/v1/reports/balance-sheet');
      assert.equal(bs.statusCode, 200, bs.body);
      assert.equal(bs.json().balanced, true, JSON.stringify([bs.json().totalAssets, bs.json().totalLiabilities, bs.json().totalEquity]));
      assert.equal((await get('/api/v1/reports/balance-sheet?asOf=bad')).statusCode, 400);
      assert.equal((await get('/api/v1/reports/income-statement?from=2030-02-01&to=2030-01-01')).statusCode, 400);

      // التصدير
      const xl = await get('/api/v1/export/income-statement?format=xlsx');
      assert.equal(xl.statusCode, 200);
      assert.match(xl.headers['content-type'], /spreadsheetml/);
      const wb = new ExcelJS.Workbook();
      await wb.xlsx.load(xl.rawPayload);
      const ws = wb.worksheets[0];
      assert.equal(ws.views[0].rightToLeft, true);
      assert.equal(ws.getRow(1).getCell(1).value, 'القسم');
      assert.ok(ws.rowCount >= 4);
      const csv = await get('/api/v1/export/trial-balance?format=csv');
      assert.equal(csv.statusCode, 200);
      assert.match(csv.headers['content-type'], /text\/csv/);
      assert.match(csv.body, /كود/);
      assert.equal((await get('/api/v1/export/not-a-report')).statusCode, 404);
      assert.equal((await get('/api/v1/export/trial-balance?format=pdf')).statusCode, 400);
      assert.equal((await app.inject({ method: 'GET', url: '/api/v1/export/trial-balance' })).statusCode, 401);
    } finally { await app.close(); await pool.end(); }
  });
