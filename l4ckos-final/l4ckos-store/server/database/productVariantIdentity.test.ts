import { describe, expect, it } from "vitest";
import { analyzeVariantPreflight, createVariantOptionKey, validateVariantCombinationSet } from "./productVariantIdentity";

describe("explicit product variant identity contract", () => {
  it("creates a stable, bounded optionKey from normalized color and size", () => {
    expect(createVariantOptionKey("  Azul  marinho ", " M ")).toBe(createVariantOptionKey("azul marinho", "m"));
    expect(createVariantOptionKey("Água", "M")).not.toBe(createVariantOptionKey("Agua", "M"));
    expect(createVariantOptionKey("Preto", "M")).toMatch(/^v1:[a-f0-9]{64}$/);
    expect(createVariantOptionKey("Preto", "M")).toHaveLength(67);
  });

  it("validates new combinations without changing price semantics (integer cents; null inherits base)", () => {
    const result = validateVariantCombinationSet(8, [
      { color: "Preto", size: "M", sku: " CAM-PT-M ", price: null, stock: 5, isActive: true },
      { color: "Branco", size: "M", sku: "CAM-BR-M", price: 8990, stock: 2, isActive: false },
    ]);
    expect(result[0]).toMatchObject({ color: "Preto", size: "M", sku: "CAM-PT-M", price: null, stock: 5, isActive: true });
    expect(result[0].optionKey).not.toBe(result[1].optionKey);
    expect(() => validateVariantCombinationSet(8, [
      { color: "Preto", size: "M", sku: "A", price: null, stock: 1, isActive: true },
      { color: " preto ", size: "m", sku: "B", price: 9000, stock: 1, isActive: true },
    ])).toThrow("VARIANT_COMBINATION_DUPLICATE");
  });

  it.each([
    [{ color: " ", size: "M", sku: "A", price: null, stock: 0, isActive: true }, "VARIANT_COLOR_INVALID"],
    [{ color: "Preto", size: "M", sku: " ", price: null, stock: 0, isActive: true }, "VARIANT_SKU_INVALID"],
    [{ color: "Preto", size: "M", sku: "A", price: -1, stock: 0, isActive: true }, "VARIANT_PRICE_INVALID"],
    [{ color: "Preto", size: "M", sku: "A", price: null, stock: -1, isActive: true }, "VARIANT_STOCK_INVALID"],
    [{ color: "Preto", size: "M", sku: "A", price: null, stock: 0, isActive: 1 }, "VARIANT_AVAILABILITY_INVALID"],
  ] as const)("rejects invalid combination fields", (combination, error) => {
    expect(() => validateVariantCombinationSet(8, [combination])).toThrow(error);
  });

  it("reports legacy rows and references without inferring or rewriting them", () => {
    const findings = analyzeVariantPreflight({
      products: [{ id: 1, stock: 9, salesMode: "STOCK" }, { id: 2, stock: 20, salesMode: "PREORDER" }, { id: 3, stock: 4 }, { id: 5, stock: 0, hasVariantOptions: true }],
      variants: [
        { id: 11, productId: 1, color: "Preto", size: "M", optionKey: createVariantOptionKey("Preto", "M"), sku: "DUP", price: 9000, stock: 3, isActive: 1 },
        { id: 12, productId: 1, color: " preto ", size: "m", optionKey: null, sku: "DUP", price: null, stock: 2, isActive: 0 },
        { id: 13, productId: 1, color: "Branco", size: "M", optionKey: createVariantOptionKey("Preto", "M"), sku: "WHITE-M", price: 9000, stock: 1, isActive: 0 },
        { id: 21, productId: 2, color: null, size: null, optionKey: null, sku: "PRE", price: null, stock: 20, isActive: 0 },
      ],
      orderItemVariantIds: [11, 999],
      reservationVariantIds: [11, 11],
    });

    expect(findings).toContainEqual({ kind: "simple-product", productId: 3 });
    expect(findings).toContainEqual({ kind: "options-without-variants", productId: 5 });
    expect(findings).toContainEqual({ kind: "pending-classification", productId: 1, variantId: 12, missing: ["optionKey"] });
    expect(findings).toContainEqual({ kind: "duplicate-combination", productId: 1, variantIds: [11, 12] });
    expect(findings).toContainEqual({ kind: "duplicate-option-key", productId: 1, optionKey: createVariantOptionKey("Preto", "M"), variantIds: [11, 13] });
    expect(findings).toContainEqual({ kind: "duplicate-sku", sku: "dup", variantIds: [11, 12] });
    expect(findings).toContainEqual({ kind: "noncanonical-option-key", productId: 1, variantId: 13 });
    expect(findings).toContainEqual({ kind: "product-variant-stock-mismatch", productId: 1, productStock: 9, variantStockTotal: 6 });
    expect(findings).toContainEqual({ kind: "referenced-variant", variantId: 11, orderItemCount: 1, reservationCount: 2 });
    expect(findings).toContainEqual({ kind: "orphan-variant-reference", variantId: 999, orderItemCount: 1, reservationCount: 0 });
    expect(findings.some(finding => finding.kind === "product-variant-stock-mismatch" && finding.productId === 2)).toBe(false);
  });

  it("flags negative and invalid stored values without changing the input rows", () => {
    const findings = analyzeVariantPreflight({
      products: [{ id: 4, stock: -1 }],
      variants: [{ id: 41, productId: 4, color: "Verde", size: "P", optionKey: null, sku: null, price: -1, stock: -2, isActive: 3 }],
    });
    expect(findings).toContainEqual({ kind: "invalid-product-stock", productId: 4 });
    expect(findings).toContainEqual({ kind: "invalid-value", productId: 4, variantId: 41, field: "price" });
    expect(findings).toContainEqual({ kind: "invalid-value", productId: 4, variantId: 41, field: "stock" });
    expect(findings).toContainEqual({ kind: "invalid-value", productId: 4, variantId: 41, field: "isActive" });
  });
});
