import test from "node:test";
import assert from "node:assert/strict";
import {calculateLoyaltyRedemption,calculateReturnPointsRestoration} from "../apps/api/src/domain/loyalty.js";

test("POS redemption converts points into an invoice discount at the configured rate",()=>{
  assert.deepEqual(calculateLoyaltyRedemption({pointsRequested:100,availablePoints:250,egpPerPoint:0.5,eligibleAmount:80}),{points:100,discount:50});
});

test("redemption cannot exceed customer balance or eligible merchandise value",()=>{
  assert.throws(()=>calculateLoyaltyRedemption({pointsRequested:101,availablePoints:100,egpPerPoint:1,eligibleAmount:500}),/Insufficient loyalty points/);
  assert.throws(()=>calculateLoyaltyRedemption({pointsRequested:20,availablePoints:100,egpPerPoint:1,eligibleAmount:19}),/eligible invoice value/);
});

test("redemption requires an explicitly enabled conversion rate",()=>{
  assert.throws(()=>calculateLoyaltyRedemption({pointsRequested:10,availablePoints:10,egpPerPoint:0,eligibleAmount:100}),/not enabled/);
});

test("partial returns restore points cumulatively without over-restoring",()=>{
  const first=calculateReturnPointsRestoration({pointsRedeemed:100,originalMerchandiseBase:200,cumulativeReturnedBase:50,pointsAlreadyRestored:0});
  const second=calculateReturnPointsRestoration({pointsRedeemed:100,originalMerchandiseBase:200,cumulativeReturnedBase:150,pointsAlreadyRestored:first});
  const last=calculateReturnPointsRestoration({pointsRedeemed:100,originalMerchandiseBase:200,cumulativeReturnedBase:200,pointsAlreadyRestored:first+second});
  assert.deepEqual([first,second,last],[25,50,25]);
});

test("return restoration never exceeds the original redeemed points",()=>{
  assert.equal(calculateReturnPointsRestoration({pointsRedeemed:10,originalMerchandiseBase:100,cumulativeReturnedBase:200,pointsAlreadyRestored:10}),0);
  assert.throws(()=>calculateReturnPointsRestoration({pointsRedeemed:10,originalMerchandiseBase:100,cumulativeReturnedBase:50,pointsAlreadyRestored:11}),/exceed/);
});
