import test from "node:test";
import assert from "node:assert/strict";
import { getBarcodeLabelSize } from "../apps/api/src/domain/barcode-labels.js";

test("barcode label presets cover common thermal label sizes", () => {
  assert.deepEqual(getBarcodeLabelSize({preset:"30x20"}), {width:30,height:20});
  assert.deepEqual(getBarcodeLabelSize({preset:"50x30"}), {width:50,height:30});
  assert.deepEqual(getBarcodeLabelSize({preset:"100x100"}), {width:100,height:100});
});

test("custom barcode label dimensions are accepted within printer-safe bounds", () => {
  assert.deepEqual(getBarcodeLabelSize({preset:"custom",width:"55",height:"35"}), {width:55,height:35});
  assert.equal(getBarcodeLabelSize({preset:"custom",width:"14",height:"35"}), null);
  assert.equal(getBarcodeLabelSize({preset:"custom",width:"151",height:"35"}), null);
  assert.equal(getBarcodeLabelSize({preset:"custom",width:"55",height:"9"}), null);
  assert.equal(getBarcodeLabelSize({preset:"custom",width:"55.5",height:"35"}), null);
});

test("unknown presets and incomplete custom sizes are rejected", () => {
  assert.equal(getBarcodeLabelSize({preset:"999x999"}), null);
  assert.equal(getBarcodeLabelSize({preset:"custom",width:50}), null);
});
