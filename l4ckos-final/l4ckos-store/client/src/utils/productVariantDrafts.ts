export type ProductVariantOption = { color: string; size: string };

const identity = (value: string) => value.normalize("NFKC").trim().replace(/\s+/gu, " ").toLocaleLowerCase("pt-BR");

/** Returns only missing option pairs; persistence and activation remain explicit admin actions. */
export function generateMissingVariantOptions(
  colors: readonly string[],
  sizes: readonly string[],
  existing: readonly ProductVariantOption[],
  maxCombinations = 1000,
): ProductVariantOption[] {
  if (colors.length * sizes.length > maxCombinations) throw new RangeError("VARIANT_COMBINATION_LIMIT");
  const known = new Set(existing.flatMap(({ color, size }) =>
    color.trim() && size.trim() ? [`${identity(color)}\u0000${identity(size)}`] : [],
  ));
  const additions: ProductVariantOption[] = [];
  for (const color of colors) for (const size of sizes) {
    const key = `${identity(color)}\u0000${identity(size)}`;
    if (known.has(key)) continue;
    known.add(key);
    additions.push({ color, size });
  }
  return additions;
}
