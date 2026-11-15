import test from "node:test";
import assert from "node:assert/strict";
import {validateCardPayment} from "../apps/api/src/domain/card-payments.js";

const valid = {
  bank_id: "550e8400-e29b-41d4-a716-446655440000",
  transaction_reference: "POS-REF-20261115",
  card_last_four: "1234",
  terminal_amount: 125.50
};

test("accepts complete card payment metadata with matching captured amount",()=>{
  assert.equal(validateCardPayment(valid,125.50),null);
});

test("accepts a terminal rounding difference of one piastre",()=>{
  assert.equal(validateCardPayment({...valid,terminal_amount:125.51},125.50),null);
});

test("rejects missing or malformed bank identifiers",()=>{
  assert.match(validateCardPayment({...valid,bank_id:""},125.50),/bank/i);
  assert.match(validateCardPayment({...valid,bank_id:"not-a-uuid"},125.50),/bank/i);
});

test("rejects blank and overlong transaction references",()=>{
  assert.match(validateCardPayment({...valid,transaction_reference:"  "},125.50),/reference/i);
  assert.match(validateCardPayment({...valid,transaction_reference:"R".repeat(51)},125.50),/reference/i);
});

test("rejects card numbers that do not contain exactly four digits",()=>{
  for(const value of ["123","12345","12a4",""]) {
    assert.match(validateCardPayment({...valid,card_last_four:value},125.50),/four/i);
  }
});

test("rejects zero, negative, non-finite, and mismatched captured amounts",()=>{
  for(const value of [0,-1,NaN,Infinity,125.52]) {
    assert.match(validateCardPayment({...valid,terminal_amount:value},125.50),/amount/i);
  }
});

test("rejects invalid expected payment amounts",()=>{
  for(const value of [0,-1,NaN,Infinity]) {
    assert.match(validateCardPayment(valid,value),/amount/i);
  }
});
