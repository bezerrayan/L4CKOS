/**
 * Build-time availability of NEW hosted-card purchases in the storefront.
 *
 * The backend remains the authority (STOCK_CARD_CHECKOUT_ENABLED rejects a closed card with CARD_CHECKOUT_DISABLED);
 * this switch only keeps the card option out of a production artifact until it is deliberately enabled, mirroring the
 * fail-closed `siteMode` rule: a production build needs an explicit `VITE_CARD_CHECKOUT_ENABLED=true`.
 */
export function resolveCardCheckoutEnabled(env: {
  VITE_CARD_CHECKOUT_ENABLED?: unknown;
  VITE_DEPLOY_TARGET?: unknown;
}): boolean {
  const explicit = String(env.VITE_CARD_CHECKOUT_ENABLED ?? "").trim().toLowerCase();
  if (explicit === "true") return true;
  if (explicit === "false") return false;
  // Staging and local builds stay usable so the flow can be rehearsed; production never opens by omission.
  return String(env.VITE_DEPLOY_TARGET ?? "").trim().toLowerCase() !== "production";
}

export const cardCheckoutEnabled: boolean = resolveCardCheckoutEnabled({
  VITE_CARD_CHECKOUT_ENABLED: import.meta.env.VITE_CARD_CHECKOUT_ENABLED,
  VITE_DEPLOY_TARGET: import.meta.env.VITE_DEPLOY_TARGET,
});
