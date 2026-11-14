import { describe, expect, it } from "vitest";
import { isRestrictedPublicPurchase, isStagingQaCatalogProduct } from "./publicPurchasePolicy";

describe("public purchase restriction policy", () => {
  it("blocks the Clã 14 Bis collaboration by product name", () => {
    expect(isRestrictedPublicPurchase("Clã 14 Bis — edição especial")).toBe(true);
    expect(isRestrictedPublicPurchase("CAMISETA CLAN-14-BIS")).toBe(true);
  });

  it("blocks a generic product when any persisted SKU starts with 14B", () => {
    expect(isRestrictedPublicPurchase("Camiseta comum", ["14B-CAM-PT-M"])).toBe(true);
    expect(isRestrictedPublicPurchase("Edição especial", "14B-PT-M")).toBe(true);
  });

  it("blocks all combinations when a mixed SKU set contains a 14B SKU", () => {
    expect(isRestrictedPublicPurchase("Camiseta comum", ["CAM-PT-M", "14B-CAM-BR-G"])).toBe(true);
  });

  it("leaves ordinary products unrestricted", () => {
    expect(isRestrictedPublicPurchase("Camiseta comum", ["CAM-PT-M", "CAM-BR-G"])).toBe(false);
    expect(isRestrictedPublicPurchase("Camiseta Horizonte", "HORIZONTE-PT-M")).toBe(false);
  });

  it("keeps the existing QA fixture policy intact", () => {
    const qaVariants = ["QA-PRE-M-01", "QA-PRE-G-01", "QA-BRA-M-01", "QA-BRA-G-01"].map(sku => ({ sku }));
    expect(isStagingQaCatalogProduct("[QA-STAGING] Teste de Variantes", qaVariants)).toBe(true);
    expect(isStagingQaCatalogProduct("[QA-STAGING] Produto", [{ sku: "REAL-PT-M" }])).toBe(false);
    expect(isStagingQaCatalogProduct("Camiseta Horizonte", qaVariants)).toBe(false);
    expect(isStagingQaCatalogProduct("[QA-STAGING] Produto simples", [])).toBe(false);
    expect(isStagingQaCatalogProduct("[QA-STAGING] Teste", [...qaVariants.slice(0, 3), { sku: null }])).toBe(false);
  });
});
