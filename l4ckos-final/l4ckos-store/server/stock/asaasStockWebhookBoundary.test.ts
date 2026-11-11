import { afterEach, describe, expect, it, vi } from "vitest";
import { createAsaasStockWebhookBoundary } from "./asaasStockWebhookBoundary";

const event = {
  id: "evt_synthetic_001",
  event: "PAYMENT_RECEIVED",
  payment: {
    id: "pay_synthetic_001",
    externalReference: "stock-order-synthetic-001",
    value: 129.9,
    currency: "BRL",
    status: "RECEIVED",
  },
};

afterEach(() => vi.unstubAllEnvs());

describe("Asaas STOCK webhook boundary", () => {
  it("uses the backend token verifier and rejects an invalid token", async () => {
    vi.stubEnv("ASAAS_WEBHOOK_TOKEN", "synthetic-token-only");
    const boundary = createAsaasStockWebhookBoundary();
    await expect(boundary.verifySignature({ rawBody: JSON.stringify(event), headers: { "Asaas-Access-Token": "synthetic-token-only" } })).resolves.toBe(true);
    await expect(boundary.verifySignature({ rawBody: JSON.stringify(event), headers: { "asaas-access-token": "wrong-synthetic-token" } })).resolves.toBe(false);
  });

  it("fails closed when no configured token exists, including development mode", async () => {
    vi.stubEnv("ASAAS_WEBHOOK_TOKEN", "");
    vi.stubEnv("NODE_ENV", "development");
    const boundary = createAsaasStockWebhookBoundary();
    await expect(boundary.verifySignature({ rawBody: JSON.stringify(event), headers: { "asaas-access-token": "anything" } })).resolves.toBe(false);
  });

  it("normalizes a signed synthetic Asaas payment without provider IO", () => {
    const boundary = createAsaasStockWebhookBoundary();
    expect(boundary.decodeSignedEvent(JSON.stringify(event))).toEqual({
      eventId: "evt_synthetic_001",
      orderId: "stock-order-synthetic-001",
      paymentId: "pay_synthetic_001",
      status: "paid",
      amountCents: 12990,
      payload: event,
    });
  });

  it.each([
    [{ ...event, event: "PAYMENT_RECEIVED", payment: { ...event.payment, status: "PENDING" } }, "WEBHOOK_EVENT_UNSUPPORTED_OR_CONFLICTING"],
    [{ ...event, payment: { ...event.payment, externalReference: undefined } }, "WEBHOOK_ORDER_REFERENCE_REQUIRED"],
    [{ ...event, payment: { ...event.payment, value: 129.901 } }, "WEBHOOK_AMOUNT_INVALID"],
    [{ ...event, payment: { ...event.payment, currency: "USD" } }, "WEBHOOK_CURRENCY_MISMATCH"],
    [{ ...event, id: undefined }, "WEBHOOK_EVENT_ID_REQUIRED"],
  ])("rejects malformed or contradictory signed fixture", (payload, code) => {
    const boundary = createAsaasStockWebhookBoundary();
    expect(() => boundary.decodeSignedEvent(JSON.stringify(payload))).toThrow(code);
  });
});
