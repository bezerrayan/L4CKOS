const storefrontNumber = new Intl.NumberFormat("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/**
 * Minimalist price for storefront display ONLY (cards, catalogue, product page): Brazilian number format, always two decimals,
 * no currency prefix: 89,00 · 129,90 · 1.289,90. Cart, checkout, admin, e-mails and reports keep their own "R$" formatters.
 * Display-only: never feed the result back into calculations, rounding or payloads.
 */
export function formatStorefrontPrice(reais: number): string {
  return storefrontNumber.format(reais);
}
