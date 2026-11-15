export const deliveryTransitions=Object.freeze({
  pending:Object.freeze(["assigned","cancelled","failed"]),
  assigned:Object.freeze(["out_for_delivery","cancelled","failed"]),
  out_for_delivery:Object.freeze(["delivered","failed"]),
  failed:Object.freeze(["assigned","cancelled"])
});
export function canTransitionDeliveryStatus(current,next){
  return Boolean(deliveryTransitions[current]?.includes(next));
}
