import { describe, expect, it, vi } from "vitest";
import { stockAttemptResumeV1Schema, stockCheckoutResponseV1Schema, stockPixPaymentV1Schema } from "../../shared/stockCheckoutV1";
import { ASAAS_SANDBOX_API_URL, createSandboxAsaasStockPaymentProvider, toStockPixPayment } from "./asaasStockPaymentProvider";
import { resumeLatestStockCheckout, resumeStockCheckout, type StockAttemptResumeRecord, type StockCheckoutStore } from "./stockCheckout";
import { toStockCheckoutResponseV1 } from "./stockCheckoutHttpContract";

const sandbox = { STOCK_ASAAS_MODE: "sandbox", ASAAS_API_URL: ASAAS_SANDBOX_API_URL, ASAAS_API_KEY: "synthetic-sandbox-key-not-real" };
const PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
const PAYLOAD = "00020126580014br.gov.bcb.pix0136123e4567-e89b-12d3-a456-4266141740005204000053039865802BR5909L4CKOS LTDA6009SAO PAULO62070503***6304ABCD";
const PIX = { qrCodeBase64: PNG, copyPaste: PAYLOAD };

function record(overrides: Partial<StockAttemptResumeRecord> = {}): StockAttemptResumeRecord {
  return {
    attemptId: "stock-pix-inline-attempt-0001", orderId: "order-1", status: "reserved", providerState: "created",
    paymentId: "pay_synthetic_1", checkoutUrl: "https://www.asaas.com/i/synthetic", amountCents: 1000,
    reservationExpiresAt: new Date(Date.now() + 600_000).toISOString(), reservationExpired: false, reconciliationRequired: false,
    cartItems: [{ productId: 7, variantId: 31, quantity: 1 }], ...overrides,
  };
}

function store(row: StockAttemptResumeRecord): StockCheckoutStore {
  const transaction = vi.fn(async () => { throw new Error("resume must be read-only"); });
  return {
    transaction: transaction as unknown as StockCheckoutStore["transaction"],
    findAttemptForOwner: async (attemptId, owner) => (owner === 71 && attemptId === row.attemptId ? row : null),
    findLatestAttemptForOwner: async owner => (owner === 71 ? row : null),
  };
}

describe("STOCK inline PIX: resume by persisted paymentId", () => {
  it("returns QR + copy/paste for a pending charge, reading only by the stored payment id", async () => {
    const provider = { getPixPayment: vi.fn(async () => PIX) };
    const result = await resumeStockCheckout({ store: store(record()), authenticatedUserId: 71, attemptId: "stock-pix-inline-attempt-0001", provider });
    expect(result).toMatchObject({ status: "pending", paymentId: "pay_synthetic_1", checkoutUrl: "https://www.asaas.com/i/synthetic", pix: PIX });
    expect(provider.getPixPayment).toHaveBeenCalledTimes(1);
    expect(provider.getPixPayment).toHaveBeenCalledWith("pay_synthetic_1");
    expect(stockAttemptResumeV1Schema.parse(result).pix).toEqual(PIX);
  });

  it("works through resumeLatest too", async () => {
    const provider = { getPixPayment: vi.fn(async () => PIX) };
    await expect(resumeLatestStockCheckout({ store: store(record()), authenticatedUserId: 71, provider })).resolves.toMatchObject({ pix: PIX });
  });

  it("keeps the Asaas link and omits pix when the provider lookup fails or is empty", async () => {
    for (const getPixPayment of [vi.fn(async () => { throw new Error("asaas down"); }), vi.fn(async () => null)]) {
      const result = await resumeStockCheckout({ store: store(record()), authenticatedUserId: 71, attemptId: "stock-pix-inline-attempt-0001", provider: { getPixPayment } });
      expect(result.status).toBe("pending");
      expect(result.checkoutUrl).toBe("https://www.asaas.com/i/synthetic");
      expect(result).not.toHaveProperty("pix");
    }
  });

  it.each([
    ["no provider lookup is configured", record(), undefined],
    ["the attempt has no persisted paymentId", record({ paymentId: null, providerState: "not_started" }), { getPixPayment: vi.fn() }],
    ["the attempt is ambiguous", record({ providerState: "ambiguous" }), { getPixPayment: vi.fn() }],
    ["the reservation expired", record({ reservationExpired: true, reservationExpiresAt: new Date(Date.now() - 1000).toISOString() }), { getPixPayment: vi.fn() }],
    ["the attempt is paid", record({ status: "paid" }), { getPixPayment: vi.fn() }],
    ["the attempt is released", record({ status: "released" }), { getPixPayment: vi.fn() }],
  ])("never exposes or fetches PIX when %s", async (_name, row, provider) => {
    const result = await resumeStockCheckout({ store: store(row), authenticatedUserId: 71, attemptId: row.attemptId, provider });
    expect(result).not.toHaveProperty("pix");
    if (provider) expect(provider.getPixPayment).not.toHaveBeenCalled();
  });

  it("does not leak another owner's attempt", async () => {
    const provider = { getPixPayment: vi.fn(async () => PIX) };
    await expect(resumeStockCheckout({ store: store(record()), authenticatedUserId: 72, attemptId: "stock-pix-inline-attempt-0001", provider })).rejects.toMatchObject({ code: "CHECKOUT_ATTEMPT_NOT_FOUND" });
    expect(provider.getPixPayment).not.toHaveBeenCalled();
  });
});

describe("STOCK inline PIX: provider adapter", () => {
  const buyer = async () => ({ name: "Cliente Sintético", email: "buyer@example.invalid", cpfCnpj: "11111111111" });

  it("carries the PIX data returned by the charge adapter and strips a data: prefix", async () => {
    const createCharge = vi.fn(async () => ({ paymentId: "pay_1", checkoutUrl: "https://sandbox.asaas.com/i/1", pixQrCode: `data:image/png;base64,${PNG}`, pixCopyPaste: PAYLOAD }));
    const provider = createSandboxAsaasStockPaymentProvider({ environment: sandbox, loadBuyer: buyer, createCharge });
    await expect(provider.createPayment({ orderId: "12345", amountCents: 1000, idempotencyKey: "stock:12345" })).resolves.toMatchObject({ paymentId: "pay_1", pix: PIX });
  });

  it("still returns the paymentId without pix when the QR lookup produced nothing", async () => {
    const createCharge = vi.fn(async () => ({ paymentId: "pay_1", checkoutUrl: null, pixQrCode: null, pixCopyPaste: null }));
    const provider = createSandboxAsaasStockPaymentProvider({ environment: sandbox, loadBuyer: buyer, createCharge });
    const created = await provider.createPayment({ orderId: "12345", amountCents: 1000, idempotencyKey: "stock:12345" });
    expect(created).toMatchObject({ paymentId: "pay_1", checkoutUrl: null });
    expect(created).not.toHaveProperty("pix");
  });

  it("getPixPayment is read-only, never calls createCharge, and swallows provider errors", async () => {
    const createCharge = vi.fn();
    const getPixQrCode = vi.fn(async () => ({ qrCodeBase64: PNG, copyPaste: PAYLOAD }));
    const provider = createSandboxAsaasStockPaymentProvider({ environment: sandbox, loadBuyer: buyer, createCharge, getPixQrCode });
    await expect(provider.getPixPayment!("pay_1")).resolves.toEqual(PIX);
    expect(getPixQrCode).toHaveBeenCalledWith("pay_1", expect.any(AbortSignal));
    getPixQrCode.mockRejectedValueOnce(new Error("boom"));
    await expect(provider.getPixPayment!("pay_1")).resolves.toBeNull();
    expect(createCharge).not.toHaveBeenCalled();
  });

  it("getPixPayment resolves null when no lookup is wired", async () => {
    const provider = createSandboxAsaasStockPaymentProvider({ environment: sandbox, loadBuyer: buyer, createCharge: vi.fn() });
    await expect(provider.getPixPayment!("pay_1")).resolves.toBeNull();
  });
});

describe("STOCK inline PIX: wire contract", () => {
  it("rejects malformed PIX payloads and keeps a valid half", () => {
    expect(stockPixPaymentV1Schema.safeParse({}).success).toBe(false);
    expect(stockPixPaymentV1Schema.safeParse({ qrCodeBase64: "<script>" }).success).toBe(false);
    expect(stockPixPaymentV1Schema.safeParse({ copyPaste: "has\ncontrol char payload" }).success).toBe(false);
    expect(stockPixPaymentV1Schema.safeParse({ copyPaste: PAYLOAD }).success).toBe(true); // real payloads carry spaces (merchant name)
    expect(stockPixPaymentV1Schema.safeParse({ copyPaste: PAYLOAD, extra: 1 }).success).toBe(false);
    expect(toStockPixPayment("<script>", PAYLOAD)).toEqual({ copyPaste: PAYLOAD });
    expect(toStockPixPayment(PNG, "bad\npayload!!")).toEqual({ qrCodeBase64: PNG });
    expect(toStockPixPayment(null, null)).toBeUndefined();
  });

  it("old responses without pix still parse, and a malformed pix on resume never breaks the attempt", () => {
    const resume = { attemptId: "attempt-0123456789abcdef", status: "pending", orderId: "o1", paymentId: "pay_1", checkoutUrl: "https://www.asaas.com/i/1", amountCents: 1000, reservationExpiresAt: new Date().toISOString(), canStartNewAttempt: false };
    expect(stockAttemptResumeV1Schema.parse(resume)).not.toHaveProperty("pix");
    expect(stockAttemptResumeV1Schema.parse({ ...resume, pix: { qrCodeBase64: "<script>" } })).toMatchObject({ status: "pending", paymentId: "pay_1" });
    expect(stockAttemptResumeV1Schema.parse({ ...resume, pix: { qrCodeBase64: "<script>" } }).pix).toBeUndefined();
    expect(stockAttemptResumeV1Schema.parse({ ...resume, pix: PIX }).pix).toEqual(PIX);
    const created = { attemptId: "a", orderId: "o1", status: "pending", paymentId: "pay_1", amountCents: 1000, replayed: false };
    expect(stockCheckoutResponseV1Schema.parse(created)).not.toHaveProperty("pix");
  });

  it("create response carries pix only when present and remains valid without it", () => {
    const base = { orderId: "o1", paymentId: "pay_1", checkoutUrl: "https://www.asaas.com/i/1", amountCents: 1000, replayed: false };
    expect(stockCheckoutResponseV1Schema.parse(toStockCheckoutResponseV1("attempt-0123456789abcdef", { ...base, pix: PIX })).pix).toEqual(PIX);
    expect(toStockCheckoutResponseV1("attempt-0123456789abcdef", base)).not.toHaveProperty("pix");
  });
});
