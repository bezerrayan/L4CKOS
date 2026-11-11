const ALPHA_SCALE = ["XXS", "PP", "XS", "P", "S", "M", "G", "L", "GG", "XL", "XG", "XXG", "XXL", "EXG", "XXXL"];

function normalize(value: string) {
  return value.trim().toUpperCase();
}

/**
 * Presentation order for size labels derived from catalogue variants.
 * The API does not guarantee any order for variants (it follows an internal option key),
 * so the storefront must order them: the product's own configured order first, then the
 * usual alpha scale (PP, P, M, G, GG...), then numeric ascending, then the remaining labels
 * in their original relative order. Never drops or renames a label.
 */
export function sortSizeLabels(sizes: readonly string[], preferredOrder: readonly string[] = []): string[] {
  const preferred = new Map<string, number>();
  preferredOrder.forEach((label, index) => {
    const key = normalize(label);
    if (!preferred.has(key)) preferred.set(key, index);
  });
  const rank = (label: string): [number, number] => {
    const key = normalize(label);
    const configured = preferred.get(key);
    if (configured !== undefined) return [0, configured];
    const alpha = ALPHA_SCALE.indexOf(key);
    if (alpha >= 0) return [1, alpha];
    const numeric = Number(key.replace(",", "."));
    if (key !== "" && Number.isFinite(numeric)) return [2, numeric];
    return [3, 0];
  };
  return sizes
    .map((label, index) => ({ label, index, rank: rank(label) }))
    .sort((a, b) => a.rank[0] - b.rank[0] || a.rank[1] - b.rank[1] || a.index - b.index)
    .map(item => item.label);
}
