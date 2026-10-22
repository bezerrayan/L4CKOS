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
