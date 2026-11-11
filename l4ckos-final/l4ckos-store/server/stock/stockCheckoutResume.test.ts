import { describe, expect, it, vi } from "vitest";
import type { StockAttemptResumeRecord, StockCheckoutStore } from "./stockCheckout";
import { resumeStockAttemptHttp } from "./stockCheckoutHttpContract";
import { resumeLatestStockCheckout } from "./stockCheckout";
import { createStockCheckoutClient, stockAttemptStatusLabel, type StockAttemptStorage, type StockCatalogVariant } from "../../client/src/stock/stockCheckoutClient";
import { readCartItems, writeCartItems } from "../../client/src/utils/cartPersistence";
import type { CartItem } from "../../client/src/types/cart";

class MemoryStorage implements StockAttemptStorage {
  private data = new Map<string, string>();
  getItem(key: string) { return this.data.get(key) ?? null; }
  setItem(key: string, value: string) { this.data.set(key, value); }
  removeItem(key: string) { this.data.delete(key); }
}

const variants: StockCatalogVariant[] = [{ id: 31, productId: 7, size: "M", color: "Preto", active: true }];
const lines = [{ productId: 7, variantId: 31, quantity: 1, variants }];
const checkoutRequest = { attemptId: "stock-resume-owner-fixture-001", items: [{ productId: 7, variantId: 31, size: "M", color: "Preto", quantity: 1 }] };

function readableStore(record: StockAttemptResumeRecord | null, onRead = vi.fn()): StockCheckoutStore {
  return {
    transaction: async () => { throw new Error("resume must not open a write transaction"); },
    async findAttemptForOwner(attemptId, ownerUserId) {
      onRead(attemptId, ownerUserId);
      return record?.attemptId === attemptId && ownerUserId === 71 ? record : null;
    },
  };
}

describe("authenticated STOCK checkout resume", () => {
  it("recovers the owner's latest persistent attempt after browser storage loss", async () => {
    const record: StockAttemptResumeRecord = {
      attemptId: "stock-server-recovery-0001", orderId: "order-recovered", status: "reserved", providerState: "created",
      paymentId: "payment-recovered", checkoutUrl: "https://checkout.example.invalid/recovered", amountCents: 12900,
      reservationExpiresAt: new Date(Date.now() + 60_000).toISOString(), reservationExpired: false, reconciliationRequired: false,
    };
    const store: StockCheckoutStore = {
      ...readableStore(null),
      findLatestAttemptForOwner: vi.fn(async ownerUserId => ownerUserId === 71 ? record : null),
    };
    await expect(resumeLatestStockCheckout({ store, authenticatedUserId: 71 })).resolves.toMatchObject({
      attemptId: record.attemptId, status: "pending", paymentId: "payment-recovered",
    });
    await expect(resumeLatestStockCheckout({ store, authenticatedUserId: 72 })).resolves.toBeNull();
    expect(store.findLatestAttemptForOwner).toHaveBeenCalledTimes(2);
  });

  it("returns only the authenticated owner's pending attempt and ignores body userId", async () => {
    const now = new Date(Date.now() + 60_000).toISOString();
    const record: StockAttemptResumeRecord = {
      attemptId: checkoutRequest.attemptId,
      orderId: "stock-order-owner-fixture",
      status: "reserved",
      providerState: "created",
      paymentId: "pay-owned-fixture",
      checkoutUrl: "https://checkout.example.invalid/owned",
      amountCents: 12900,
      reservationExpiresAt: now,
      reservationExpired: false,
      reconciliationRequired: false,
    };
    const storeView = readableStore(record);
    const response = await resumeStockAttemptHttp({
      store: storeView,
      request: {
        session: { user: { id: 71 } },
        params: { attemptId: checkoutRequest.attemptId },
        body: { userId: 999 },
      },
    });
    expect(response).toMatchObject({ status: 200, body: { status: "pending", orderId: "stock-order-owner-fixture", paymentId: "pay-owned-fixture" } });
    expect(response.status === 200 && "ownerUserId" in response.body).toBe(false);
  });

  it("returns the same generic not-found response for a different owner and a missing attempt", async () => {
    const record: StockAttemptResumeRecord = {
      attemptId: checkoutRequest.attemptId, orderId: "private-order", status: "reserved", providerState: "created",
      paymentId: "private-payment", checkoutUrl: "https://checkout.example.invalid/private", amountCents: 12900,
      reservationExpiresAt: new Date(Date.now() + 60_000).toISOString(), reservationExpired: false, reconciliationRequired: false,
    };
    const store = readableStore(record);
    const otherOwner = await resumeStockAttemptHttp({ store, request: { session: { user: { id: 72 } }, params: { attemptId: checkoutRequest.attemptId } } });
    const missing = await resumeStockAttemptHttp({ store, request: { session: { user: { id: 71 } }, params: { attemptId: "stock-resume-missing-fixture-01" } } });
    expect(otherOwner).toEqual({ status: 404, body: { code: "ATTEMPT_NOT_FOUND" } });
    expect(missing).toEqual(otherOwner);
  });

  it("rejects missing sessions and malformed ids before persistent reads", async () => {
    const onRead = vi.fn();
    const store = readableStore(null, onRead);
    const noSession = await resumeStockAttemptHttp({ store, request: { params: { attemptId: checkoutRequest.attemptId } } });
    const badId = await resumeStockAttemptHttp({ store, request: { session: { user: { id: 71 } }, params: { attemptId: "bad" } } });
    expect(noSession).toEqual({ status: 401, body: { code: "AUTHENTICATION_REQUIRED" } });
    expect(badId).toEqual({ status: 400, body: { code: "ATTEMPT_ID_INVALID" } });
    expect(onRead).not.toHaveBeenCalled();
  });

  it.each([
    ["reserved", "not_started", false, "reserved", false],
    ["reserved", "creating", false, "creating", false],
    ["reserved", "creating", true, "ambiguous", false],
    ["reserved", "not_started", true, "expired", false],
    ["reserved", "created", false, "pending", false],
    ["reserved", "ambiguous", false, "ambiguous", false],
    ["paid", "created", false, "paid", false],
    ["released", "definitive_failure", false, "failed", true],
    ["released", "not_started", true, "expired", true],
  ] as const)("maps stored attempt state %s/%s to %s", async (status, providerState, reservationExpired, expected, canStartNewAttempt) => {
    const record: StockAttemptResumeRecord = {
      attemptId: checkoutRequest.attemptId, orderId: "stock-order-state-fixture", status, providerState,
      paymentId: providerState === "created" ? "pay-fixture" : null,
      checkoutUrl: providerState === "created" ? "https://checkout.example.invalid/fixture" : null,
      amountCents: 12900, reservationExpiresAt: new Date(Date.now() + 60_000).toISOString(),
      reservationExpired, reconciliationRequired: providerState === "ambiguous",
    };
    const response = await resumeStockAttemptHttp({
      store: readableStore(record),
      request: { session: { user: { id: 71 } }, params: { attemptId: checkoutRequest.attemptId } },
    });
    expect(response.status).toBe(200);
    if (response.status === 200) {
      expect(response.body.status).toBe(expected);
      expect(response.body.canStartNewAttempt).toBe(canStartNewAttempt);
      if (expected === "ambiguous") expect(response.body.checkoutUrl).toBeUndefined();
    }
  });

  it("keeps the same persisted attempt after resume timeout and blocks retries for legacy cart items", async () => {
    const storage = new MemoryStorage();
    const transport = {
      create: vi.fn(async request => ({ attemptId: request.attemptId, orderId: "order", status: "pending", paymentId: "pay", checkoutUrl: "https://checkout.example.invalid/pay", amountCents: 12900, replayed: false })),
      resume: vi.fn().mockRejectedValueOnce(new Error("timeout")).mockResolvedValueOnce({
        attemptId: "stock-resume-client-fixture-01", status: "ambiguous", orderId: "order", paymentId: "pay",
        amountCents: 12900, reservationExpiresAt: new Date().toISOString(), canStartNewAttempt: false,
      }),
    };
    const createId = vi.fn(() => "stock-resume-client-fixture-01");
    const client = createStockCheckoutClient({ enabled: true, storage, transport, createId });
    await client.create(lines);
    const staleLines = lines.map(line => ({ ...line, variants: line.variants?.map(variant => ({ ...variant, active: false })) }));
    await expect(client.resume(staleLines)).rejects.toThrow("timeout");
    const result = await client.resume(staleLines);
    expect(result.status).toBe("ambiguous");
    expect(transport.resume).toHaveBeenCalledTimes(2);
    expect(createId).toHaveBeenCalledTimes(1);
    expect(stockAttemptStatusLabel("ambiguous")).toMatch(/não inicie outra tentativa/);

    const oldProduct = { id: 7, name: "Legacy", price: 100, image: "fixture" };
    const legacyItem = { product: oldProduct, quantity: 1, addedAt: new Date() } as CartItem;
    writeCartItems(storage, "legacy-cart", [legacyItem]);
    const legacy = readCartItems(storage, "legacy-cart");
    await expect(client.create(legacy.map(item => ({ productId: item.product.id, variantId: item.variantId, quantity: item.quantity, variants: item.product.variants })))).rejects.toThrow("STOCK_VARIANT_ID_REQUIRED");
    expect(transport.create).toHaveBeenCalledTimes(1);
  });

  it("uses owner-scoped server recovery when browser storage is empty", async () => {
    const storage = new MemoryStorage();
    const transport = {
      create: vi.fn(), resume: vi.fn(),
      resumeLatest: vi.fn(async () => ({
        attemptId: "stock-server-recovery-0001", status: "ambiguous", orderId: "order", paymentId: "pay",
        amountCents: 12900, reservationExpiresAt: new Date().toISOString(), canStartNewAttempt: false,
      })),
    };
    const client = createStockCheckoutClient({ enabled: true, storage, transport });
    const result = await client.resume(lines);
    expect(result.status).toBe("ambiguous");
    expect(transport.resumeLatest).toHaveBeenCalledOnce();
    expect(transport.resume).not.toHaveBeenCalled();
  });
});
