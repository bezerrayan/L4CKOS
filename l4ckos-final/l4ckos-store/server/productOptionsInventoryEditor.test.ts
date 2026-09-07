import { describe, expect, it } from "vitest";
import { productOptionsInventory } from "../client/src/components/admin/products/ProductOptionsInventoryEditor";

describe("product options inventory editor", () => {
  it("keeps standalone products on product stock", () => {
    expect(productOptionsInventory.buildVariants("Camiseta", "99.90", [], [], [])).toEqual([]);
  });

  it("creates one-dimensional size and color matrices", () => {
    const sizes = productOptionsInventory.buildVariants("Camiseta", "99.90", [], ["P", "M", "G"], []);
    const colors = productOptionsInventory.buildVariants("Camiseta", "99.90", ["Preto", "Branco", "Azul"], [], []);

    expect(sizes.map(variant => variant.size)).toEqual(["P", "M", "G"]);
    expect(colors.map(variant => variant.color)).toEqual(["Preto", "Branco", "Azul"]);
  });

  it("builds a color-size matrix and preserves existing stock when an option is added", () => {
    const initial = productOptionsInventory.buildVariants("Camiseta", "99.90", ["Preto", "Azul"], ["P", "M"], [])
      .map((variant, index) => ({ ...variant, stock: [20, 10, 5, 0][index] }));
    const serialized = productOptionsInventory.serializeVariants(initial);
    const parsed = productOptionsInventory.parseVariants(serialized, ["Preto", "Azul"], ["P", "M"]);
    const expanded = productOptionsInventory.buildVariants("Camiseta", "99.90", ["Preto", "Azul"], ["P", "M", "G"], parsed);

    expect(expanded).toHaveLength(6);
    expect(expanded.filter(variant => variant.size !== "G").map(variant => variant.stock)).toEqual([20, 10, 5, 0]);
    expect(expanded.filter(variant => variant.size === "G").map(variant => variant.stock)).toEqual([0, 0]);
    expect(expanded.reduce((total, variant) => total + variant.stock, 0)).toBe(35);
  });
});
