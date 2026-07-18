/** Eventos de funil sem dados pessoais, prontos para um coletor consentido (ex.: GTM). */
export type StoreEventName =
  | "product_viewed"
  | "product_option_selected"
  | "cart_item_added"
  | "cart_item_removed"
  | "checkout_started"
  | "shipping_quoted"
  | "coupon_applied"
  | "payment_method_selected"
  | "payment_charge_created"
  | "payment_charge_failed";

type SafeEventData = Record<string, string | number | boolean | null | undefined>;

declare global {
  interface Window { dataLayer?: Array<Record<string, unknown>>; }
}

export function trackStoreEvent(name: StoreEventName, data: SafeEventData = {}) {
  if (typeof window === "undefined") return;

  const payload = {
    event: "l4ckos_store_event",
    event_name: name,
    ...data,
  };

  window.dispatchEvent(new CustomEvent("l4ckos:analytics", { detail: payload }));
  window.dataLayer?.push(payload);
  if (import.meta.env.DEV) console.info("[analytics]", payload);
}
