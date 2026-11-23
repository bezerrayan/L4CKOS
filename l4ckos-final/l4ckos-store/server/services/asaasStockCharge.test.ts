import { afterEach, describe, expect, it, vi } from "vitest";
import { createAsaasStockChargeForOrder } from "./asaas";

const sandboxUrl = "https://api-sandbox.asaas.com/v3";
const input = {
  orderId: 420001,
  method: "PIX" as const,
  value: 10,
  customer: { name: "Cliente sintético", cpfCnpj: "11144477735", email: "buyer@example.invalid" },
  description: "Synthetic STOCK test",
  externalReference: `L4CKOS-STOCK-ATTEMPT:v1:${"A".repeat(32)}`,
};

function configureSandbox() {
  vi.stubEnv("NODE_ENV", "development");
  vi.stubEnv("APP_ENV", "");
  vi.stubEnv("EMAIL_ENV", "");
  vi.stubEnv("RAILWAY_PROJECT_ID", "");
  vi.stubEnv("RAILWAY_ENVIRONMENT_ID", "");
  vi.stubEnv("RAILWAY_SERVICE_ID", "");
  vi.stubEnv("ASAAS_ENV", "sandbox");
  vi.stubEnv("ASAAS_API_URL", sandboxUrl);
  vi.stubEnv("ASAAS_API_KEY", "$aact_hmlg_synthetic-key");
  vi.stubEnv("ASAAS_SANDBOX_API_KEY", "");
  vi.stubEnv("ASAAS_CHECKOUT_BASE_URL", "");
}

function response(status: number, body: unknown): Response {
  return { ok: status >= 200 && status < 300, status, json: async () => body } as Response;
}

function customerResponse() {
  return response(200, { id: "cus_synthetic", notificationDisabled: true });
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("STOCK Asaas financial boundary classification", () => {
  it("classifies buyer document validation before any request as definitely not created", async () => {
    configureSandbox();
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    await expect(createAsaasStockChargeForOrder({ ...input, customer: { ...input.customer, cpfCnpj: "11111111111" } }))
      .rejects.toMatchObject({ name: "AsaasRequestFailure", phase: "preflight", category: "invalid_request", definitelyNotCreated: true });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("classifies a customer verification failure as pre-payment and never reaches /payments", async () => {
    configureSandbox();
    const fetch = vi.fn().mockResolvedValueOnce(customerResponse()).mockResolvedValueOnce(response(500, { message: "Synthetic" }));
    vi.stubGlobal("fetch", fetch);
    await expect(createAsaasStockChargeForOrder(input)).rejects.toMatchObject({
      phase: "customer_verify", category: "unknown", definitelyNotCreated: true, httpStatus: 500,
    });
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(fetch.mock.calls.some(call => String(call[0]).endsWith("/payments"))).toBe(false);
  });

  it("treats only a structured documented HTTP 400 validation response as a definitive payment rejection", async () => {
    configureSandbox();
    const fetch = vi.fn()
      .mockResolvedValueOnce(customerResponse())
      .mockResolvedValueOnce(customerResponse())
      .mockResolvedValueOnce(response(400, { errors: [{ code: "invalid_value", description: "Synthetic validation rejection" }] }));
    vi.stubGlobal("fetch", fetch);
    await expect(createAsaasStockChargeForOrder(input)).rejects.toMatchObject({
      phase: "payment_create", category: "provider_rejection", definitelyNotCreated: true, httpStatus: 400,
    });
    expect(fetch).toHaveBeenCalledTimes(3);
    expect(fetch.mock.calls[2][0]).toBe(`${sandboxUrl}/payments`);
  });

  it.each([
    [403, { errors: [{ code: "not_authorized", description: "Synthetic" }] }],
    [400, { message: "Synthetic malformed validation body" }],
    [429, { errors: [{ code: "rate_limited", description: "Synthetic" }] }],
    [500, { errors: [{ code: "internal", description: "Synthetic" }] }],
  ])("keeps HTTP %s or malformed payment responses uncertain", async (status, body) => {
    configureSandbox();
    const fetch = vi.fn()
      .mockResolvedValueOnce(customerResponse())
      .mockResolvedValueOnce(customerResponse())
      .mockResolvedValueOnce(response(status, body));
    vi.stubGlobal("fetch", fetch);
    await expect(createAsaasStockChargeForOrder(input)).rejects.toMatchObject({
      phase: "payment_create", definitelyNotCreated: false, httpStatus: status,
    });
  });

  it("treats a lost response during POST /payments as uncertain and does not retry", async () => {
    configureSandbox();
    const fetch = vi.fn()
      .mockResolvedValueOnce(customerResponse())
      .mockResolvedValueOnce(customerResponse())
      .mockRejectedValueOnce(new Error("synthetic network timeout"));
    vi.stubGlobal("fetch", fetch);
    await expect(createAsaasStockChargeForOrder(input)).rejects.toMatchObject({
      phase: "payment_create", category: "network", definitelyNotCreated: false,
    });
    expect(fetch).toHaveBeenCalledTimes(3);
  });

  it("treats a successful but unusable payment response as uncertain", async () => {
    configureSandbox();
    const fetch = vi.fn()
      .mockResolvedValueOnce(customerResponse())
      .mockResolvedValueOnce(customerResponse())
      .mockResolvedValueOnce(response(200, { invoiceUrl: "https://sandbox.asaas.com/i/no-id" }));
    vi.stubGlobal("fetch", fetch);
    await expect(createAsaasStockChargeForOrder(input)).rejects.toMatchObject({
      phase: "payment_create", category: "invalid_response", definitelyNotCreated: false,
    });
    expect(fetch).toHaveBeenCalledTimes(3);
  });

  it("preserves a successful payment ID when the PIX QR lookup fails, with safe logs and no second POST", async () => {
    configureSandbox();
    const fetch = vi.fn()
      .mockResolvedValueOnce(customerResponse())
      .mockResolvedValueOnce(customerResponse())
      .mockResolvedValueOnce(response(200, { id: "pay_synthetic", invoiceUrl: "https://sandbox.asaas.com/i/synthetic" }))
      .mockResolvedValueOnce(response(500, { message: "Sensitive provider detail" }));
    vi.stubGlobal("fetch", fetch);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    await expect(createAsaasStockChargeForOrder(input)).resolves.toMatchObject({
      paymentId: "pay_synthetic", invoiceUrl: "https://sandbox.asaas.com/i/synthetic", pixQrCode: null, pixCopyPaste: null,
    });
    expect(fetch.mock.calls.filter(call => String(call[0]).endsWith("/payments"))).toHaveLength(1);
    expect(warn).toHaveBeenCalledWith("[AsaasStock] request_failed", { phase: "pix_qr_lookup", category: "unknown", httpStatus: 500 });
    expect(JSON.stringify(warn.mock.calls)).not.toContain("Sensitive provider detail");
    expect(JSON.stringify(warn.mock.calls)).not.toContain(input.customer.cpfCnpj);
    expect(JSON.stringify(warn.mock.calls)).not.toContain("externalReference");
  });
});
