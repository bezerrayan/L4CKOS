function compactIdentity(value: string | null | undefined) {
  return String(value ?? "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

/** The Clã 14 Bis collaboration remains closed until a server-side authorization contract exists. */
export function isRestrictedPublicPurchase(name: string | null | undefined, sku?: string | null) {
  const normalizedName = compactIdentity(name);
  return normalizedName.includes("cla14bis") || normalizedName.includes("clan14bis") || /^14b/.test(compactIdentity(sku));
}

/**
 * QA catalog fixtures are kept in the admin catalog but must not be discoverable
 * from public product endpoints. Require both the staging QA label and QA-marked
 * SKUs for every variant; a product name prefix alone is not a visibility rule.
 */
export function isStagingQaCatalogProduct(
  name: string | null | undefined,
  variants: Array<{ sku?: string | null }> | null | undefined,
) {
  if (!/^\s*\[QA-STAGING\](?:\s|$)/iu.test(String(name ?? ""))) return false;
  if (!variants?.length) return false;
  return variants.every(variant => /^QA-[A-Z0-9]+(?:-[A-Z0-9]+)*$/iu.test(String(variant.sku ?? "").trim()));
}
