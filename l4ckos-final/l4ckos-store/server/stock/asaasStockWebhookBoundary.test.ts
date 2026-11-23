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
      referenceKind: "legacy",
    });
  });

  it("does not infer BRL from the official webhook shape when payment.currency is absent", () => {
    const official = {
      id: "evt_05b708f961d739ea7eba7e4db318f621&368604920",
      event: "PAYMENT_RECEIVED",
      dateCreated: "2024-06-12 16:45:03",
      account: { id: "47ed0d25-f9fb-4b35-b23a-d8895caf92b7", ownerId: null },
      payment: {
        object: "payment", id: "pay_080225913252", dateCreated: "2021-01-01",
        customer: "cus_G7Dvo4iphUNk", value: 100, netValue: 94.51,
        externalReference: "L4CKOS-STOCK-ATTEMPT:v1:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
        billingType: "CREDIT_CARD", status: "RECEIVED", extraProviderField: "ignored",
      },
    };
    expect(() => createAsaasStockWebhookBoundary().decodeSignedEvent(JSON.stringify(official)))
      .toThrow("WEBHOOK_CURRENCY_MISMATCH");
    expect(createAsaasStockWebhookBoundary({ verifiedProviderCurrency: "BRL" })
      .decodeSignedEvent(JSON.stringify(official))).toMatchObject({
        eventId: official.id, paymentId: "pay_080225913252", amountCents: 10000,
        strongReference: official.payment.externalReference,
      });
    expect(() => createAsaasStockWebhookBoundary({ verifiedProviderCurrency: "USD" })
      .decodeSignedEvent(JSON.stringify(official))).toThrow("WEBHOOK_CURRENCY_MISMATCH");
  });

  it.each(["PAYMENT_CONFIRMED", "PAYMENT_OVERDUE_RECEIVED"])("does not settle PIX from %s alone", eventName => {
    const observation = { ...event, event: eventName, payment: { ...event.payment, status: "CONFIRMED" } };
    expect(createAsaasStockWebhookBoundary().decodeSignedEvent(JSON.stringify(observation))).toMatchObject({ status: "pending" });
  });

  it.each(["PAYMENT_CONFIRMED", "PAYMENT_OVERDUE_RECEIVED"])("accepts currencyless %s as a non-settling observation", eventName => {
    const observation: any = { ...event, event: eventName, payment: { ...event.payment, status: "CONFIRMED" } };
    delete observation.payment.currency;
    expect(createAsaasStockWebhookBoundary().decodeSignedEvent(JSON.stringify(observation))).toMatchObject({ status: "pending" });
    observation.payment.currency = "USD";
    expect(() => createAsaasStockWebhookBoundary().decodeSignedEvent(JSON.stringify(observation)))
      .toThrow("WEBHOOK_CURRENCY_MISMATCH");
  });

  it("accepts currencyless PAYMENT_CREATED only against the configured BRL account and keeps it non-settling", () => {
    const created = {
      id: "evt_created_synthetic_001",
      event: "PAYMENT_CREATED",
      account: { id: "account-pinned-synthetic" },
      payment: {
        id: "pay-created-synthetic-001",
        externalReference: "L4CKOS-STOCK-ATTEMPT:v1:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
        value: 10,
        billingType: "PIX",
        status: "PENDING",
      },
    };
    const verified = createAsaasStockWebhookBoundary({
      configuredAccountId: "account-pinned-synthetic",
      configuredAccountCurrency: "BRL",
    }).decodeSignedEvent(JSON.stringify(created));
    expect(verified).toMatchObject({
      eventId: created.id,
      paymentId: created.payment.id,
      status: "pending",
      amountCents: 1000,
      strongReference: created.payment.externalReference,
    });
    expect(() => createAsaasStockWebhookBoundary({
      configuredAccountId: "another-account-synthetic",
      configuredAccountCurrency: "BRL",
    }).decodeSignedEvent(JSON.stringify(created))).toThrow("WEBHOOK_CURRENCY_MISMATCH");
    expect(() => createAsaasStockWebhookBoundary({
      configuredAccountId: "account-pinned-synthetic",
      configuredAccountCurrency: "USD",
    }).decodeSignedEvent(JSON.stringify(created))).toThrow("WEBHOOK_CURRENCY_MISMATCH");
    expect(() => createAsaasStockWebhookBoundary({
      configuredAccountId: "account-pinned-synthetic",
      configuredAccountCurrency: "BRL",
    }).decodeSignedEvent(JSON.stringify({
      ...created,
      payment: { ...created.payment, currency: "USD" },
    }))).toThrow("WEBHOOK_CURRENCY_MISMATCH");
  });

  it.each([
    ["PAYMENT_REFUSED", "REFUSED"],
    ["PAYMENT_DELETED", "DELETED"],
    ["PAYMENT_REPROVED", "REPROVED"],
    ["PAYMENT_FAILED", "FAILED"],
  ])("recognizes only the explicit terminal provider event %s as a releasable failure", (eventName, status) => {
    const boundary = createAsaasStockWebhookBoundary();
    const terminal = { ...event, event: eventName, payment: { ...event.payment, status } };
    expect(boundary.decodeSignedEvent(JSON.stringify(terminal))).toMatchObject({ status: "failed" });
  });

  it.each([
    ["PAYMENT_REFUSED", "PENDING"],
    ["PAYMENT_DELETED", "AWAITING_PAYMENT"],
    ["PAYMENT_REFUNDED", "REFUNDED"],
    ["PAYMENT_OVERDUE", "OVERDUE"],
    ["PAYMENT_REFUSED", ""],
  ])("does not treat transient, refund or unrelated event %s as terminal failure", (eventName, status) => {
    const boundary = createAsaasStockWebhookBoundary();
    const nonTerminal = { ...event, event: eventName, payment: { ...event.payment, status } };
    expect(() => boundary.decodeSignedEvent(JSON.stringify(nonTerminal))).toThrow("WEBHOOK_EVENT_UNSUPPORTED_OR_CONFLICTING");
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
