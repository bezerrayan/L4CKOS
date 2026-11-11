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
});
