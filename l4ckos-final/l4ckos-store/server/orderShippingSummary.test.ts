import { describe, expect, it } from "vitest";
import { summarizeShippingAcceptance } from "../shared/orderShippingSummary";

const accepted = {
  attemptId: "attempt-secret-id-123456",
  merchandiseCents: 11900,
  shipping: {
    version: 1, method: "carrier", optionId: "melhor-envio-1", carrier: "Correios", serviceId: "1", serviceName: "PAC",
    quoteReference: "quote-ref-SECRET", providerQuoteId: "melhor-envio-1", currency: "BRL", shippingPriceCents: 2062,
    destinationZipCode: "01310100",
    address: { recipient: "Pessoa", zipCode: "01310100", street: "Rua X", number: "1", neighborhood: "Centro", city: "SP", state: "SP" },
    package: { heightCm: 6, widthCm: 22, lengthCm: 32, weightGrams: 300 }, itemCount: 1, merchandiseSubtotalCents: 11900,
    quoteToken: "bearer-token-SECRET",
  },
};

describe("summarizeShippingAcceptance", () => {
  it("returns only carrier, service, price, method and parcel", () => {
    const summary = summarizeShippingAcceptance(JSON.stringify(accepted));
    expect(summary).toEqual({ method: "carrier", carrier: "Correios", serviceName: "PAC", shippingPriceCents: 2062, package: { heightCm: 6, widthCm: 22, lengthCm: 32, weightGrams: 300 } });
    const serialized = JSON.stringify(summary);
    for (const leaked of ["SECRET", "attempt", "quoteReference", "providerQuoteId", "Rua X", "01310100", "Pessoa", "quoteToken", "optionId"]) expect(serialized).not.toContain(leaked);
  });

  it("accepts an already-parsed object and a local delivery without carrier or parcel", () => {
    const local = { shipping: { method: "local_scheduled", serviceName: "Entrega local", shippingPriceCents: 0 } };
    expect(summarizeShippingAcceptance(local)).toEqual({ method: "local_scheduled", carrier: null, serviceName: "Entrega local", shippingPriceCents: 0, package: null });
  });

  it("fails closed on malformed, incomplete or tampered records", () => {
    for (const bad of [null, undefined, "", "not-json", "[]", "{}", JSON.stringify({ shipping: null }),
      JSON.stringify({ shipping: { method: "drone", serviceName: "X", shippingPriceCents: 1 } }),
      JSON.stringify({ shipping: { method: "carrier", serviceName: "", shippingPriceCents: 1 } }),
      JSON.stringify({ shipping: { method: "carrier", serviceName: "PAC", shippingPriceCents: -1 } }),
      JSON.stringify({ shipping: { method: "carrier", serviceName: "PAC", shippingPriceCents: 1.5 } })]) {
      expect(summarizeShippingAcceptance(bad)).toBeNull();
    }
  });

  it("drops an invalid parcel but keeps the freight", () => {
    const s = summarizeShippingAcceptance({ shipping: { ...accepted.shipping, package: { heightCm: 6, widthCm: 0, lengthCm: 32, weightGrams: 300 } } });
    expect(s?.package).toBeNull();
    expect(s?.shippingPriceCents).toBe(2062);
  });
});
