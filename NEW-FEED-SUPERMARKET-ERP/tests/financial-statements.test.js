import test from "node:test";
import assert from "node:assert/strict";
import {buildTrialBalance,buildIncomeStatement,buildBalanceSheet} from "../apps/api/src/domain/financial-statements.js";

const row=(code,type,debit,credit)=>({account_id:code,code,name_ar:code,account_type:type,total_debit:String(debit),total_credit:String(credit)});

test("trial balance nets each account and verifies equal debit and credit balances",()=>{
 const result=buildTrialBalance([
  row("1000","asset",150,20),
  row("2000","liability",0,50),
  row("4000","revenue",0,80),
  row("5000","expense",0,0)
 ]);
 assert.deepEqual(result.items.map(x=>[x.code,x.debit_balance,x.credit_balance]),[
  ["1000",130,0],["2000",0,50],["4000",0,80]
 ]);
 assert.equal(result.totals.debit_balance,130);
 assert.equal(result.totals.credit_balance,130);
 assert.equal(result.balanced,true);
});

test("trial balance exposes an imbalance instead of hiding it",()=>{
 const result=buildTrialBalance([row("1000","asset",100,0),row("2000","liability",0,90)]);
 assert.equal(result.difference,10);
 assert.equal(result.balanced,false);
});

test("income statement calculates net revenue less expenses and handles contra revenue",()=>{
 const result=buildIncomeStatement([
  row("4000","revenue",0,1000),
  row("4010","revenue",100,0),
  row("5000","expense",400,0),
  row("5010","expense",0,25)
 ]);
 assert.deepEqual(result.totals,{revenue:900,expenses:375,net_profit:525});
 assert.equal(result.revenue.length,2);
 assert.equal(result.expenses.length,2);
});

test("balance sheet includes accumulated earnings in equity and checks the accounting equation",()=>{
 const result=buildBalanceSheet([
  row("1000","asset",1000,0),
  row("2000","liability",0,300),
  row("3000","equity",0,500),
  row("4000","revenue",0,400),
  row("5000","expense",200,0)
 ]);
 assert.deepEqual(result.totals,{
  assets:1000,liabilities:300,equity:500,accumulated_earnings:200,
  equity_including_earnings:700,liabilities_and_equity:1000
 });
 assert.equal(result.difference,0);
 assert.equal(result.balanced,true);
});

test("balance sheet detects a ledger imbalance",()=>{
 const result=buildBalanceSheet([row("1000","asset",100,0),row("2000","liability",0,70)]);
 assert.equal(result.difference,30);
 assert.equal(result.balanced,false);
});

test("zero balances are omitted and invalid numeric values do not become NaN",()=>{
 const result=buildTrialBalance([row("1000","asset","bad",0),row("2000","liability",0,0)]);
 assert.equal(result.items.length,0);
 assert.equal(result.totals.debit_balance,0);
});
