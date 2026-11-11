import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  issueStockShippingQuoteV1,
  verifyStockShippingQuoteV1,
} from "./stockShippingQuoteV1";

const secret = "synthetic-shipping-signing-secret-at-least-32-bytes";
const now = new Date("2026-11-11T12:00:00.000Z");
const address = {
  recipient: "Cliente Sintético",
  zipCode: "70000000",
  street: "Rua de Teste",
  number: "123",
  complement: "Apto 4",
  neighborhood: "Asa Sul",
  city: "Brasília",
  state: "DF",
};
const cartFingerprint = createHash("sha256")
  .update("variant:12x1")
  .digest("hex");
const expected = {
  secret,
  address,
  cartFingerprint,
  itemCount: 1,
  merchandiseSubtotalCents: 12900,
  now,
};
const carrierTerms = {
  method: "carrier" as const,
  optionId: "carrier:jadlog:package:1",
  carrier: "Jadlog",
  serviceId: "package",
  serviceName: "Package",
  providerQuoteId: "quote-synthetic-41",
  shippingPriceCents: 2345,
  package: { heightCm: 6, widthCm: 18, lengthCm: 26, weightGrams: 300 },
};

function quote(terms = carrierTerms, overrides: Record<string, unknown> = {}) {
  return issueStockShippingQuoteV1({
    ...expected,
    terms,
    ...overrides,
  } as Parameters<typeof issueStockShippingQuoteV1>[0]);
}

describe("STOCK server-authorized shipping quote contract", () => {
  it("returns a complete persisted order snapshot from the server-signed carrier quote", () => {
    const issued = quote();
    const accepted = verifyStockShippingQuoteV1({
      ...expected,
      quoteToken: issued.quoteToken,
      optionId: carrierTerms.optionId,
    });
    expect(accepted).toMatchObject({
      method: "carrier",
      carrier: "Jadlog",
      serviceId: "package",
      serviceName: "Package",
      providerQuoteId: "quote-synthetic-41",
      shippingPriceCents: 2345,
      destinationZipCode: "70000000",
      itemCount: 1,
      merchandiseSubtotalCents: 12900,
      address: { street: "Rua de Teste", city: "Brasília", state: "DF" },
    });
  });

  it("rejects quote tampering, wrong service, cart, price basis, or address", () => {
    const issued = quote();
    const tampered = issued.quoteToken.replace(".", "x.");
    expect(() =>
      verifyStockShippingQuoteV1({
        ...expected,
        quoteToken: tampered,
        optionId: carrierTerms.optionId,
      })
    ).toThrow("SHIPPING_QUOTE_INVALID");
    expect(() =>
      verifyStockShippingQuoteV1({
        ...expected,
        quoteToken: issued.quoteToken,
        optionId: "carrier:other:service",
      })
    ).toThrow("SHIPPING_QUOTE_OPTION_MISMATCH");
    expect(() =>
      verifyStockShippingQuoteV1({
        ...expected,
        quoteToken: issued.quoteToken,
        optionId: carrierTerms.optionId,
        merchandiseSubtotalCents: 13000,
      })
    ).toThrow("SHIPPING_QUOTE_CART_MISMATCH");
    expect(() =>
      verifyStockShippingQuoteV1({
        ...expected,
        quoteToken: issued.quoteToken,
        optionId: carrierTerms.optionId,
        address: { ...address, number: "124" },
      })
    ).toThrow("SHIPPING_QUOTE_ADDRESS_MISMATCH");
  });

  it("expires server quotes and rejects signing keys shorter than 32 bytes", () => {
    const issued = quote();
    expect(() =>
      verifyStockShippingQuoteV1({
        ...expected,
        quoteToken: issued.quoteToken,
        optionId: carrierTerms.optionId,
        now: new Date(now.getTime() + 10 * 60_000),
      })
    ).toThrow("SHIPPING_QUOTE_EXPIRED");
    expect(() =>
      issueStockShippingQuoteV1({
        ...expected,
        secret: "short",
        terms: carrierTerms,
      })
    ).toThrow("SHIPPING_SIGNING_KEY_INVALID");
  });

  it("requires explicit address-level local-service approval rather than CEP-range inference", () => {
    const localTerms = {
      ...carrierTerms,
      method: "local_scheduled" as const,
      optionId: "local:scheduled",
      carrier: null,
      providerQuoteId: null,
      serviceId: "scheduled",
      serviceName: "Agendada",
      shippingPriceCents: 0,
    };
    expect(() => quote(localTerms)).toThrow(
      "LOCAL_ADDRESS_COVERAGE_UNVERIFIED"
    );
    const issued = quote(localTerms, { localAddressVerified: true });
    expect(
      verifyStockShippingQuoteV1({
        ...expected,
        quoteToken: issued.quoteToken,
        optionId: localTerms.optionId,
      }).method
    ).toBe("local_scheduled");
  });

  it("does not embed raw address or signing secret in the client-visible reference", () => {
    const issued = quote();
    expect(issued.quoteToken).not.toContain(secret);
    expect(issued.quoteToken).not.toContain(address.street);
    expect(issued.quoteToken).not.toContain(address.recipient);
    expect(issued.quoteReference).toMatch(/^[0-9a-f-]{36}$/);
  });
});
