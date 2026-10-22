import { describe, expect, it } from "vitest";
import { assertVariantStockCoversReservations, planProductVariantSync } from "./db";

const existing = [
  { id: 11, name: "Camiseta preto M", sku: "CAM-PT-M", price: 8990, stock: 8, color: null, size: null, optionKey: null, isActive: 0 },
  { id: 12, name: "Camiseta branco M", sku: "CAM-BR-M", price: 8990, stock: 4, color: null, size: null, optionKey: null, isActive: 0 },
];

describe("product variant reconciliation plan", () => {
  it("updates an existing ID in place and preserves price and stock omitted from a partial patch", () => {
    const plan = planProductVariantSync(existing, [
      { id: 11, sku: "CAM-PT-M2" },
    ]);
    expect(plan.update.map(item => item.id)).toEqual([11]);
    expect(plan.update[0].value).toMatchObject({ sku: "CAM-PT-M2", price: 8990, stock: 8, color: null, isActive: 0 });
    expect(plan.insert).toEqual([]);
    expect(plan.remove).toEqual([]);
  });

  it("preserves existing variants omitted from an update instead of deleting or rematching by name", () => {
    const plan = planProductVariantSync(existing, [{ color: "Verde", size: "G", sku: "NEW-GREEN-G", price: null, stock: 2, isActive: false }]);
    expect(plan.update).toEqual([]);
    expect(plan.insert).toHaveLength(1);
    expect(plan.remove).toEqual([]);
  });

  it("rejects a client supplied ID that is not owned by this product", () => {
    expect(() => planProductVariantSync(existing, [
      { id: 999, stock: 3 },
    ])).toThrow(/não pertence a este produto/);
  });

  it("rejects duplicate canonical combinations and duplicate SKUs", () => {
    expect(() => planProductVariantSync(existing, [
      { color: "  preto ", size: "M", sku: "NEW-1", price: 100, stock: 1, isActive: false },
      { color: "Preto", size: " m ", sku: "NEW-2", price: 100, stock: 1, isActive: false },
    ])).toThrow(/combinação de cor e tamanho/);
    expect(() => planProductVariantSync(existing, [
      { color: "Verde", size: "M", sku: "CAM-PT-M", price: 100, stock: 1, isActive: false },
    ])).toThrow(/SKU/);
  });

  it("does not activate a legacy row until its classification and SKU are explicit", () => {
    expect(() => planProductVariantSync(existing, [{ id: 11, isActive: true }])).toThrow(/ativada após revisão explícita/);
    expect(() => planProductVariantSync(existing, [{ id: 11, color: "Preto", size: "M", sku: "CAM-PT-M", isActive: true }]))
      .toThrow(/Classifique explicitamente/);
    const plan = planProductVariantSync([existing[0]], [{ id: 11, color: "Preto", size: "M", sku: "CAM-PT-M", isActive: true }]);
    expect(plan.update[0].value).toMatchObject({ color: "Preto", size: "M", isActive: 1, optionKey: expect.stringMatching(/^v1:/) });
  });

  it("protects active reservations when reducing variant stock", () => {
    expect(() => assertVariantStockCoversReservations("Preto / M", 1, 2)).toThrow(/2 unidades reservadas ativas/);
    expect(() => assertVariantStockCoversReservations("Preto / M", 2, 2)).not.toThrow();
  });
});
