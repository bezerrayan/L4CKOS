/** Product API money values use integer cents; Product UI values use BRL reais. */
export function productPriceFromCents(value: number): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError("PRODUCT_PRICE_CENTS_INVALID");
  }
  return value / 100;
}
