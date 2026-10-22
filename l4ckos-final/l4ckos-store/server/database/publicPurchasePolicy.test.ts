import { describe, expect, it } from "vitest";
import { isRestrictedPublicPurchase } from "./publicPurchasePolicy";

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
