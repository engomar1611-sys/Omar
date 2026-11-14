import test from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import { randomUUID } from 'node:crypto';
import { buildApp } from '../src/app.mjs';

const enabled=Boolean(process.env.DATABASE_URL&&process.env.BOOTSTRAP_ADMIN_USERNAME&&process.env.BOOTSTRAP_ADMIN_PASSWORD);
test('PostgreSQL accounting periods: close only reconciled ledger, reject overlaps, and lock closed periods',{skip:!enabled},async()=>{
 const pool=new pg.Pool({connectionString:process.env.DATABASE_URL});
 const app=buildApp({logger:false,db:pool,jwtSecret:process.env.AUTH_JWT_SECRET});
 const suffix=Date.now().toString();
 try{
  const login=await app.inject({method:'POST',url:'/api/v1/auth/login',payload:{username:process.env.BOOTSTRAP_ADMIN_USERNAME,password:process.env.BOOTSTRAP_ADMIN_PASSWORD}});
  assert.equal(login.statusCode,200,login.body);
  const headers={authorization:'Bearer '+login.json().accessToken,'content-type':'application/json'};
  const userId=login.json().user.id;
  const accounts=(await pool.query("SELECT code,id FROM gl_accounts WHERE code IN ('1000','3000')")).rows;
  const debit=accounts.find(x=>x.code==='1000').id,credit=accounts.find(x=>x.code==='3000').id;
  const source=randomUUID();
  const entry=(await pool.query("INSERT INTO journal_entries(entry_no,entry_date,source_type,source_id,description,total_debit,total_credit,created_by) VALUES($1,'2030-01-10','PERIOD_ACCEPTANCE',$2,'قيد اختبار الفترة',10,10,$3) RETURNING id",['PA-'+suffix,source,userId])).rows[0];
  await pool.query('INSERT INTO journal_lines(journal_entry_id,account_id,debit,credit) VALUES($1,$2,10,0),($1,$3,0,10)',[entry.id,debit,credit]);
  const close=await app.inject({method:'POST',url:'/api/v1/accounting/periods/close',headers,payload:{periodCode:'FY26-'+suffix,startDate:'2030-01-01',endDate:'2030-01-31'}});
  assert.equal(close.statusCode,201,close.body);
  assert.equal(close.json().status,'CLOSED');
  const overlap=await app.inject({method:'POST',url:'/api/v1/accounting/periods/close',headers,payload:{periodCode:'OVER-'+suffix,startDate:'2030-01-15',endDate:'2030-02-15'}});
  assert.equal(overlap.statusCode,409,overlap.body);
  const lock=await app.inject({method:'POST',url:'/api/v1/accounting/periods/'+close.json().id+'/lock',headers,payload:{}});
  assert.equal(lock.statusCode,200,lock.body);
  assert.equal(lock.json().status,'LOCKED');
  const badSource=randomUUID();
  const badEntry=(await pool.query("INSERT INTO journal_entries(entry_no,entry_date,source_type,source_id,description,total_debit,total_credit,created_by) VALUES($1,'2030-03-10','PERIOD_ACCEPTANCE',$2,'قيد غير مطابق',5,5,$3) RETURNING id",['PB-'+suffix,badSource,userId])).rows[0];
  await pool.query('INSERT INTO journal_lines(journal_entry_id,account_id,debit,credit) VALUES($1,$2,4,0),($1,$3,0,5)',[badEntry.id,debit,credit]);
  const invalid=await app.inject({method:'POST',url:'/api/v1/accounting/periods/close',headers,payload:{periodCode:'BAD-'+suffix,startDate:'2030-03-01',endDate:'2030-03-31'}});
  assert.equal(invalid.statusCode,409,invalid.body);
  assert.match(invalid.json().message,/غير مكتملة أو غير متطابقة/);
 }finally{await app.close();await pool.end();}
});
