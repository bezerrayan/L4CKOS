import axios from "axios";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SHIPPING_PACKAGE, shippingPackageFor } from "../../shared/shippingPackage";
import { quoteShippingDetailed } from "../services/shippingService";
import { stockShippingCartFingerprint } from "./stockCheckout";
import { createStockShippingQuoteService } from "./stockShippingQuoteService";
import { verifyStockShippingQuoteV1 } from "./stockShippingQuoteV1";

const secret = "synthetic-shipping-signing-secret-at-least-32-bytes";
const address = { recipient: "Cliente Sintético", zipCode: "01001000", street: "Praça da Sé", number: "1", neighborhood: "Sé", city: "São Paulo", state: "SP" };

describe("approved shipping parcel (32 x 22 x 6 cm, 300 g per unit)", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it("has the owner-approved values", () => {
    expect(SHIPPING_PACKAGE).toEqual({ heightCm: 6, widthCm: 22, lengthCm: 32, gramsPerItem: 300 });
  });

  it.each([[1, 300], [2, 600], [3, 900], [0, 300]])("keeps the multi-unit rule: %i unit(s) -> %i g", (units, grams) => {
    expect(shippingPackageFor(units)).toEqual({ heightCm: 6, widthCm: 22, lengthCm: 32, weightGrams: grams });
  });

  it.each([1, 3])("sends the carrier the same parcel the STOCK quote signs (%i unit(s))", async units => {
    vi.stubEnv("MELHOR_ENVIO_TOKEN", "synthetic-test-token");
    const post = vi.spyOn(axios, "post").mockResolvedValue({ data: [{ id: 1, name: "SEDEX", price: "31.90", company: { name: "Correios" }, delivery_range: { min: 2, max: 4 } }] });

    const pool = { query: vi.fn().mockResolvedValue([[{ id: 8, productId: 3, price: 12900, isActive: 1 }]]) } as any;
    const service = createStockShippingQuoteService({ pool, secret });
    const result = await service.quote({ items: [{ productId: 3, variantId: 8, quantity: units }], address });

    // What the carrier was asked to quote.
    const sent = (post.mock.calls[0]![1] as { volumes: Array<Record<string, number>> }).volumes[0]!;
    expect(sent).toEqual({ height: 6, width: 22, length: 32, weight: Number((0.3 * units).toFixed(2)), insurance: 129 * units });

    // What the signed quote (and therefore the order snapshot) records.
    expect(result.options).toHaveLength(1);
    const option = result.options[0]!;
    const accepted = verifyStockShippingQuoteV1({
      secret, quoteToken: option.quoteToken, optionId: option.optionId, address,
      cartFingerprint: stockShippingCartFingerprint([{ variantId: 8, unitPriceCents: 12900, quantity: units }]),
      itemCount: units, merchandiseSubtotalCents: 12900 * units,
    });
    expect(accepted.package).toEqual({ heightCm: 6, widthCm: 22, lengthCm: 32, weightGrams: 300 * units });
    expect(Number(sent.weight) * 1000).toBe(accepted.package.weightGrams);
    expect(accepted.shippingPriceCents).toBe(option.priceCents);
    expect(option.priceCents).toBe(3190);
  });

  it("uses the same parcel in the conventional quote", async () => {
    vi.stubEnv("MELHOR_ENVIO_TOKEN", "synthetic-test-token");
    const post = vi.spyOn(axios, "post").mockResolvedValue({ data: [] });
    await quoteShippingDetailed({ cep: "01001000", itemCount: 2, subtotal: 258 });
    expect((post.mock.calls[0]![1] as { volumes: unknown }).volumes).toEqual([{ height: 6, width: 22, length: 32, weight: 0.6, insurance: 258 }]);
  });

  it("quotes from the configured commercial origin CEP, never from the request, and documents the placeholder default", async () => {
    vi.stubEnv("MELHOR_ENVIO_TOKEN", "synthetic-test-token");
    vi.stubEnv("MELHOR_ENVIO_FROM_POSTAL_CODE", "01310-100");
    const post = vi.spyOn(axios, "post").mockResolvedValue({ data: [] });
    await quoteShippingDetailed({ cep: "22041-001", itemCount: 1, subtotal: 129 });
    expect(post.mock.calls[0]![1]).toMatchObject({ from: { postal_code: "01310100" }, to: { postal_code: "22041001" } });
    vi.stubEnv("MELHOR_ENVIO_FROM_POSTAL_CODE", "");
    post.mockClear();
    await quoteShippingDetailed({ cep: "22041-001", itemCount: 1, subtotal: 129 });
    // The code falls back to a placeholder when the variable is missing: production must set it (see readiness checklist).
    expect(post.mock.calls[0]![1]).toMatchObject({ from: { postal_code: "70000000" } });
  });

  it("multi-shirt orders keep the 6 cm height and add only weight (physical validation of the stack height is pending)", () => {
    expect(shippingPackageFor(4)).toEqual({ heightCm: 6, widthCm: 22, lengthCm: 32, weightGrams: 1200 });
  });
});
