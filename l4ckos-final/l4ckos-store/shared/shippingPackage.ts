/**
 * Single source of truth for the shipping parcel (owner-approved 2026-11-20: 32 x 22 x 6 cm, 300 g per unit).
 * Used by BOTH the carrier quote request and the parcel that the STOCK checkout signs into its quote token, so the
 * price shown, the signed terms and the order snapshot are always quoted for the same package.
 * Multiple units keep the footprint and height and add 300 g per unit (previous behaviour, unchanged).
 */
export const SHIPPING_PACKAGE = { heightCm: 6, widthCm: 22, lengthCm: 32, gramsPerItem: 300 } as const;

export function shippingPackageFor(itemCount: number) {
  const units = Math.max(1, Math.trunc(itemCount) || 1);
  return {
    heightCm: SHIPPING_PACKAGE.heightCm,
    widthCm: SHIPPING_PACKAGE.widthCm,
    lengthCm: SHIPPING_PACKAGE.lengthCm,
    weightGrams: SHIPPING_PACKAGE.gramsPerItem * units,
  };
}
