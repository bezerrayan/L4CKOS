import { describe, expect, it, vi } from "vitest";
import {
  createStockCheckoutClient,
  resolveStockVariant,
  type StockAttemptStorage,
  type StockCatalogVariant,
} from "../../client/src/stock/stockCheckoutClient";
import { readCartItems, writeCartItems } from "../../client/src/utils/cartPersistence";
import type { CartItem } from "../../client/src/types/cart";
import { parseStockCheckoutRequestV1, toStockCheckoutResponseV1 } from "./stockCheckoutHttpContract";

class MemoryStorage implements StockAttemptStorage {
  private values = new Map<string, string>();
  getItem(key: string) { return this.values.get(key) ?? null; }
  setItem(key: string, value: string) { this.values.set(key, value); }
  removeItem(key: string) { this.values.delete(key); }
}

const variants: StockCatalogVariant[] = [
  { id: 31, productId: 7, size: "M", color: "Preto", active: true },
  { id: 32, productId: 7, size: "G", color: "Preto", active: false },
  { id: 41, productId: 8, size: "M", color: "Preto", active: true },
];
const lines = [{ productId: 7, variantId: 31, quantity: 2, variants }];

function pendingResponse(attemptId: string) {
  return toStockCheckoutResponseV1(attemptId, {
    orderId: "stock-order-fixture-01",
    paymentId: "payment-fixture-01",
    checkoutUrl: "https://checkout.example.invalid/fixture",
    amountCents: 25000,
    replayed: false,
  });
}

describe("STOCK frontend and HTTP V1 contract", () => {
  it("resolves only the actual product variant identity and rejects missing/inactive combinations", () => {
    expect(resolveStockVariant(variants, 7, "m", "preto")?.id).toBe(31);
    expect(resolveStockVariant(variants, 8, "M", "Preto")?.id).toBe(41);
    expect(resolveStockVariant(variants, 7, "G", "Preto")).toBeNull();
    expect(resolveStockVariant(variants, 7, "P", "Preto")).toBeNull();
  });

  it("persists and restores cart variant identity across refresh", () => {
    const storage = new MemoryStorage();
    const item = { product: { id: 7, name: "Camisa", price: 125, image: "fixture", variants }, quantity: 2, variantId: 31, addedAt: new Date() } as CartItem;
    writeCartItems(storage, "cart", [item]);
    const restored = readCartItems(storage, "cart");
    expect(restored).toHaveLength(1);
    expect(restored[0].variantId).toBe(31);
    expect(restored[0].product.variants?.[0].id).toBe(31);
  });

  it("keeps the attempt id stable through retries and adapter reconstruction after refresh", async () => {
    const storage = new MemoryStorage();
    const create = vi.fn(async request => pendingResponse(request.attemptId));
    const resume = vi.fn(async attemptId => ({
      attemptId,
      status: "pending",
      orderId: "stock-order-fixture-01",
      paymentId: "payment-fixture-01",
      checkoutUrl: "https://checkout.example.invalid/fixture",
      amountCents: 25000,
      reservationExpiresAt: new Date(Date.now() + 60_000).toISOString(),
      canStartNewAttempt: false,
    }));
    const createId = vi.fn(() => "stock-attempt-synthetic-0001");
    const firstClient = createStockCheckoutClient({ enabled: true, storage, transport: { create, resume }, createId });
    const first = await firstClient.create(lines);
    const retry = await firstClient.create(lines);
    const afterRefresh = createStockCheckoutClient({ enabled: true, storage, transport: { create, resume }, createId });
    const resumed = await afterRefresh.resume(lines);
    expect(first.attemptId).toBe(retry.attemptId);
    expect(resumed.attemptId).toBe(first.attemptId);
    expect(create).toHaveBeenCalledTimes(2);
    expect(resume).toHaveBeenCalledWith(first.attemptId);
    expect(createId).toHaveBeenCalledTimes(1);
  });

  it("rejects missing, invented, cross-product, and inactive variant ids before transport", async () => {
    const create = vi.fn();
    const client = createStockCheckoutClient({ enabled: true, storage: new MemoryStorage(), transport: { create, resume: vi.fn() }, createId: () => "stock-attempt-synthetic-0002" });
    await expect(client.create([{ productId: 7, quantity: 1 }])).rejects.toThrow("STOCK_VARIANT_ID_REQUIRED");
    await expect(client.create([{ productId: 7, variantId: 999, quantity: 1, variants }])).rejects.toThrow("STOCK_VARIANT_NOT_AVAILABLE");
    await expect(client.create([{ productId: 8, variantId: 31, quantity: 1, variants }])).rejects.toThrow("STOCK_VARIANT_NOT_AVAILABLE");
    await expect(client.create([{ productId: 7, variantId: 32, quantity: 1, variants }])).rejects.toThrow("STOCK_VARIANT_NOT_AVAILABLE");
    expect(create).not.toHaveBeenCalled();
  });

  it("rejects client price fields and returns only server-calculated response values", () => {
    expect(() => parseStockCheckoutRequestV1({ attemptId: "stock-attempt-synthetic-0003", items: [{ productId: 7, variantId: 31, quantity: 1, price: 1 }] })).toThrow();
    expect(parseStockCheckoutRequestV1({ attemptId: "stock-attempt-synthetic-0003", items: [{ productId: 7, variantId: 31, quantity: 1 }] })).toEqual({
      attemptId: "stock-attempt-synthetic-0003", items: [{ productId: 7, variantId: 31, quantity: 1 }],
    });
    expect(pendingResponse("stock-attempt-synthetic-0003").status).toBe("pending");
    expect(pendingResponse("stock-attempt-synthetic-0003").amountCents).toBe(25000);
  });

  it("makes no storage or transport call while the public checkout gate is closed", async () => {
    const storage = new MemoryStorage();
    const transport = { create: vi.fn(), resume: vi.fn() };
    const client = createStockCheckoutClient({ enabled: false, storage, transport, createId: () => "stock-attempt-synthetic-0004" });
    await expect(client.create(lines)).rejects.toThrow("PUBLIC_CHECKOUT_DISABLED");
    await expect(client.resume(lines)).rejects.toThrow("PUBLIC_CHECKOUT_DISABLED");
    expect(transport.create).not.toHaveBeenCalled();
    expect(transport.resume).not.toHaveBeenCalled();
    expect(storage.getItem("l4ckos:stock-checkout-attempts:v1")).toBeNull();
  });

  it("allows a new attempt only after a definitive failed or expired status", async () => {
    const storage = new MemoryStorage();
    const create = vi.fn(async request => pendingResponse(request.attemptId));
    const resume = vi.fn(async attemptId => ({ attemptId, status: "expired", orderId: "stock-order-fixture-01", amountCents: 25000, reservationExpiresAt: new Date().toISOString(), canStartNewAttempt: true }));
    let sequence = 0;
    const client = createStockCheckoutClient({ enabled: true, storage, transport: { create, resume }, createId: () => `stock-attempt-terminal-${String(++sequence).padStart(4, "0")}` });
    const first = await client.create(lines);
    await expect(client.startNewAfterTerminal(lines)).rejects.toThrow("STOCK_ATTEMPT_NOT_DEFINITIVELY_TERMINAL");
    await client.resume(lines);
    const next = await client.startNewAfterTerminal(lines);
    expect(next).not.toBe(first.attemptId);
  });
});
