import axios from "axios";
import { afterEach, describe, expect, it, vi } from "vitest";
import { quoteShipping, quoteShippingDetailed } from "./shippingService";

describe("shipping local territory fallback", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it.each(["70000000", "73999999"])("allows approved CEP endpoint %s when Melhor Envio is not configured", async cep => {
    vi.stubEnv("MELHOR_ENVIO_TOKEN", "");
    const result = await quoteShippingDetailed({ cep, itemCount: 1, subtotal: 99 });
    expect(result.options.map(option => option.id)).toEqual(["local-plano-piloto"]);
  });

  it.each(["69999999", "74000000", "00000000"])("never offers local delivery outside approved range for %s", async cep => {
    vi.stubEnv("MELHOR_ENVIO_TOKEN", "");
    await expect(quoteShipping({ cep, itemCount: 1, subtotal: 99 })).resolves.toEqual([]);
    await expect(quoteShippingDetailed({ cep, itemCount: 1, subtotal: 99 })).resolves.toMatchObject({
      options: [],
      source: "unavailable",
    });
  });

  it("fails closed outside the approved territory when the shipping provider fails", async () => {
    vi.stubEnv("MELHOR_ENVIO_TOKEN", "synthetic-test-token");
    vi.spyOn(axios, "post").mockRejectedValue(new Error("synthetic provider outage"));
    const result = await quoteShippingDetailed({ cep: "01001000", itemCount: 1, subtotal: 99 });
    expect(result.options).toEqual([]);
    expect(result.source).toBe("unavailable");
  });

  it("uses the documented Melhor Envio volumes contract for both quote paths", async () => {
    vi.stubEnv("MELHOR_ENVIO_TOKEN", "synthetic-test-token");
    vi.stubEnv("MELHOR_ENVIO_API_URL", "https://sandbox.melhorenvio.com.br/api/v2/");
    vi.stubEnv("MELHOR_ENVIO_FROM_POSTAL_CODE", "44001-000");
    const post = vi.spyOn(axios, "post").mockResolvedValue({
      data: [{ id: 1, name: "PAC", price: "12.50", company: { name: "Correios" }, delivery_time: 2 }],
    } as any);

    const detailed = await quoteShippingDetailed({ cep: "01001-000", itemCount: 2, subtotal: 20 });
    const simple = await quoteShipping({ cep: "01001-000", itemCount: 2, subtotal: 20 });

    const expectedBody = {
      from: { postal_code: "44001000" },
      to: { postal_code: "01001000" },
      volumes: [{ height: 6, width: 22, length: 32, weight: 0.6, insurance: 20 }],
      options: { receipt: false, own_hand: false },
    };
    const expectedConfig = expect.objectContaining({
      headers: expect.objectContaining({
        Authorization: "Bearer synthetic-test-token",
        Accept: "application/json",
        "Content-Type": "application/json",
        "User-Agent": "L4CKOS/1.0 (contato@l4ckos.com.br)",
      }),
      timeout: 12000,
    });
    expect(post).toHaveBeenCalledTimes(2);
    expect(post).toHaveBeenNthCalledWith(1, "https://sandbox.melhorenvio.com.br/api/v2/me/shipment/calculate", expectedBody, expectedConfig);
    expect(post).toHaveBeenNthCalledWith(2, "https://sandbox.melhorenvio.com.br/api/v2/me/shipment/calculate", expectedBody, expectedConfig);
    expect(detailed).toMatchObject({ source: "melhor-envio", options: [{ id: "melhor-envio-1", price: 12.5 }] });
    expect(simple).toMatchObject([{ id: "melhor-envio-1", price: 12.5 }]);
  });
});
