export function calculateMonthlyDepreciation({purchaseCost,residualValue=0,usefulLifeMonths,accumulatedDepreciation=0,depreciationStartDate,periodMonth}){
  const values=[purchaseCost,residualValue,usefulLifeMonths,accumulatedDepreciation].map(Number);
  if(values.some(v=>!Number.isFinite(v)||v<0)||!Number.isInteger(values[2])||values[2]<=0||values[1]>values[0]||values[3]>values[0]-values[1])
    throw new RangeError("Invalid fixed asset depreciation inputs");
  if(!/^\d{4}-\d{2}-01$/.test(periodMonth||"")||!/^\d{4}-\d{2}-\d{2}$/.test(depreciationStartDate||""))
    throw new RangeError("Invalid depreciation period or start date");
  const periodEnd=new Date(Date.UTC(Number(periodMonth.slice(0,4)),Number(periodMonth.slice(5,7)),0)).toISOString().slice(0,10);
  if(depreciationStartDate>periodEnd)return 0;
  const depreciable=values[0]-values[1]-values[3];
  if(depreciable<=0)return 0;
  return Number(Math.min(depreciable,(values[0]-values[1])/values[2]).toFixed(6));
}
