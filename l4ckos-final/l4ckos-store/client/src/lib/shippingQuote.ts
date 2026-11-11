/**
 * Shipping quote helpers.
 *
 * Rule: the UI never invents a shipping option or price. Every option shown
 * must come from `/api/shipping/quote` (Melhor Envio + local-delivery rule,
 * both owned by the backend). On failure the customer sees an error and can
 * retry; checkout stays blocked until a real option is selected.
 */

export type ShippingOption = {
  id: string;
  label: string;
  description: string;
  /** Reais, as returned by the backend. */
  price: number;
  /** V6: transport windows are shown from the batch/transport estimate, so the backend may omit them. */
  minDays: number | null;
  maxDays: number | null;
};

export type ShippingQuoteResponse = {
  options?: unknown;
  warning?: string;
  providerError?: string;
  source?: "melhor-envio" | "fallback-local" | "mixed";
};

export function sanitizeCep(value: string): string {
  return value.replace(/\D/g, "").slice(0, 8);
}

/**
 * Body for `/api/shipping/quote`.
 * `cartTotalReais` is the cart subtotal in reais (CartItem prices are already
 * divided by 100); the server forwards it as the declared insurance value, so it
 * must NOT be divided again.
 */
export function buildShippingQuoteRequest(cep: string, itemCount: number, cartTotalReais: number) {
  return {
    cep: sanitizeCep(cep),
    itemCount,
    subtotal: Number(cartTotalReais.toFixed(2)),
  };
}

function isShippingOption(value: unknown): value is ShippingOption {
  if (typeof value !== "object" || value === null) return false;
  const option = value as Record<string, unknown>;
  return (
    typeof option.id === "string" && option.id.length > 0 &&
    typeof option.label === "string" &&
    typeof option.description === "string" &&
    typeof option.price === "number" && Number.isFinite(option.price) && option.price >= 0 &&
    (option.minDays === null || option.minDays === undefined || (typeof option.minDays === "number" && Number.isFinite(option.minDays))) &&
    (option.maxDays === null || option.maxDays === undefined || (typeof option.maxDays === "number" && Number.isFinite(option.maxDays)))
  );
}

export type ShippingQuoteOutcome =
  | { kind: "options"; options: ShippingOption[]; notice: string }
  | { kind: "unavailable"; error: string };

export const SHIPPING_UNAVAILABLE_MESSAGE =
  "Não foi possível consultar o frete agora. Verifique o CEP e tente novamente.";
export const SHIPPING_NO_OPTIONS_MESSAGE =
  "Ainda não entregamos neste CEP. Confira o CEP ou fale com o suporte.";

/** Turns a raw quote response into options the UI may show, or an error. Never fabricates options. */
export function interpretShippingQuote(
  data: ShippingQuoteResponse | null | undefined,
  opts: { showTechnicalDetails?: boolean } = {},
): ShippingQuoteOutcome {
  const raw = Array.isArray(data?.options) ? data!.options : [];
  const options = raw.filter(isShippingOption);
  if (options.length === 0) return { kind: "unavailable", error: SHIPPING_NO_OPTIONS_MESSAGE };

  const providerError = (data?.providerError ?? "").replace(/\s*\|\s*/g, "; ").replace(/\s+/g, " ").trim();
  let notice = "";
  if (data?.warning) {
    if (data.warning.includes("Melhor Envio nao retornou cotacoes")) {
      notice = "No momento, há apenas entrega local disponível para este CEP.";
    } else if (providerError && opts.showTechnicalDetails) {
      notice = `${data.warning} (${providerError})`;
    } else {
      notice = data.warning;
    }
  }
  return { kind: "options", options, notice };
}
