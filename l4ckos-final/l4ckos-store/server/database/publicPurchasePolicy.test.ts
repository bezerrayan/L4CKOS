import { describe, expect, it } from "vitest";
import { isRestrictedPublicPurchase, isStagingQaCatalogProduct } from "./publicPurchasePolicy";

describe("public purchase restrictions", () => {
  it("keeps the Clã 14 Bis product closed across accents and punctuation", () => {
    expect(isRestrictedPublicPurchase("Camiseta Clã 14 Bis")).toBe(true);
    expect(isRestrictedPublicPurchase("CAMISETA CLAN-14-BIS")).toBe(true);
  });

  it("also recognizes the reserved collaboration SKU prefix", () => {
    expect(isRestrictedPublicPurchase("Edição especial", "14B-PT-M")).toBe(true);
  });

  it("leaves unrelated catalog entries public", () => {
    expect(isRestrictedPublicPurchase("Camiseta Horizonte", "HORIZONTE-PT-M")).toBe(false);
  });
});

describe("staging QA catalog visibility", () => {
  const qaVariants = ["QA-PRE-M-01", "QA-PRE-G-01", "QA-BRA-M-01", "QA-BRA-G-01"].map(sku => ({ sku }));

  it("identifies a QA fixture using both its label and all QA variant SKUs", () => {
    expect(isStagingQaCatalogProduct("[QA-STAGING] Teste de Variantes", qaVariants)).toBe(true);
  });

  it("does not hide a product based only on its QA label", () => {
    expect(isStagingQaCatalogProduct("[QA-STAGING] Produto", [{ sku: "REAL-PT-M" }])).toBe(false);
  });

  it("does not hide ordinary products or simple products based on a SKU/name fragment", () => {
    expect(isStagingQaCatalogProduct("Camiseta Horizonte", qaVariants)).toBe(false);
    expect(isStagingQaCatalogProduct("[QA-STAGING] Produto simples", [])).toBe(false);
  });

  it("rejects incomplete QA SKU coverage", () => {
    expect(isStagingQaCatalogProduct("[QA-STAGING] Teste", [...qaVariants.slice(0, 3), { sku: null }])).toBe(false);
  });
});
