export type PublicSiteMode = "store" | "coming-soon";
type Environment = Record<string, string | undefined>;

/** Pure server-side purchase policy shared with the pre-import attestation. */
export function resolvePublicSiteMode(env: Environment = process.env): PublicSiteMode {
  const configured = String(env.PUBLIC_SITE_MODE ?? "").trim().toLowerCase();
  if (configured === "store") return "store";
  if (configured === "coming-soon") return "coming-soon";
  return "coming-soon";
}

export function isPublicStoreOpen(env: Environment = process.env): boolean {
  return resolvePublicSiteMode(env) === "store";
}

/** Checkout remains closed unless explicitly enabled by the backend. */
export function isPublicCheckoutEnabled(env: Environment = process.env): boolean {
  if (!isPublicStoreOpen(env)) return false;
  return String(env.PUBLIC_CHECKOUT_ENABLED ?? "").trim().toLowerCase() === "true";
}
