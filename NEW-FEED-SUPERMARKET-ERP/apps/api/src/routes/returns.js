import {Router} from "express";
import {pool} from "../db.js";
import {calculateReturnPointsRestoration} from "../domain/loyalty.js";
import {requirePermission} from "../auth.js";

const router=Router();
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const text=(v,n=120)=>typeof v==="string"&&v.trim().length>0&&v.trim().length<=n;
const fail=(res,status,error)=>res.status(status).json({error});

export function calculateReturnAmounts({lineTotal,lineQuantity,returnQuantity,invoiceLineBase,orderDiscount,taxTotal}){
  const values=[lineTotal,lineQuantity,returnQuantity,invoiceLineBase,orderDiscount,taxTotal].map(Number);
  if(values.some(v=>!Number.isFinite(v)||v<0)||values[1]<=0||values[2]>values[1])
    throw new RangeError("Invalid return amount inputs");
  const [gross,quantity,returned,base,discount,tax]=values;
  const taxableBase=Math.max(0,base-discount);
  const discountFactor=base>0?taxableBase/base:0;
  const refund=Number((gross*returned/quantity*discountFactor).toFixed(6));
  const taxRefund=Number((taxableBase>0?refund*tax/taxableBase:0).toFixed(6));
  return {refund,taxRefund};
}


router.get("/sales/returns",async(_req,res,next)=>{
  try{
    const r=await pool.query(
      `SELECT sr.*,s.reference_no sale_reference,c.name customer_name,
              COALESCE(SUM(srl.refund_amount+srl.tax_refund_amount),0) refund_total
       FROM sale_returns sr JOIN sales s ON s.id=sr.sale_id
       LEFT JOIN customers c ON c.id=s.customer_id
       LEFT JOIN sale_return_lines srl ON srl.return_id=sr.id
       GROUP BY sr.id,s.reference_no,c.name
       ORDER BY sr.created_at DESC LIMIT 300`);
    res.json({items:r.rows});
  }catch(e){next(e);}
});

router.get("/sales/:saleId/returnable-lines",async(req,res,next)=>{if(!uuid.test(req.params.saleId))return fail(res,400,"Invalid sale id");try{
 const sale=await pool.query("SELECT s.id,s.reference_no,s.status,c.name customer_name FROM sales s LEFT JOIN customers c ON c.id=s.customer_id WHERE s.id=$1",[req.params.saleId]);
 if(!sale.rowCount)return fail(res,404,"Sale not found");
 const lines=await pool.query(`SELECT sl.id sale_line_id,sl.product_id,p.name_ar product_name,sl.quantity sold_quantity,
   COALESCE((SELECT SUM(srl.quantity) FROM sale_return_lines srl JOIN sale_returns sr ON sr.id=srl.return_id WHERE srl.sale_line_id=sl.id AND sr.status<>'rejected'),0) returned_quantity,
   sl.unit_price,sl.line_total,p.tracks_expiry
   FROM sale_lines sl JOIN products p ON p.id=sl.product_id WHERE sl.sale_id=$1 ORDER BY p.name_ar`,[req.params.saleId]);
 res.json({sale:sale.rows[0],items:lines.rows.map(x=>({...x,returnable_quantity:Number(x.sold_quantity)-Number(x.returned_quantity)}))});
}catch(e){next(e);}});
router.get("/sales/returns/:id/details",async(req,res,next)=>{if(!uuid.test(req.params.id))return fail(res,400,"Invalid return id");try{
 const header=await pool.query("SELECT sr.*,s.reference_no sale_reference,s.customer_id,c.name customer_name FROM sale_returns sr JOIN sales s ON s.id=sr.sale_id LEFT JOIN customers c ON c.id=s.customer_id WHERE sr.id=$1",[req.params.id]);
 if(!header.rowCount)return fail(res,404,"Return not found");
 const lines=await pool.query(`SELECT srl.*,p.name_ar product_name,p.tracks_expiry,sl.quantity sold_quantity
   FROM sale_return_lines srl JOIN products p ON p.id=srl.product_id JOIN sale_lines sl ON sl.id=srl.sale_line_id
   WHERE srl.return_id=$1 ORDER BY p.name_ar`,[req.params.id]);
 res.json({return:header.rows[0],lines:lines.rows});
}catch(e){next(e);}});
router.get("/sales/returns/context",async(req,res,next)=>{try{
 const [warehouses,payments,banks,bankAccounts,cashSession]=await Promise.all([
  pool.query("SELECT id,code,name FROM warehouses WHERE is_active ORDER BY name"),
  pool.query("SELECT id,code,name_ar FROM payment_methods WHERE is_active ORDER BY code"),
  pool.query("SELECT id,code,name_ar,name_en FROM payment_banks WHERE is_active ORDER BY name_ar"),
  pool.query("SELECT id,code,bank_name,account_name,currency FROM bank_accounts WHERE is_active AND currency='EGP' AND ledger_account_id IS NOT NULL ORDER BY bank_name,account_name"),
  pool.query("SELECT id,reference_no,cashbox_id FROM cash_sessions WHERE cashier_id=$1 AND status='open' ORDER BY opened_at DESC LIMIT 1",[req.user.id])
 ]);
 res.json({warehouses:warehouses.rows,payment_methods:payments.rows,banks:banks.rows,bank_accounts:bankAccounts.rows,cash_session:cashSession.rows[0]||null});
}catch(e){next(e);}});
router.post("/sales/:saleId/returns",requirePermission("sales.void.line"),async(req,res,next)=>{
  const {reference_no,reason,lines}=req.body??{};
  const requested_by=req.user.id;
  if(!uuid.test(req.params.saleId)||!text(reference_no,50)||!text(reason,1000)||
     (requested_by&&!uuid.test(requested_by))||!Array.isArray(lines)||!lines.length||lines.length>100||
     lines.some(x=>!uuid.test(x.sale_line_id||"")||!Number.isFinite(Number(x.quantity))||Number(x.quantity)<=0))
    return fail(res,400,"Invalid sales return request");
  const client=await pool.connect();
  try{
    await client.query("BEGIN");
    const sale=await client.query("SELECT * FROM sales WHERE id=$1 FOR UPDATE",[req.params.saleId]);
    if(!sale.rowCount||sale.rows[0].status!=="completed")
      throw Object.assign(new Error("Only completed sales can be returned"),{statusCode:409});
    const seen=new Set();
    const resolved=[];
    // Allocate the invoice-level discount proportionally to each returned line.
    // This prevents aggregate refunds (including tax) from exceeding the original paid merchandise value.
    const lineBaseResult=await client.query("SELECT COALESCE(SUM(line_total),0) total FROM sale_lines WHERE sale_id=$1",[req.params.saleId]);
    const lineBase=Number(lineBaseResult.rows[0].total);
    const invoiceOrderDiscount=Number(sale.rows[0].order_discount_amount||0);
    const originalTaxTotal=Number(sale.rows[0].tax_total||0);
    for(const item of lines){
      if(seen.has(item.sale_line_id)) throw Object.assign(new Error("Duplicate sale line"),{statusCode:400});
      seen.add(item.sale_line_id);
      const q=await client.query(
        `SELECT sl.*,p.tracks_expiry,
          COALESCE((SELECT SUM(srl.quantity) FROM sale_return_lines srl
            JOIN sale_returns sr ON sr.id=srl.return_id
            WHERE srl.sale_line_id=sl.id AND sr.status<>'rejected'),0) returned_qty
         FROM sale_lines sl JOIN products p ON p.id=sl.product_id
         WHERE sl.id=$1 AND sl.sale_id=$2 FOR UPDATE OF sl`,
        [item.sale_line_id,req.params.saleId]);
      if(!q.rowCount) throw Object.assign(new Error("Sale line does not belong to this sale"),{statusCode:400});
      const row=q.rows[0],qty=Number(item.quantity);
      if(qty>Number(row.quantity)-Number(row.returned_qty)+0.000001)
        throw Object.assign(new Error("Return quantity exceeds the unreturned sold quantity"),{statusCode:409});
      const {refund,taxRefund}=calculateReturnAmounts({
        lineTotal:Number(row.line_total),lineQuantity:Number(row.quantity),returnQuantity:qty,
        invoiceLineBase:lineBase,orderDiscount:invoiceOrderDiscount,taxTotal:originalTaxTotal
      });
      resolved.push({row,qty,refund,taxRefund});
    }
    const ret=await client.query(
      "INSERT INTO sale_returns(reference_no,sale_id,status,reason,requested_by) VALUES($1,$2,'pending_inspection',$3,$4) RETURNING *",
      [reference_no.trim(),req.params.saleId,reason.trim(),requested_by]);
    for(const x of resolved){
      await client.query(
        "INSERT INTO sale_return_lines(return_id,sale_line_id,product_id,quantity,condition,refund_amount,tax_refund_amount) VALUES($1,$2,$3,$4,'pending',$5,$6)",
        [ret.rows[0].id,x.row.id,x.row.product_id,x.qty,x.refund,x.taxRefund]);
    }
    await client.query("COMMIT");
    res.status(201).json({return:ret.rows[0],line_count:resolved.length,refund_total:Number(resolved.reduce((s,x)=>s+x.refund+x.taxRefund,0).toFixed(6)),tax_refund_total:Number(resolved.reduce((s,x)=>s+x.taxRefund,0).toFixed(6))});
  }catch(e){
    await client.query("ROLLBACK");
    if(e.statusCode)return fail(res,e.statusCode,e.message);
    next(e);
  }finally{client.release();}
});

router.post("/sales/returns/:id/inspect",requirePermission("returns.inspect"),async(req,res,next)=>{
  const {warehouse_id,inspection_note=null,lines}=req.body??{};
  const inspected_by=req.user.id;
  if(!uuid.test(req.params.id)||!uuid.test(warehouse_id||"")||(inspected_by&&!uuid.test(inspected_by))||
     !Array.isArray(lines)||!lines.length||lines.length>100||
     lines.some(x=>!uuid.test(x.return_line_id||"")||!["sellable","damaged","expired"].includes(x.condition)||
       (x.expiry_date&&!/^\\d{4}-\\d{2}-\\d{2}$/.test(x.expiry_date))))
    return fail(res,400,"Invalid return inspection");
  const client=await pool.connect();
  try{
    await client.query("BEGIN");
    const ret=await client.query("SELECT * FROM sale_returns WHERE id=$1 FOR UPDATE",[req.params.id]);
    if(!ret.rowCount||ret.rows[0].status!=="pending_inspection")
      throw Object.assign(new Error("Return is not awaiting warehouse inspection"),{statusCode:409});
    const wh=await client.query("SELECT id FROM warehouses WHERE id=$1 AND is_active=true",[warehouse_id]);
    if(!wh.rowCount)throw Object.assign(new Error("Active warehouse not found"),{statusCode:400});
    const expected=await client.query(
      "SELECT srl.id,srl.product_id,p.tracks_expiry FROM sale_return_lines srl JOIN products p ON p.id=srl.product_id WHERE srl.return_id=$1 FOR UPDATE",
      [req.params.id]);
    if(expected.rowCount!==lines.length)throw Object.assign(new Error("Inspection must include every return line exactly once"),{statusCode:400});
    const seen=new Set();
    for(const x of lines){
      if(seen.has(x.return_line_id))throw Object.assign(new Error("Duplicate return line"),{statusCode:400});
      seen.add(x.return_line_id);
      const row=expected.rows.find(y=>y.id===x.return_line_id);
      if(!row)throw Object.assign(new Error("Return line not found"),{statusCode:400});
      if(x.condition==="sellable"&&row.tracks_expiry&&(!x.expiry_date||x.expiry_date<new Date().toISOString().slice(0,10)))
        throw Object.assign(new Error("A valid future expiry date is required for sellable expiry-tracked goods"),{statusCode:400});
      await client.query(
        "UPDATE sale_return_lines SET condition=$2,expiry_date=$3,inspected_by=$4,inspected_at=now() WHERE id=$1",
        [row.id,x.condition,x.expiry_date||null,inspected_by]);
    }
    await client.query(
      "UPDATE sale_returns SET status='pending_finance',warehouse_id=$2,inspected_by=$3,inspection_note=$4 WHERE id=$1",
      [req.params.id,warehouse_id,inspected_by,inspection_note]);
    await client.query("COMMIT");
    res.json({return_id:req.params.id,status:"pending_finance"});
  }catch(e){
    await client.query("ROLLBACK");
    if(e.statusCode)return fail(res,e.statusCode,e.message);
    next(e);
  }finally{client.release();}
});

router.post("/sales/returns/:id/approve",requirePermission("returns.approve"),async(req,res,next)=>{
  const financially_approved_by=req.user.id;
  if(!uuid.test(req.params.id)||(financially_approved_by&&!uuid.test(financially_approved_by)))
    return fail(res,400,"Invalid financial approval fields");
  const client=await pool.connect();
  try{
    await client.query("BEGIN");
    const ret=await client.query("SELECT * FROM sale_returns WHERE id=$1 FOR UPDATE",[req.params.id]);
    if(!ret.rowCount||ret.rows[0].status!=="pending_finance")
      throw Object.assign(new Error("Return is not awaiting financial approval"),{statusCode:409});
    const lines=await client.query(
      "SELECT srl.*,sl.sale_id,p.tracks_expiry FROM sale_return_lines srl JOIN sale_lines sl ON sl.id=srl.sale_line_id JOIN products p ON p.id=srl.product_id WHERE srl.return_id=$1 FOR UPDATE",
      [req.params.id]);
    let restockedCost=0;
    for(const line of lines.rows){
      if(line.condition!=="sellable")continue;
      const cost=await client.query(
        `SELECT COALESCE(SUM(quantity_out*unit_cost)/NULLIF(SUM(quantity_out),0),0) unit_cost,
                COALESCE(SUM(quantity_out),0) issued_quantity
         FROM stock_movements WHERE source_type='sale' AND source_id=$1 AND product_id=$2 AND movement_type='sale_issue'`,
        [line.sale_id,line.product_id]);
      const unitCost=Number(cost.rows[0].unit_cost);
      if(!Number.isFinite(unitCost)||Number(cost.rows[0].issued_quantity)<=0)
        throw Object.assign(new Error("Cannot determine original inventory cost for returned product "+line.product_id),{statusCode:409});
      const lot=await client.query(
        "INSERT INTO stock_lots(product_id,warehouse_id,lot_number,expiry_date,quantity_on_hand,unit_cost,is_saleable) VALUES($1,$2,$3,$4,$5,$6,true) RETURNING id",
        [line.product_id,ret.rows[0].warehouse_id,"RET-"+ret.rows[0].reference_no,line.expiry_date,line.quantity,unitCost]);
      const movement=await client.query(
        "INSERT INTO stock_movements(reference_no,movement_type,product_id,warehouse_id,lot_id,quantity_in,unit_cost,source_type,source_id,created_by) VALUES($1,'sale_return',$2,$3,$4,$5,$6,'sale_return',$7,$8) RETURNING id",
        [ret.rows[0].reference_no,line.product_id,ret.rows[0].warehouse_id,lot.rows[0].id,line.quantity,unitCost,req.params.id,financially_approved_by]);
      await client.query("UPDATE sale_return_lines SET stock_lot_id=$2 WHERE id=$1",[line.id,lot.rows[0].id]);
      restockedCost+=Number(line.quantity)*unitCost;
    }
    const subtotal=lines.rows.reduce((s,x)=>s+Number(x.refund_amount),0);
    const taxTotal=lines.rows.reduce((s,x)=>s+Number(x.tax_refund_amount||0),0);
    const total=subtotal+taxTotal;
    const period=await client.query("SELECT 1 FROM accounting_periods WHERE status='closed' AND CURRENT_DATE BETWEEN starts_on AND ends_on LIMIT 1");
    if(period.rowCount)throw Object.assign(new Error("The current accounting period is closed"),{statusCode:409});
    const mappings=await client.query("SELECT mapping_key,account_id FROM system_account_mappings WHERE mapping_key=ANY($1::varchar[])",[["sales_returns","refund_payable","inventory","cogs"]]);
    const map=Object.fromEntries(mappings.rows.map(x=>[x.mapping_key,x.account_id]));
    if(!map.sales_returns||!map.refund_payable||!map.inventory||!map.cogs)
      throw Object.assign(new Error("Return accounting mappings are missing; apply migration 012"),{statusCode:409});
    let journalEntryId=null;
    if(total>0||restockedCost>0){
      const je=await client.query("INSERT INTO journal_entries(reference_no,source_type,source_id,entry_date,status) VALUES($1,'sale_return_approval',$2,CURRENT_DATE,'posted') RETURNING id",["JE-"+req.params.id,req.params.id]);
      journalEntryId=je.rows[0].id;
      if(subtotal>0)await client.query("INSERT INTO journal_lines(journal_entry_id,account_id,debit,credit) VALUES($1,$2,$3,0)",[journalEntryId,map.sales_returns,subtotal]);
      if(taxTotal>0){
        const taxAccount=await client.query("SELECT tc.account_id,a.account_type FROM sales s JOIN tax_codes tc ON tc.id=s.tax_code_id JOIN accounts a ON a.id=tc.account_id WHERE s.id=$1",[ret.rows[0].sale_id]);
        if(!taxAccount.rowCount||taxAccount.rows[0].account_type!=="liability")throw Object.assign(new Error("Original sale tax liability account is unavailable; tax return cannot be posted"),{statusCode:409});
        await client.query("INSERT INTO journal_lines(journal_entry_id,account_id,debit,credit) VALUES($1,$2,$3,0)",[journalEntryId,taxAccount.rows[0].account_id,taxTotal]);
      }
      if(total>0)await client.query("INSERT INTO journal_lines(journal_entry_id,account_id,debit,credit) VALUES($1,$2,0,$3)",[journalEntryId,map.refund_payable,total]);
      if(restockedCost>0){
        await client.query("INSERT INTO journal_lines(journal_entry_id,account_id,debit,credit) VALUES($1,$2,$3,0)",[journalEntryId,map.inventory,restockedCost]);
        await client.query("INSERT INTO journal_lines(journal_entry_id,account_id,debit,credit) VALUES($1,$2,0,$3)",[journalEntryId,map.cogs,restockedCost]);
      }
    }
    const saleId=lines.rows[0]?.sale_id;
    if(saleId){
      const sale=await client.query("SELECT customer_id,loyalty_points_redeemed,order_discount_amount FROM sales WHERE id=$1 FOR UPDATE",[saleId]);
      if(sale.rowCount&&sale.rows[0].customer_id&&Number(sale.rows[0].loyalty_points_redeemed)>0){
        const base=await client.query("SELECT COALESCE(SUM(line_total),0)::numeric merchandise_base FROM sale_lines WHERE sale_id=$1",[saleId]);
        const prior=await client.query(`SELECT COALESCE(SUM(srl.quantity/NULLIF(sl.quantity,0)*sl.line_total),0)::numeric amount
          FROM sale_return_lines srl JOIN sale_returns sr ON sr.id=srl.return_id JOIN sale_lines sl ON sl.id=srl.sale_line_id
          WHERE sr.sale_id=$1 AND sr.id<>$2 AND sr.status IN ('approved','refunded')`,[saleId,req.params.id]);
        const current=await client.query(`SELECT COALESCE(SUM(srl.quantity/NULLIF(sl.quantity,0)*sl.line_total),0)::numeric amount
          FROM sale_return_lines srl JOIN sale_lines sl ON sl.id=srl.sale_line_id WHERE srl.return_id=$1`,[req.params.id]);
        const already=await client.query("SELECT COALESCE(SUM(l.points),0)::bigint points FROM customer_loyalty_transactions l JOIN sale_returns sr ON sr.id=l.source_id WHERE sr.sale_id=$1 AND l.source_type='sale_return' AND l.transaction_type='earn'",[saleId]);
        const currentRefund=lines.rows.reduce((sum,line)=>sum+Number(line.refund_amount||0),0);
        const restorePoints=calculateReturnPointsRestoration({
          pointsRedeemed:Number(sale.rows[0].loyalty_points_redeemed),
          originalMerchandiseBase:Number(base.rows[0].merchandise_base),
          cumulativeReturnedBase:Number(prior.rows[0].amount)+Number(current.rows[0].amount),
          pointsAlreadyRestored:Number(already.rows[0].points)
        });
        if(restorePoints>0){
          await client.query("UPDATE customers SET loyalty_points=loyalty_points+$2 WHERE id=$1",[sale.rows[0].customer_id,restorePoints]);
          await client.query("INSERT INTO customer_loyalty_transactions(customer_id,reference_no,transaction_type,points,source_type,source_id,notes,created_by) VALUES($1,$2,'earn',$3,'sale_return',$4,'Restore redeemed points proportionally for approved return',$5)",
            [sale.rows[0].customer_id,"RET-LOY-"+ret.rows[0].reference_no,restorePoints,req.params.id,financially_approved_by]);
        }
      }
    }
    await client.query(
      "UPDATE sale_returns SET status='approved',financially_approved_by=$2,approved_at=now() WHERE id=$1",
      [req.params.id,financially_approved_by]);
    await client.query("COMMIT");
    res.json({return_id:req.params.id,status:"approved",refund_due:Number(total.toFixed(6)),restocked_lines:lines.rows.filter(x=>x.condition==="sellable").length,journal_entry_id:journalEntryId});
  }catch(e){
    await client.query("ROLLBACK");
    if(e.statusCode)return fail(res,e.statusCode,e.message);
    next(e);
  }finally{client.release();}
});

router.post("/sales/returns/:id/refund",requirePermission("returns.approve"),async(req,res,next)=>{
  const {payment_method_id,amount,reference_text=null,bank_id=null,bank_account_id=null,transaction_reference=null,card_last_four=null,terminal_amount=null}=req.body??{};
  const processed_by=req.user.id;
  if(!uuid.test(req.params.id)||!uuid.test(payment_method_id||"")||
     !Number.isFinite(Number(amount))||Number(amount)<=0||(processed_by&&!uuid.test(processed_by)))
    return fail(res,400,"Invalid refund fields");
  const client=await pool.connect();
  try{
    await client.query("BEGIN");
    const ret=await client.query("SELECT * FROM sale_returns WHERE id=$1 FOR UPDATE",[req.params.id]);
    if(!ret.rowCount||ret.rows[0].status!=="approved")
      throw Object.assign(new Error("Return must be financially approved before refund"),{statusCode:409});
    const total=await client.query("SELECT COALESCE(SUM(refund_amount+tax_refund_amount),0) amount FROM sale_return_lines WHERE return_id=$1",[req.params.id]);
    if(Math.abs(Number(total.rows[0].amount)-Number(amount))>0.01)
      throw Object.assign(new Error("Refund amount must equal the approved return amount"),{statusCode:400});
    const method=await client.query("SELECT id,account_id,code,name_ar FROM payment_methods WHERE id=$1 AND is_active=true",[payment_method_id]);
    if(!method.rowCount||!method.rows[0].account_id)throw Object.assign(new Error("Active payment method has no ledger account mapping"),{statusCode:400});
    const isCard=/card|visa|بطاقة|فيزا/i.test(String(method.rows[0].code||"")+" "+String(method.rows[0].name_ar||""));
    if(isCard){
      if(!uuid.test(bank_id||"")||!uuid.test(bank_account_id||"")||!text(transaction_reference,100)||!/^[0-9]{4}$/.test(String(card_last_four||""))||!text(reference_text,120)||!Number.isFinite(Number(terminal_amount))||Math.abs(Number(terminal_amount)-Number(amount))>0.01)
        throw Object.assign(new Error("Card refunds require issuing bank, merchant settlement bank account, terminal refund reference, last 4 digits and matching terminal amount"),{statusCode:400});
      const bank=await client.query("SELECT id FROM payment_banks WHERE id=$1 AND is_active=true",[bank_id]);
      if(!bank.rowCount)throw Object.assign(new Error("Selected card refund bank is inactive"),{statusCode:400});
      const settlement=await client.query("SELECT id,ledger_account_id FROM bank_accounts WHERE id=$1 AND is_active=true AND currency='EGP' AND ledger_account_id IS NOT NULL FOR UPDATE",[bank_account_id]);
      if(!settlement.rowCount)throw Object.assign(new Error("Select an active EGP merchant settlement bank account with a GL mapping"),{statusCode:400});
      var settlementBank=settlement.rows[0];
    }
    const period=await client.query("SELECT 1 FROM accounting_periods WHERE status='closed' AND CURRENT_DATE BETWEEN starts_on AND ends_on LIMIT 1");
    if(period.rowCount)throw Object.assign(new Error("The current accounting period is closed"),{statusCode:409});
    const payable=await client.query("SELECT account_id FROM system_account_mappings WHERE mapping_key='refund_payable'");
    if(!payable.rowCount)throw Object.assign(new Error("Refund payable mapping is missing; apply migration 012"),{statusCode:409});
    let cashSessionId=null;
    if(String(method.rows[0].code||"").toUpperCase()==="CASH"){
      const session=await client.query("SELECT * FROM cash_sessions WHERE cashier_id=$1 AND status='open' ORDER BY opened_at DESC LIMIT 1 FOR UPDATE",[processed_by]);
      if(!session.rowCount)throw Object.assign(new Error("Open a cash session before paying a cash refund"),{statusCode:409});
      const cashBalance=await client.query(`SELECT $2::numeric
        +COALESCE((SELECT SUM(CASE WHEN direction='in' THEN amount ELSE -amount END) FROM cash_transactions WHERE cash_session_id=$1),0)
        +COALESCE((SELECT SUM(sp.amount) FROM sale_payments sp JOIN sales sa ON sa.id=sp.sale_id WHERE sp.cash_session_id=$1 AND sa.status='completed'),0) balance`,
        [session.rows[0].id,session.rows[0].opening_float]);
      if(Number(cashBalance.rows[0].balance)+0.000001<Number(amount))
        throw Object.assign(new Error("Cash session does not have enough available cash for this refund"),{statusCode:409});
      cashSessionId=session.rows[0].id;
    }
    const je=await client.query("INSERT INTO journal_entries(reference_no,source_type,source_id,entry_date,status) VALUES($1,'sale_return_refund',$2,CURRENT_DATE,'posted') RETURNING id",["JER-"+req.params.id,req.params.id]);
    await client.query("INSERT INTO journal_lines(journal_entry_id,account_id,debit,credit) VALUES($1,$2,$3,0)",[je.rows[0].id,payable.rows[0].account_id,amount]);
    const refundCreditAccountId=isCard?settlementBank.ledger_account_id:method.rows[0].account_id;
    await client.query("INSERT INTO journal_lines(journal_entry_id,account_id,debit,credit) VALUES($1,$2,0,$3)",[je.rows[0].id,refundCreditAccountId,amount]);
    await client.query(
      "INSERT INTO sale_return_refunds(return_id,payment_method_id,amount,reference_text,processed_by,cash_session_id,bank_id,transaction_reference,card_last_four,settlement_bank_account_id,terminal_amount) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)",
      [req.params.id,payment_method_id,amount,reference_text,processed_by,cashSessionId,isCard?bank_id:null,isCard?transaction_reference.trim():null,isCard?card_last_four:null,isCard?bank_account_id:null,isCard?Number(terminal_amount):null]);
    if(cashSessionId){
      await client.query("INSERT INTO cash_transactions(cashbox_id,cash_session_id,reference_no,direction,amount,source_type,description,created_by,journal_entry_id) VALUES($1,$2,$3,'out',$4,'sale_return_refund',$5,$6,$7)",
        [ (await client.query("SELECT cashbox_id FROM cash_sessions WHERE id=$1",[cashSessionId])).rows[0].cashbox_id,cashSessionId,"RET-"+req.params.id.replaceAll("-","").slice(0,32),amount,"Cash refund for sales return "+ret.rows[0].reference_no,processed_by,je.rows[0].id ]);
    }
    if(isCard){
      const bankTx=await client.query("INSERT INTO bank_transactions(bank_account_id,reference_no,transaction_date,direction,amount,description,source_type,source_id,journal_entry_id,created_by) VALUES($1,$2,CURRENT_DATE,'out',$3,$4,'sale_return_refund',$5,$6,$7) RETURNING id",
        [bank_account_id,"RET-"+req.params.id.replaceAll("-","").slice(0,32),amount,"Card refund for sales return "+ret.rows[0].reference_no,req.params.id,je.rows[0].id,processed_by]);
      await client.query("UPDATE sale_return_refunds SET bank_transaction_id=$2 WHERE return_id=$1",[req.params.id,bankTx.rows[0].id]);
    }
    await client.query("UPDATE sale_returns SET status='refunded' WHERE id=$1",[req.params.id]);
    await client.query("COMMIT");
    res.json({return_id:req.params.id,status:"refunded",amount:Number(amount),journal_entry_id:je.rows[0].id});
  }catch(e){
    await client.query("ROLLBACK");
    if(e.statusCode)return fail(res,e.statusCode,e.message);
    next(e);
  }finally{client.release();}
});

export default router;
