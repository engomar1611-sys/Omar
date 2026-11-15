import test from "node:test";
import assert from "node:assert/strict";
import {canTransitionDeliveryStatus,deliveryTransitions} from "../apps/api/src/domain/delivery.js";

test("delivery lifecycle permits only defined forward transitions",()=>{
  assert.equal(canTransitionDeliveryStatus("pending","assigned"),true);
  assert.equal(canTransitionDeliveryStatus("assigned","out_for_delivery"),true);
  assert.equal(canTransitionDeliveryStatus("out_for_delivery","delivered"),true);
  assert.equal(canTransitionDeliveryStatus("failed","assigned"),true);
});

test("delivery lifecycle blocks skipping, reopening terminal states and no-op updates",()=>{
  assert.equal(canTransitionDeliveryStatus("pending","delivered"),false);
  assert.equal(canTransitionDeliveryStatus("assigned","delivered"),false);
  assert.equal(canTransitionDeliveryStatus("delivered","pending"),false);
  assert.equal(canTransitionDeliveryStatus("cancelled","assigned"),false);
  assert.equal(canTransitionDeliveryStatus("pending","pending"),false);
});

test("delivery state machine does not expose mutable transition arrays",()=>{
  assert.equal(Object.isFrozen(deliveryTransitions.pending),true);
});
