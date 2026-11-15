const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function validateCardPayment(payment, expectedAmount) {
  if (!payment || typeof payment !== "object") return "Card payment details are required";
  if (!uuid.test(String(payment.bank_id || ""))) return "A valid issuing bank is required";
  if (typeof payment.transaction_reference !== "string" ||
      !payment.transaction_reference.trim() ||
      payment.transaction_reference.trim().length > 50) {
    return "Card transaction reference must contain 1 to 50 characters";
  }
  if (!/^[0-9]{4}$/.test(String(payment.card_last_four || ""))) {
    return "The last four card digits are required";
  }
  const captured = Number(payment.terminal_amount);
  const expected = Number(expectedAmount);
  if (!Number.isFinite(captured) || captured <= 0 ||
      !Number.isFinite(expected) || expected <= 0 ||
      Math.abs(captured - expected) > 0.01) {
    return "Captured terminal amount must match the card payment amount";
  }
  return null;
}
