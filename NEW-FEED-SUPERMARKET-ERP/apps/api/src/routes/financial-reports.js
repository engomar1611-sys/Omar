import {Router} from "express";
import {pool} from "../db.js";
import {buildTrialBalance,buildIncomeStatement,buildBalanceSheet} from "../domain/financial-statements.js";

const router=Router();
const dateRe=/^\d{4}-\d{2}-\d{2}$/;
function validDate(value){
 if(!dateRe.test(value||""))return false;
 const parsed=new Date(value+"T00:00:00.000Z");
 return Number.isFinite(parsed.getTime())&&parsed.toISOString().slice(0,10)===value;
}
function dateRange(req,res){
 const from=req.query.from,to=req.query.to;
 if(!validDate(from)||!validDate(to)||to<from){
  res.status(400).json({error:"A valid from/to date range is required"});
  return null;
 }
 return {from,to};
}
async function accountBalancesThrough(asOf){
 const result=await pool.query(
  `SELECT a.id account_id,a.code,a.name_ar,a.account_type,
    COALESCE(SUM(posted.debit),0)::numeric total_debit,
    COALESCE(SUM(posted.credit),0)::numeric total_credit
   FROM accounts a
   LEFT JOIN (
    SELECT jl.account_id,jl.debit,jl.credit
    FROM journal_lines jl
    JOIN journal_entries je ON je.id=jl.journal_entry_id
    WHERE je.status='posted' AND je.entry_date <= $1::date
   ) posted ON posted.account_id=a.id
   WHERE a.is_active=true OR posted.account_id IS NOT NULL
   GROUP BY a.id,a.code,a.name_ar,a.account_type
   ORDER BY a.code`,
  [asOf]
 );
 return result.rows;
}
async function accountBalancesForPeriod(from,to){
 const result=await pool.query(
  `SELECT a.id account_id,a.code,a.name_ar,a.account_type,
    COALESCE(SUM(posted.debit),0)::numeric total_debit,
    COALESCE(SUM(posted.credit),0)::numeric total_credit
   FROM accounts a
   LEFT JOIN (
    SELECT jl.account_id,jl.debit,jl.credit
    FROM journal_lines jl
    JOIN journal_entries je ON je.id=jl.journal_entry_id
    WHERE je.status='posted' AND je.entry_date BETWEEN $1::date AND $2::date
   ) posted ON posted.account_id=a.id
   WHERE a.is_active=true OR posted.account_id IS NOT NULL
   GROUP BY a.id,a.code,a.name_ar,a.account_type
   ORDER BY a.code`,
  [from,to]
 );
 return result.rows;
}

router.get("/reports/financial/trial-balance",async(req,res,next)=>{
 const asOf=req.query.as_of;
 if(!validDate(asOf))return res.status(400).json({error:"A valid as_of date is required"});
 try{
  const result=buildTrialBalance(await accountBalancesThrough(asOf));
  res.json({as_of:asOf,...result});
 }catch(error){next(error);}
});

router.get("/reports/financial/income-statement",async(req,res,next)=>{
 const range=dateRange(req,res);if(!range)return;
 try{
  const result=buildIncomeStatement(await accountBalancesForPeriod(range.from,range.to));
  res.json({...range,...result});
 }catch(error){next(error);}
});

router.get("/reports/financial/balance-sheet",async(req,res,next)=>{
 const asOf=req.query.as_of;
 if(!validDate(asOf))return res.status(400).json({error:"A valid as_of date is required"});
 try{
  const result=buildBalanceSheet(await accountBalancesThrough(asOf));
  res.json({as_of:asOf,...result});
 }catch(error){next(error);}
});

export default router;
