import test from "node:test";
import assert from "node:assert/strict";
import {calculateReturnAmounts} from "../apps/api/src/routes/returns.js";

test("partial returns allocate invoice-level discount and tax proportionally",()=>{
  const a=calculateReturnAmounts({lineTotal:100,lineQuantity:2,returnQuantity:1,invoiceLineBase:200,orderDiscount:20,taxTotal:14});
  assert.deepEqual(a,{refund:45,taxRefund:3.5});
});

test("full return across all lines never refunds more than original taxable base or tax",()=>{
  const a=calculateReturnAmounts({lineTotal:100,lineQuantity:2,returnQuantity:2,invoiceLineBase:200,orderDiscount:20,taxTotal:14});
  const b=calculateReturnAmounts({lineTotal:100,lineQuantity:2,returnQuantity:2,invoiceLineBase:200,orderDiscount:20,taxTotal:14});
  assert.equal(a.refund+b.refund,180);
  assert.equal(a.taxRefund+b.taxRefund,14);
});

test("zero taxable base produces no merchandise or tax refund",()=>{
  const result=calculateReturnAmounts({lineTotal:100,lineQuantity:1,returnQuantity:1,invoiceLineBase:100,orderDiscount:100,taxTotal:0});
  assert.deepEqual(result,{refund:0,taxRefund:0});
});

test("invalid return quantities are rejected",()=>{
  assert.throws(()=>calculateReturnAmounts({lineTotal:100,lineQuantity:1,returnQuantity:2,invoiceLineBase:100,orderDiscount:0,taxTotal:14}),RangeError);
});
