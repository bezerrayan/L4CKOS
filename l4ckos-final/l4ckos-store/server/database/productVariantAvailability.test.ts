import { describe, expect, it } from "vitest";
import { createVariantOptionKey } from "./productVariantIdentity";
import { getSellableVariantIds } from "./productVariantAvailability";

const product = { id: 9, name: "Produto de teste", price: 7990, salesMode: "STOCK" };
function variant(id: number, overrides: Record<string, unknown> = {}) {
  const color = String(overrides.color ?? "preto");
  const size = String(overrides.size ?? "M");
  return {
    id, color, size, sku: `TEST-${id}`, price: null, stock: 3, isActive: 1,
    optionKey: createVariantOptionKey(color, size), ...overrides,
  };
}

describe("admin sellable variant projection", () => {
  it("separates active variants from actual stock availability", () => {
    const variants = [variant(1, { stock: 0 }), variant(2, { color: "branco", stock: 3 })];
    expect(getSellableVariantIds(product, variants, new Map())).toEqual([2]);
  });

  it("subtracts active reservations and never sells an inactive combination", () => {
    const variants = [variant(1, { stock: 3 }), variant(2, { stock: 3, isActive: 0, color: "branco" })];
    expect(getSellableVariantIds(product, variants, new Map([[1, 3]]))).toEqual([]);
  });

  it("excludes QA catalog fixtures even when variants are active and stocked", () => {
    const qaProduct = { ...product, name: "[QA-STAGING] Fixture" };
    const qaVariants = [variant(1, { sku: "QA-PRE-M-01" })];
    expect(getSellableVariantIds(qaProduct, qaVariants, new Map())).toEqual([]);
  });

  it("rejects malformed identities, duplicate SKUs, and invalid effective prices", () => {
    const duplicateSku = [variant(1, { sku: "DUP" }), variant(2, { color: "branco", sku: "DUP" })];
    expect(getSellableVariantIds(product, duplicateSku, new Map())).toEqual([]);
    expect(getSellableVariantIds(product, [variant(3, { optionKey: "wrong" })], new Map())).toEqual([]);
    expect(getSellableVariantIds({ ...product, price: 0 }, [variant(4)], new Map())).toEqual([]);
  });

  it("requires an open batch with remaining capacity for preorder variants", () => {
    const preorder = { ...product, salesMode: "PREORDER" };
    const openBatch = { id: 1, name: "Lote", status: "OPEN" as const, salesOpenAt: null, salesCloseAt: null, estimatedShippingStart: null, estimatedShippingEnd: null, capacity: { maximumQuantity: 10, claimedQuantity: 9, remainingQuantity: 1 } };
    const fullBatch = { ...openBatch, capacity: { maximumQuantity: 10, claimedQuantity: 10, remainingQuantity: 0 } };
    expect(getSellableVariantIds({ ...preorder, productionBatch: openBatch }, [variant(5, { stock: 0 })], new Map())).toEqual([5]);
    expect(getSellableVariantIds({ ...preorder, productionBatch: fullBatch }, [variant(6, { stock: 0 })], new Map())).toEqual([]);
  });
});
