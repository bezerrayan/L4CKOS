function compactIdentity(value: string | null | undefined) {
  return String(value ?? "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

/** Partnership products remain closed until a server-side authorization contract exists. */
export function isRestrictedPublicPurchase(
  name: string | null | undefined,
  skuOrSkus?: string | null | readonly (string | null | undefined)[],
  partnershipExclusive = false,
) {
  if (partnershipExclusive === true) return true;
  const normalizedName = compactIdentity(name);
  if (["claxivbis", "clanxivbis", "cla14bis", "clan14bis", "xivbis", "14bis"].some(marker => normalizedName.includes(marker))) return true;
  const skus = typeof skuOrSkus === "string" || skuOrSkus == null ? [skuOrSkus] : skuOrSkus;
  return skus.some(sku => {
    const identity = compactIdentity(sku);
    return /^14b/.test(identity) || ["claxivbis", "clanxivbis", "cla14bis", "clan14bis", "xivbis", "14bis"].some(marker => identity.includes(marker));
  });
}

/** A QA label is an explicit classification; malformed or missing SKUs must not unhide it. */
export function isStagingQaCatalogProduct(
  name: string | null | undefined,
  _variants?: Array<{ sku?: string | null }> | null,
) {
  return /^\s*\[QA-STAGING\](?:\s|$)/iu.test(String(name ?? ""));
}

/** Single fail-closed policy for public reads, cart entry, availability and checkout. */
export function isPublicProductUnavailable(
  name: string | null | undefined,
  variants?: Array<{ sku?: string | null }> | null,
) {
  return isStagingQaCatalogProduct(name) || isRestrictedPublicPurchase(name, variants?.map(variant => variant.sku));
}
