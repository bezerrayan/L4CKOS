import { describe, expect, it } from "vitest";
import { projectPublicProductAvailability } from "./db";

describe("public product availability projection", () => {
  it("keeps variant existence but suppresses sellability when any persisted SKU is restricted", () => {
    expect(projectPublicProductAvailability(
      "Camiseta comum",
      [{ sku: "CAM-PT-M" }, { sku: "14B-CAM-BR-G" }],
      [91, 92],
    )).toEqual({ hasVariants: true, hasSellableVariants: false });
  });

  it("keeps ordinary sellable variants available", () => {
    expect(projectPublicProductAvailability(
      "Camiseta comum",
      [{ sku: "CAM-PT-M" }, { sku: "CAM-BR-G" }],
      [91],
    )).toEqual({ hasVariants: true, hasSellableVariants: true });
  });

  it("does not fabricate variants for simple products", () => {
    expect(projectPublicProductAvailability("Camiseta comum", [], [])).toEqual({
      hasVariants: false,
      hasSellableVariants: false,
    });
  });
});
