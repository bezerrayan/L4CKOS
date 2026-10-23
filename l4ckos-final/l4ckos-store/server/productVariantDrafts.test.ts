import { describe, expect, it } from "vitest";
import { generateMissingVariantOptions } from "../client/src/utils/productVariantDrafts";

describe("administrative product variant generation", () => {
  it("generates each color and size pair once without replacing persisted drafts", () => {
    const existing = [
      { color: "Preto", size: "M" },
      { color: " branco ", size: "P" },
    ];
    const additions = generateMissingVariantOptions(["Preto", "Branco"], ["P", "M"], existing);

    expect(additions).toEqual([
      { color: "Preto", size: "P" },
      { color: "Branco", size: "M" },
    ]);
    expect(existing).toEqual([
      { color: "Preto", size: "M" },
      { color: " branco ", size: "P" },
    ]);
    expect(generateMissingVariantOptions(["Preto", "Branco"], ["P", "M"], [...existing, ...additions])).toEqual([]);
  });

  it("rejects a matrix larger than the explicit safety limit", () => {
    expect(() => generateMissingVariantOptions(["Preto", "Branco"], ["P", "M"], [], 3)).toThrow("VARIANT_COMBINATION_LIMIT");
  });
});
