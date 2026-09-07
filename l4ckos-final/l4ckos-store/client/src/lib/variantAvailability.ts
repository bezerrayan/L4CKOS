import type { Product } from "../types/product";

type Variant = NonNullable<Product["variants"]>[number];

export function normalizeVariantOption(value: string | null | undefined) {
  return String(value ?? "")
    .trim()
    .toLocaleLowerCase("pt-BR")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, "-");
}

function equalsOption(left: string | null | undefined, right: string | null | undefined) {
  return normalizeVariantOption(left) === normalizeVariantOption(right);
}

export function isVariantInStock(variant: Variant) {
  return Number(variant.stock ?? 0) > 0;
}

export function findSelectedVariant(
  variants: Variant[],
  selectedColor: string | null,
  selectedSize: string | null,
) {
  return variants.find(variant =>
    (!variant.color || equalsOption(variant.color, selectedColor)) &&
    (!variant.size || equalsOption(variant.size, selectedSize)),
  );
}

export function isColorAvailable(variants: Variant[], color: string, selectedSize: string | null) {
  return variants.some(variant =>
    isVariantInStock(variant) &&
    equalsOption(variant.color, color) &&
    (!selectedSize || !variant.size || equalsOption(variant.size, selectedSize)),
  );
}

export function isSizeAvailable(variants: Variant[], size: string, selectedColor: string | null) {
  return variants.some(variant =>
    isVariantInStock(variant) &&
    equalsOption(variant.size, size) &&
    (!selectedColor || !variant.color || equalsOption(variant.color, selectedColor)),
  );
}

export function hasAvailableVariant(variants: Variant[]) {
  return variants.some(isVariantInStock);
}
