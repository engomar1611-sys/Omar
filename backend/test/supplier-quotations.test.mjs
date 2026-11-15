import test from 'node:test';
import assert from 'node:assert/strict';
import { validateSupplierQuotePayload } from '../src/supplier-quotations.mjs';

const requestLines = [
  { id: 'line-1', item_id: 'item-1', requested_qty: '100.000000' },
  { id: 'line-2', item_id: 'item-2', requested_qty: '25.000000' }
];

test('supplier quote accepts exactly one positive quote line for every approved request line', () => {
  assert.equal(validateSupplierQuotePayload({
    quoteNo: 'Q-001', supplierId: 'supplier-1',
    lines: [
      { requestLineId: 'line-1', quantity: 100, unitCost: 12.5 },
      { requestLineId: 'line-2', quantity: 25, unitCost: 8 }
    ]
  }, requestLines), true);
});

test('supplier quote rejects missing, duplicate, foreign, partial and non-positive lines', () => {
  const base = { quoteNo: 'Q-001', supplierId: 'supplier-1' };
  assert.equal(validateSupplierQuotePayload({ ...base, lines: [{ requestLineId: 'line-1', quantity: 100, unitCost: 12 }] }, requestLines), false);
  assert.equal(validateSupplierQuotePayload({ ...base, lines: [
    { requestLineId: 'line-1', quantity: 100, unitCost: 12 },
    { requestLineId: 'line-1', quantity: 25, unitCost: 8 }
  ] }, requestLines), false);
  assert.equal(validateSupplierQuotePayload({ ...base, lines: [
    { requestLineId: 'line-1', quantity: 100, unitCost: 12 },
    { requestLineId: 'foreign', quantity: 25, unitCost: 8 }
  ] }, requestLines), false);
  assert.equal(validateSupplierQuotePayload({ ...base, lines: [
    { requestLineId: 'line-1', quantity: 100, unitCost: 12 },
    { requestLineId: 'line-2', quantity: 25, unitCost: 0 }
  ] }, requestLines), false);
  assert.equal(validateSupplierQuotePayload({ ...base, lines: [
    { requestLineId: 'line-1', quantity: 99, unitCost: 12 },
    { requestLineId: 'line-2', quantity: 25, unitCost: 8 }
  ] }, requestLines), false);
});
