import { describe, expect, it } from "vitest";
import { buildShippingQuoteRequest, interpretShippingQuote, SHIPPING_NO_OPTIONS_MESSAGE } from "./shippingQuote";

const local = { id: "local-plano-piloto", label: "Entrega local - Plano Piloto", description: "d", price: 0, minDays: 1, maxDays: 2 };
const sedex = { id: "melhor-envio-1", label: "SEDEX", description: "Correios", price: 31.9, minDays: 2, maxDays: 4 };

describe("buildShippingQuoteRequest", () => {
  it("sends the cart subtotal in reais without dividing it again", () => {
    expect(buildShippingQuoteRequest("70.040-010", 2, 179.8)).toEqual({ cep: "70040010", itemCount: 2, subtotal: 179.8 });
  });
  it("rounds floating point noise", () => {
    expect(buildShippingQuoteRequest("70040010", 3, 0.1 + 0.2).subtotal).toBe(0.3);
  });
});

describe("interpretShippingQuote", () => {
  it("returns only backend options, preserving their prices", () => {
    const outcome = interpretShippingQuote({ options: [local, sedex], source: "mixed" });
    expect(outcome).toEqual({ kind: "options", options: [local, sedex], notice: "" });
  });

  it("never fabricates an option when the backend returns none", () => {
    for (const data of [{ options: [] }, {}, null, undefined, { options: "x" }]) {
      expect(interpretShippingQuote(data as never)).toEqual({ kind: "unavailable", error: SHIPPING_NO_OPTIONS_MESSAGE });
    }
  });

  it("drops malformed options (missing price, negative price, NaN)", () => {
    const bad = [{ ...sedex, price: undefined }, { ...sedex, price: -1 }, { ...sedex, price: Number.NaN }, { id: "", label: "", description: "", price: 1, minDays: 1, maxDays: 1 }];
    expect(interpretShippingQuote({ options: bad }).kind).toBe("unavailable");
    expect(interpretShippingQuote({ options: [...bad, sedex] })).toMatchObject({ kind: "options", options: [sedex] });
  });

  it("hides provider internals from customers but shows them to admins/dev", () => {
    const data = { options: [local], warning: "Falha parcial", providerError: "HTTP 401 | token" };
    expect(interpretShippingQuote(data)).toMatchObject({ notice: "Falha parcial" });
    expect(interpretShippingQuote(data, { showTechnicalDetails: true })).toMatchObject({ notice: "Falha parcial (HTTP 401; token)" });
  });

  it("rewrites the Melhor Envio no-quotes warning to a friendly message", () => {
    const outcome = interpretShippingQuote({ options: [local], warning: "Melhor Envio nao retornou cotacoes" });
    expect(outcome).toMatchObject({ notice: "No momento, há apenas entrega local disponível para este CEP." });
  });
});
