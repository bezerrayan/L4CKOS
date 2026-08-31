import { createHash } from "node:crypto";

export type CheckoutFingerprintInput = {
  userId: number;
  method: string;
  items: Array<{ productId: number; variantId?: number | null; quantity: number }>;
  shipping: { cep: string; optionId: string };
  shippingAddress: Record<string, string | undefined>;
  couponCode?: string;
};

export function normalizeOptionValue(value?: string | null) {
  const normalized = String(value ?? "").trim().toLocaleLowerCase("pt-BR");
  return normalized || null;
}

export function buildVariantOptionKey(size?: string | null, color?: string | null) {
  const normalizedSize = normalizeOptionValue(size) ?? "";
  const normalizedColor = normalizeOptionValue(color) ?? "";
  return `size:${normalizedSize}|color:${normalizedColor}`;
}

export function buildCheckoutFingerprint(input: CheckoutFingerprintInput) {
  const canonical = {
    userId: input.userId,
    method: input.method,
    items: [...input.items]
      .map(item => ({
        productId: item.productId,
        variantId: item.variantId ?? null,
        quantity: item.quantity,
      }))
      .sort((a, b) => a.productId - b.productId || Number(a.variantId ?? 0) - Number(b.variantId ?? 0)),
    shipping: input.shipping,
    shippingAddress: Object.fromEntries(
      Object.entries(input.shippingAddress).map(([key, value]) => [key, String(value ?? "").trim()]),
    ),
    couponCode: String(input.couponCode ?? "").trim().toUpperCase(),
  };

  return createHash("sha256").update(JSON.stringify(canonical)).digest("hex");
}

export function deterministicWebhookEventId(payload: unknown) {
  return `legacy:${createHash("sha256").update(JSON.stringify(payload)).digest("hex")}`;
}

export function sanitizeWebhookPayload(payload: unknown) {
  const source = payload && typeof payload === "object" ? (payload as Record<string, unknown>) : {};
  const payment = source.payment && typeof source.payment === "object"
    ? (source.payment as Record<string, unknown>)
    : {};

  return JSON.stringify({
    id: source.id ?? null,
    event: source.event ?? null,
    dateCreated: source.dateCreated ?? null,
    payment: {
      id: payment.id ?? null,
      externalReference: payment.externalReference ?? null,
      status: payment.status ?? null,
      value: payment.value ?? null,
      billingType: payment.billingType ?? null,
      confirmedDate: payment.confirmedDate ?? null,
      paymentDate: payment.paymentDate ?? null,
    },
  });
}

export function hasValidStockReservation(
  expectedItemCount: number,
  reservations: Array<{ status: string; expiresAt: Date }>,
  now: Date,
) {
  return expectedItemCount > 0 &&
    reservations.length === expectedItemCount &&
    reservations.every(reservation => reservation.status === "active" && reservation.expiresAt > now);
}
