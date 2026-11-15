import test from "node:test";
import assert from "node:assert/strict";
import {validDate} from "../apps/api/src/routes/financial-reports.js";

test("financial report date filters accept valid ISO calendar dates",()=>{
  assert.equal(validDate("2026-11-15"),true);
  assert.equal(validDate("2024-02-29"),true);
});

test("financial report date filters reject malformed and impossible dates",()=>{
  for(const value of ["2026/11/15","15-11-2026","2026-2-05","2026-02-30","2025-02-29","",null,undefined]){
    assert.equal(validDate(value),false,String(value));
  }
});
