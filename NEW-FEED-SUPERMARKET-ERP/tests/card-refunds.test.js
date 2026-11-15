import test from "node:test";
import assert from "node:assert/strict";
import {validateCardRefund} from "../apps/api/src/domain/card-refunds.js";

const valid = {
  bank_id: "550e8400-e29b-41d4-a716-446655440000",
  bank_account_id: "550e8400-e29b-41d4-a716-446655440001",
  transaction_reference: "REFUND-20261115-01",
  card_last_four: "1234",
  reference_text: "POS terminal refund",
  terminal_amount: 125.50
};

test("accepts complete card refund metadata matching the approved refund", () => {
  assert.equal(validateCardRefund(valid, 125.50), null);
});

test("accepts a one-piastre terminal rounding difference", () => {
  assert.equal(validateCardRefund({...valid, terminal_amount: 125.51}, 125.50), null);
});

test("rejects missing or malformed issuing and settlement bank identifiers", () => {
  for (const field of ["bank_id", "bank_account_id"]) {
    assert.match(validateCardRefund({...valid, [field]: "invalid"}, 125.50), /bank/i);
  }
});

test("rejects blank and overlong terminal references", () => {
  assert.match(validateCardRefund({...valid, transaction_reference: " "}, 125.50), /reference/i);
  assert.match(validateCardRefund({...valid, transaction_reference: "R".repeat(101)}, 125.50), /reference/i);
});

test("requires exactly four card digits and a bounded refund description", () => {
  for (const card_last_four of ["123", "12345", "12a4", ""]) {
    assert.match(validateCardRefund({...valid, card_last_four}, 125.50), /four/i);
  }
  assert.match(validateCardRefund({...valid, reference_text: " "}, 125.50), /description/i);
  assert.match(validateCardRefund({...valid, reference_text: "R".repeat(121)}, 125.50), /description/i);
});

test("rejects zero, negative, non-finite, and mismatched terminal amounts", () => {
  for (const terminal_amount of [0, -1, NaN, Infinity, 125.511, 125.52]) {
    assert.match(validateCardRefund({...valid, terminal_amount}, 125.50), /amount/i);
  }
});

test("rejects invalid approved refund amounts", () => {
  for (const amount of [0, -1, NaN, Infinity]) {
    assert.match(validateCardRefund(valid, amount), /amount/i);
  }
});
