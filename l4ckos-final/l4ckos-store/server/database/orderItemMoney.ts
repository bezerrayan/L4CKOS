const MAX_INT = 2_147_483_647;

/** For new snapshots only. Historical totals may encode an explicit business rule. */
export function orderItemMoney(unitPrice: number, quantity: number) {
  if (!Number.isInteger(unitPrice) || unitPrice < 0 || unitPrice > MAX_INT) {
    throw new Error("unitPrice must be nonnegative integer cents within MySQL INT");
  }
  if (!Number.isInteger(quantity) || quantity <= 0 || quantity > MAX_INT) {
    throw new Error("quantity must be a positive MySQL INT");
  }
  const totalPrice = unitPrice * quantity;
  if (!Number.isSafeInteger(totalPrice) || totalPrice > MAX_INT) {
    throw new Error("Line total exceeds MySQL INT");
  }
  return { unitPrice, quantity, totalPrice };
}
