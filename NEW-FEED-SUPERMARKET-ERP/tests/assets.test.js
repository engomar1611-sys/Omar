import test from "node:test";
import assert from "node:assert/strict";
import {calculateMonthlyDepreciation} from "../apps/api/src/domain/assets.js";

test("straight-line depreciation calculates one monthly charge",()=>{
  assert.equal(calculateMonthlyDepreciation({purchaseCost:120000,residualValue:12000,usefulLifeMonths:36,accumulatedDepreciation:0,depreciationStartDate:"2026-01-01",periodMonth:"2026-01-01"}),3000);
});

test("depreciation caps the final month at the remaining depreciable amount",()=>{
  assert.equal(calculateMonthlyDepreciation({purchaseCost:1000,residualValue:100,usefulLifeMonths:3,accumulatedDepreciation:899,depreciationStartDate:"2026-01-01",periodMonth:"2026-12-01"}),1);
});

test("depreciation does not start before the asset is placed in service",()=>{
  assert.equal(calculateMonthlyDepreciation({purchaseCost:1200,residualValue:0,usefulLifeMonths:12,accumulatedDepreciation:0,depreciationStartDate:"2026-03-15",periodMonth:"2026-02-01"}),0);
});

test("depreciation stops at residual value and rejects invalid lives",()=>{
  assert.equal(calculateMonthlyDepreciation({purchaseCost:1200,residualValue:200,usefulLifeMonths:10,accumulatedDepreciation:1000,depreciationStartDate:"2026-01-01",periodMonth:"2026-12-01"}),0);
  assert.throws(()=>calculateMonthlyDepreciation({purchaseCost:100,residualValue:0,usefulLifeMonths:0,accumulatedDepreciation:0,depreciationStartDate:"2026-01-01",periodMonth:"2026-01-01"}),RangeError);
});
