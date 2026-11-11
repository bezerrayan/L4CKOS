import { describe, expect, it, vi } from "vitest";
import { createUserAttemptStorage } from "./attemptStorage";
import { createStockCheckoutClient, listOpenStockAttempts, type StockCartLine } from "./stockCheckoutClient";

const LINES: StockCartLine[] = [{ productId: 1, variantId: 11, quantity: 1, variants: [{ id: 11, productId: 1, size: "M", color: "Preto", active: true }] }];
const DELIVERY = { optionId: "local-plano-piloto" as const, address: { recipient: "Maria", zipCode: "70040010", street: "SQS 308", number: "10", neighborhood: "Asa Sul", city: "Brasília", state: "DF" } };
const idSeq = () => { let n = 0; return () => `attempt-${String(++n).padStart(16, "0")}`; };
const appError = (code: string, trpc = "CONFLICT") => Object.assign(new Error("texto qualquer"), { data: { code: trpc, appError: { code } } });
const attemptBody = (over: Record<string, unknown> = {}) => ({
  attemptId: "attempt-0000000000000009", orderId: "9", status: "pending", amountCents: 9990,
  reservationExpiresAt: "2026-12-01T12:00:00.000Z", canStartNewAttempt: false, ...over,
});
const memory = () => {
  const data = new Map<string, string>();
  return { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => void data.set(k, v) };
};
const created = (attemptId: string) => ({ attemptId, orderId: "9", status: "pending", amountCents: 9990, replayed: false });

function client(transport: Partial<Parameters<typeof createStockCheckoutClient>[0]["transport"]>, storage = memory()) {
  return {
    storage,
    api: createStockCheckoutClient({
      enabled: true,
      storage,
      createId: idSeq(),
      transport: { create: vi.fn(), resume: vi.fn(), ...transport },
    }),
  };
}

describe("resumeLatest fallback (browser lost its attempt ID)", () => {
  it("returns an attempt that is still in flight so a second charge is not started", async () => {
    const { api } = client({ resumeLatest: async () => attemptBody({ status: "pending" }) });
    expect((await api.resume(LINES)).status).toBe("pending");
  });

  it.each(["paid", "failed", "expired", "cancelled"])("never surfaces a %s attempt from an older purchase as the current one", async status => {
    const { api } = client({ resumeLatest: async () => attemptBody({ status, canStartNewAttempt: true }) });
    await expect(api.resume(LINES)).rejects.toThrow("STOCK_ATTEMPT_NOT_FOUND_ON_SERVER");
  });

  it("treats 'no attempt' (null) as not found", async () => {
    const { api } = client({ resumeLatest: async () => null });
    await expect(api.resume(LINES)).rejects.toThrow("STOCK_ATTEMPT_NOT_FOUND_ON_SERVER");
  });

  it("a network failure is NOT 'not found': it surfaces as an unknown outcome", async () => {
    const { api } = client({ resumeLatest: async () => { throw new TypeError("Failed to fetch"); } });
    const error = await api.resume(LINES).catch(e => e);
    expect(error).toBeInstanceOf(TypeError);
    expect((error as Error).message).not.toMatch(/NOT_FOUND/);
  });

  it("local attempt IDs are isolated per account: another account's pending attempt is invisible", async () => {
    const raw = memory();
    const a = createUserAttemptStorage(7, raw as unknown as Storage);
    const b = createUserAttemptStorage(8, raw as unknown as Storage);
    const resumeA = vi.fn(async () => attemptBody());
    const clientA = createStockCheckoutClient({ enabled: true, storage: a, createId: idSeq(), transport: { create: async r => created((r as { attemptId: string }).attemptId), resume: resumeA } });
    await clientA.create(LINES, DELIVERY);
    expect(listOpenStockAttempts(a)).toHaveLength(1);
    expect(listOpenStockAttempts(b)).toHaveLength(0);
    const resumeB = vi.fn();
    const clientB = createStockCheckoutClient({ enabled: true, storage: b, transport: { create: vi.fn(), resume: resumeB } });
    await expect(clientB.resume(LINES)).rejects.toThrow("STOCK_ATTEMPT_NOT_FOUND_LOCALLY");
    expect(resumeB).not.toHaveBeenCalled();
  });

  it("rejects a response whose attemptId does not match the stored one", async () => {
    const { api } = client({
      create: async r => created((r as { attemptId: string }).attemptId),
      resume: async () => attemptBody({ attemptId: "attempt-OTHER0000000001" }),
    });
    await api.create(LINES, DELIVERY);
    await expect(api.resume(LINES)).rejects.toThrow("STOCK_ATTEMPT_CORRELATION_MISMATCH");
  });
});

describe("network failure never produces a second charge", () => {
  it("retrying after a lost create response reuses the same attemptId (idempotent)", async () => {
    const create = vi.fn().mockRejectedValueOnce(new TypeError("Failed to fetch")).mockImplementation(async r => created((r as { attemptId: string }).attemptId));
    const { api } = client({ create });
    await expect(api.create(LINES, DELIVERY)).rejects.toBeInstanceOf(TypeError);
    await api.create(LINES, DELIVERY);
    expect(create).toHaveBeenCalledTimes(2);
    expect(create.mock.calls[1][0].attemptId).toBe(create.mock.calls[0][0].attemptId);
  });
});

describe("stable error codes drive attempt rotation", () => {
  it("CHECKOUT_ATTEMPT_EXPIRED: the dead attemptId is never resent, a new one is used", async () => {
    const create = vi.fn().mockRejectedValueOnce(appError("CHECKOUT_ATTEMPT_EXPIRED")).mockImplementation(async r => created((r as { attemptId: string }).attemptId));
    const { api } = client({ create });
    await expect(api.create(LINES, DELIVERY)).rejects.toThrow();
    await api.create(LINES, DELIVERY);
    const [first, second] = create.mock.calls.map(call => call[0].attemptId);
    expect(second).not.toBe(first);
  });

  it("PAYMENT_UNDER_ANALYSIS: recorded as ambiguous, stays open, and the same attemptId is kept", async () => {
    const create = vi.fn().mockRejectedValue(appError("PAYMENT_UNDER_ANALYSIS"));
    const { api, storage } = client({ create });
    await expect(api.create(LINES, DELIVERY)).rejects.toThrow();
    expect(listOpenStockAttempts(storage).map(a => a.status)).toEqual(["ambiguous"]);
    await expect(api.create(LINES, DELIVERY)).rejects.toThrow();
    expect(create.mock.calls[1][0].attemptId).toBe(create.mock.calls[0][0].attemptId);
  });

  it("the message text alone never rotates the attempt (only data.appError.code does)", async () => {
    const lookalike = Object.assign(new Error("CHECKOUT_ATTEMPT_EXPIRED"), { data: { code: "CONFLICT" } });
    const create = vi.fn().mockRejectedValueOnce(lookalike).mockImplementation(async r => created((r as { attemptId: string }).attemptId));
    const { api } = client({ create });
    await expect(api.create(LINES, DELIVERY)).rejects.toThrow();
    await api.create(LINES, DELIVERY);
    expect(create.mock.calls[1][0].attemptId).toBe(create.mock.calls[0][0].attemptId);
  });
});
