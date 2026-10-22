/** Exact references used by current checkout and the historical Asaas integration.
 * Descriptions are not identifiers and never authorize a payment/order binding.
 */
export function parseAsaasOrderReference(reference: unknown): number | null {
  if (typeof reference !== "string" && typeof reference !== "number")
    return null;
  const match = /^(?:L4CKOS-ORDER-)?([1-9]\d{0,9})$/.exec(String(reference));
  if (!match) return null;
  const id = Number(match[1]);
  return Number.isSafeInteger(id) && id <= 2_147_483_647 ? id : null;
}
