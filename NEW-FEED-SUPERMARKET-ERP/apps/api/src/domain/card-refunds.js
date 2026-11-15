const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function validateCardRefund(refund, expectedAmount) {
  if (!refund || typeof refund !== "object") return "Card refund details are required";
  if (!uuid.test(String(refund.bank_id || ""))) return "A valid issuing bank is required";
  if (!uuid.test(String(refund.bank_account_id || ""))) return "A valid merchant settlement bank account is required";
  if (typeof refund.transaction_reference !== "string" ||
      !refund.transaction_reference.trim() ||
      refund.transaction_reference.trim().length > 100) {
    return "Card refund terminal reference must contain 1 to 100 characters";
  }
  if (!/^[0-9]{4}$/.test(String(refund.card_last_four || ""))) {
    return "The last four card digits are required";
  }
  if (typeof refund.reference_text !== "string" ||
      !refund.reference_text.trim() ||
      refund.reference_text.trim().length > 120) {
    return "Card refund description must contain 1 to 120 characters";
  }
  const captured = Number(refund.terminal_amount);
  const expected = Number(expectedAmount);
  if (!Number.isFinite(captured) || captured <= 0 ||
      !Number.isFinite(expected) || expected <= 0 ||
      Math.abs(captured - expected) > 0.010000001) {
    return "Captured terminal refund amount must match the approved refund amount";
  }
  return null;
}
