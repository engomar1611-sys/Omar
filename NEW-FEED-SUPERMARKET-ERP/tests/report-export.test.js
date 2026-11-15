import test from "node:test";
import assert from "node:assert/strict";
import {toCsv} from "../apps/web/report-export.mjs";

test("creates UTF-8 friendly CSV rows with Arabic headings and escaped delimiters",()=>{
 const csv=toCsv([{name:"منتج، كبير",amount:12.5,note:'قال "تم"'}],[["name","الصنف"],["amount","القيمة"],["note","ملاحظة"]]);
 assert.equal(csv,'"الصنف","القيمة","ملاحظة"\r\n"منتج، كبير","12.5","قال ""تم"""');
});

test("neutralizes spreadsheet formula injection in untrusted text cells",()=>{
 const csv=toCsv([{name:"=HYPERLINK(1)",code:"+SUM(1,2)"},{name:"@cmd",code:"-1+2"}],[["name","الاسم"],["code","الكود"]]);
 assert.match(csv,/'=HYPERLINK/);
 assert.match(csv,/'\+SUM/);
 assert.match(csv,/'@cmd/);
 assert.match(csv,/'-1\+2/);
});

test("preserves numeric negative values as numeric values",()=>{
 assert.equal(toCsv([{amount:-12.5}],[["amount","المبلغ"]]),'"المبلغ"\r\n"-12.5"');
});

test("rejects malformed export inputs",()=>{
 assert.throws(()=>toCsv(null,[]),/Invalid report data/);
 assert.throws(()=>toCsv([],null),/Invalid report data/);
});
