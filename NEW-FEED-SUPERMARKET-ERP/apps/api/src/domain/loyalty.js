export function calculateLoyaltyRedemption({pointsRequested=0,availablePoints=0,egpPerPoint=0,eligibleAmount=0}){
  const values=[pointsRequested,availablePoints,egpPerPoint,eligibleAmount].map(Number);
  if(values.some(v=>!Number.isFinite(v)||v<0)||!Number.isSafeInteger(values[0])||!Number.isSafeInteger(values[1]))
    throw new RangeError("Invalid loyalty redemption inputs");
  const [points,available,rate,eligible]=values;
  if(points===0)return {points:0,discount:0};
  if(rate<=0)throw new RangeError("Loyalty redemption is not enabled");
  if(points>available)throw new RangeError("Insufficient loyalty points");
  const discount=Math.min(eligible,points*rate);
  const redeemable=Math.min(points,Math.floor((eligible+1e-9)/rate));
  if(redeemable!==points||discount<=0)throw new RangeError("Requested points exceed the eligible invoice value");
  return {points,discount:Number(discount.toFixed(6))};
}

export function calculateReturnPointsRestoration({pointsRedeemed=0,originalMerchandiseBase=0,cumulativeReturnedBase=0,pointsAlreadyRestored=0}){
  const values=[pointsRedeemed,originalMerchandiseBase,cumulativeReturnedBase,pointsAlreadyRestored].map(Number);
  if(values.some(v=>!Number.isFinite(v)||v<0)||!Number.isSafeInteger(values[0])||!Number.isSafeInteger(values[3]))
    throw new RangeError("Invalid loyalty return restoration inputs");
  const [points,base,returned,restored]=values;
  if(restored>points)throw new RangeError("Previously restored points exceed original redemption");
  if(points===0||base===0)return 0;
  const cumulative=Math.min(points,Math.floor(points*Math.min(base,returned)/base+1e-9));
  return Math.max(0,cumulative-restored);
}
