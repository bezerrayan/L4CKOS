/**
 * Admin-facing freight summary for one order. Built ONLY from the immutable `checkout.shipping_accepted.v1` audit record
 * written in the order transaction. It is an explicit allow-list: tokens, quote references, provider quote ids, attempt ids,
 * the destination address and every other audit field are never copied, so nothing internal can leak to the admin payload.
 */
export type OrderShippingSummary = {
  method: "carrier" | "local_scheduled";
  carrier: string | null;
  serviceName: string;
  shippingPriceCents: number;
  package: { heightCm: number; widthCm: number; lengthCm: number; weightGrams: number } | null;
};

function text(value: unknown, max = 80): string | null {
  return typeof value === "string" && value.trim() ? value.trim().slice(0, max) : null;
}

function positive(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : null;
}

export function summarizeShippingAcceptance(metadata: unknown): OrderShippingSummary | null {
  let parsed: unknown = metadata;
  if (typeof metadata === "string") {
    try {
      parsed = JSON.parse(metadata);
    } catch {
      return null;
    }
  }
  const root = parsed && typeof parsed === "object" ? (parsed as { shipping?: unknown }) : null;
  const raw = root?.shipping && typeof root.shipping === "object" ? (root.shipping as Record<string, unknown>) : null;
  if (!raw) return null;
  const method = raw.method === "carrier" || raw.method === "local_scheduled" ? raw.method : null;
  const serviceName = text(raw.serviceName);
  const price = raw.shippingPriceCents;
  if (!method || !serviceName || typeof price !== "number" || !Number.isSafeInteger(price) || price < 0) return null;
  const pkg = raw.package && typeof raw.package === "object" ? (raw.package as Record<string, unknown>) : null;
  const height = positive(pkg?.heightCm);
  const width = positive(pkg?.widthCm);
  const length = positive(pkg?.lengthCm);
  const weight = positive(pkg?.weightGrams);
  return {
    method,
    carrier: text(raw.carrier),
    serviceName,
    shippingPriceCents: price,
    package: height && width && length && weight ? { heightCm: height, widthCm: width, lengthCm: length, weightGrams: weight } : null,
  };
}
