import { describe, expect, it } from "vitest";
import { toPublicShippingQuote } from "./shippingRoutes";
import { afterEach, vi } from "vitest";
import express from "express";
import { createServer, type Server } from "node:http";
import axios from "axios";
import shippingRoutes from "./shippingRoutes";

let server: Server | undefined;
afterEach(async () => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  if (server?.listening)
    await new Promise<void>(resolve => server!.close(() => resolve()));
  server = undefined;
});

async function requestQuote(body: Record<string, unknown>) {
  const app = express();
  app.use(express.json());
  app.use("/api/shipping", shippingRoutes);
  server = createServer(app);
  await new Promise<void>(resolve =>
    server!.listen(0, "127.0.0.1", () => resolve())
  );
  const address = server.address();
  if (!address || typeof address === "string")
    throw new Error("TEST_SERVER_ADDRESS_UNAVAILABLE");
  return fetch(`http://127.0.0.1:${address.port}/api/shipping/quote`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("public shipping quote response", () => {
  it("does not expose provider response details", () => {
    const result = toPublicShippingQuote({
      options: [],
      source: "unavailable",
      warning: "Cotação externa indisponível.",
      providerError:
        "token=private provider response includes customer payload",
    });
    expect(result).toEqual({
      options: [],
      source: "unavailable",
      warning: "Cotação externa indisponível.",
    });
    expect(JSON.stringify(result)).not.toContain("private");
  });

  it("filters invalid price options before returning a public quote", () => {
    const result = toPublicShippingQuote({
      options: [
        {
          id: "carrier-good",
          label: "Carrier",
          description: "Service",
          price: 14.5,
          minDays: 3,
          maxDays: 5,
        },
        {
          id: "carrier-negative",
          label: "Carrier",
          description: "Invalid",
          price: -4,
          minDays: 3,
          maxDays: 5,
        },
        {
          id: "",
          label: "Carrier",
          description: "Invalid",
          price: 2,
          minDays: 3,
          maxDays: 5,
        },
      ],
      source: "melhor-envio",
    });
    expect(result.options.map(option => option.id)).toEqual(["carrier-good"]);
  });

  it("rejects invalid public quote inputs before calling the carrier", async () => {
    const post = vi.spyOn(axios, "post");
    const response = await requestQuote({
      cep: "70000000",
      itemCount: -1,
      subtotal: -2,
    });
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: "Dados de frete inválidos",
    });
    expect(post).not.toHaveBeenCalled();
  });

  it("returns a generic outage and keeps upstream response content out of logs and response", async () => {
    vi.stubEnv("MELHOR_ENVIO_TOKEN", "synthetic-test-token");
    vi.spyOn(axios, "post").mockRejectedValue(
      new Error("synthetic-provider-body-secret")
    );
    const log = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const info = vi.spyOn(console, "info").mockImplementation(() => undefined);
    const response = await requestQuote({
      cep: "01001000",
      itemCount: 1,
      subtotal: 99,
    });
    const responseText = await response.text();
    expect(response.status).toBe(200);
    expect(responseText).not.toContain("synthetic-provider-body-secret");
    expect(responseText).toMatch(/indispon|Não foi possível/); // V6 service wording; the point is a generic outage message
    expect(JSON.stringify(log.mock.calls)).not.toContain(
      "synthetic-provider-body-secret"
    );
    expect(JSON.stringify(info.mock.calls)).not.toContain(
      "synthetic-provider-body-secret"
    );
  });
});
