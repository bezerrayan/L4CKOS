import { describe, expect, it } from "vitest";
import {
  findSelectedVariant,
  hasAvailableVariant,
  isColorAvailable,
  isSizeAvailable,
} from "../client/src/lib/variantAvailability";

const matrix = [
  { id: 1, color: "Azul", size: "P", stock: 5 },
  { id: 2, color: "Azul", size: "M", stock: 0 },
  { id: 3, color: "Azul", size: "G", stock: 3 },
  { id: 4, color: "Preto", size: "P", stock: 2 },
  { id: 5, color: "Preto", size: "M", stock: 4 },
  { id: 6, color: "Preto", size: "G", stock: 0 },
];

describe("variant availability", () => {
  it("supports size-only and color-only inventories", () => {
    expect(isSizeAvailable([{ id: 1, size: "P", stock: 5 }, { id: 2, size: "M", stock: 0 }, { id: 3, size: "G", stock: 3 }], "P", null)).toBe(true);
    expect(isSizeAvailable([{ id: 1, size: "P", stock: 5 }, { id: 2, size: "M", stock: 0 }, { id: 3, size: "G", stock: 3 }], "M", null)).toBe(false);
    expect(isColorAvailable([{ id: 1, color: "Azul", stock: 0 }, { id: 2, color: "Preto", stock: 5 }], "Azul", null)).toBe(false);
    expect(isColorAvailable([{ id: 1, color: "Azul", stock: 0 }, { id: 2, color: "Preto", stock: 5 }], "Preto", null)).toBe(true);
  });

  it("filters a color/size matrix by the current compatible selection", () => {
    expect(isSizeAvailable(matrix, "M", "Azul")).toBe(false);
    expect(isSizeAvailable(matrix, "P", "Azul")).toBe(true);
    expect(isColorAvailable(matrix, "Azul", "M")).toBe(false);
    expect(isColorAvailable(matrix, "Preto", "M")).toBe(true);
    expect(findSelectedVariant(matrix, "Preto", "M")?.id).toBe(5);
  });

  it("marks fully depleted colors and products unavailable", () => {
    const depletedBlue = matrix.map(variant => variant.color === "Azul" ? { ...variant, stock: 0 } : variant);
    expect(isColorAvailable(depletedBlue, "Azul", null)).toBe(false);
    expect(isColorAvailable(depletedBlue, "Preto", null)).toBe(true);
    expect(hasAvailableVariant(matrix.map(variant => ({ ...variant, stock: 0 })))).toBe(false);
  });
});
