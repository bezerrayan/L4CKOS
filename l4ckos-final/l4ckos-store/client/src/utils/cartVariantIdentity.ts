import type { CartItem, CartVariant, SellableVariantCatalog } from "../types/cart";

export function resolveCartVariant(
  catalog: SellableVariantCatalog,
  item: Pick<CartItem, "variant" | "selectedOptions">,
): CartVariant | null {
  if (!catalog.hasVariants) return null;

  const color = item.variant?.color ?? item.selectedOptions?.cor ?? item.selectedOptions?.color;
  const size = item.variant?.size ?? item.selectedOptions?.tamanho ?? item.selectedOptions?.size;
  const matches = item.variant
    ? catalog.variants.filter(variant => variant.variantId === item.variant?.variantId)
    : color && size
      ? catalog.variants.filter(variant => variant.color === color && variant.size === size)
      : [];

  if (matches.length !== 1) return null;
  const [variant] = matches;
  return {
    variantId: variant.variantId,
    color: variant.color,
    size: variant.size,
    priceCents: variant.price,
    availableUnits: variant.availableUnits,
  };
}
