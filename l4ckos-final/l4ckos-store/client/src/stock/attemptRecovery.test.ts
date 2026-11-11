import { describe, expect, it } from "vitest";
import { getOrCreateStockAttemptId, listOpenStockAttempts, saveStockAttemptStatus, updateStoredStockAttemptById } from "./stockCheckoutClient";

function memoryStorage() {
  const data = new Map<string, string>();
  return { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => void data.set(k, v) };
}
const itemsA = [{ productId: 1, variantId: 10, quantity: 1 }];
const itemsB = [{ productId: 2, variantId: 20, quantity: 2 }];
const id = (n: number) => `attempt-${String(n).padStart(16, "0")}`;

describe("open attempt recovery", () => {
  it("lists unsettled attempts newest first, without exposing fingerprints", () => {
    const storage = memoryStorage();
    getOrCreateStockAttemptId({ storage, items: itemsA, createId: () => id(1), now: 1000 });
    getOrCreateStockAttemptId({ storage, items: itemsB, createId: () => id(2), now: 2000 });
    const open = listOpenStockAttempts(storage, 3000);
    expect(open.map(a => a.attemptId)).toEqual([id(2), id(1)]);
    expect(Object.keys(open[0]).sort()).toEqual(["attemptId", "createdAt", "status"]);
  });

  it("excludes paid and definitive terminal attempts", () => {
    const storage = memoryStorage();
    getOrCreateStockAttemptId({ storage, items: itemsA, createId: () => id(1), now: 1000 });
    getOrCreateStockAttemptId({ storage, items: itemsB, createId: () => id(2), now: 1000 });
    saveStockAttemptStatus({ storage, items: itemsA, attemptId: id(1), status: "paid", now: 1000 });
    saveStockAttemptStatus({ storage, items: itemsB, attemptId: id(2), status: "failed", canStartNewAttempt: true, now: 1000 });
    expect(listOpenStockAttempts(storage, 2000)).toEqual([]);
  });

  it("keeps ambiguous attempts open so the customer is never told to start over", () => {
    const storage = memoryStorage();
    getOrCreateStockAttemptId({ storage, items: itemsA, createId: () => id(1), now: 1000 });
    saveStockAttemptStatus({ storage, items: itemsA, attemptId: id(1), status: "ambiguous", now: 1000 });
    expect(listOpenStockAttempts(storage, 2000)).toHaveLength(1);
  });

  it("updates a known attempt by ID and ignores unknown ones", () => {
    const storage = memoryStorage();
    getOrCreateStockAttemptId({ storage, items: itemsA, createId: () => id(1), now: 1000 });
    expect(updateStoredStockAttemptById({ storage, attemptId: id(1), status: "paid", now: 1500 })).toBe(true);
    expect(listOpenStockAttempts(storage, 2000)).toEqual([]);
    expect(updateStoredStockAttemptById({ storage, attemptId: id(9), status: "paid", now: 1500 })).toBe(false);
  });

  it("survives corrupted storage", () => {
    const storage = memoryStorage();
    storage.setItem("l4ckos:stock-checkout-attempts:v1", "{not json");
    expect(listOpenStockAttempts(storage)).toEqual([]);
  });
});
