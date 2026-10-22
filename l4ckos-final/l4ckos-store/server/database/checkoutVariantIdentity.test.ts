import { describe, expect, it } from "vitest";
import { CheckoutError, resolveCheckoutVariant, type CheckoutVariantRow } from "./checkout";
import { createVariantOptionKey } from "./productVariantIdentity";

const activeVariant: CheckoutVariantRow = {
  id: 11,
  productId: 2,
  isActive: 1,
  color: "Preto",
  size: "M",
  sku: "SHIRT-BLK-M",
  optionKey: createVariantOptionKey("Preto", "M"),
  price: 9200,
};
const item = { productId: 2, variantId: 11, color: "Preto", size: "M", quantity: 1 };

function codeOf(action: () => unknown, code: string) {
  try {
    action();
  } catch (error) {
    expect(error).toBeInstanceOf(CheckoutError);
    expect((error as CheckoutError).code).toBe(code);
    return;
  }
  throw new Error(`Expected CheckoutError ${code}`);
}

describe("checkout variant resolution", () => {
  it("requires a variant ID for products with variant rows", () => {
    codeOf(() => resolveCheckoutVariant({ productId: 2, color: "Preto", size: "M", quantity: 1 }, 2, "Shirt", [activeVariant]), "CHECKOUT_VARIANT_REQUIRED");
  });

  it("accepts only an active owned variant with matching snapshots", () => {
    expect(resolveCheckoutVariant(item, 2, "Shirt", [activeVariant])).toBe(activeVariant);
    codeOf(() => resolveCheckoutVariant(item, 2, "Shirt", [{ ...activeVariant, productId: 3 }]), "CHECKOUT_VARIANT_OWNERSHIP");
    codeOf(() => resolveCheckoutVariant({ ...item, size: "L" }, 2, "Shirt", [activeVariant]), "CHECKOUT_VARIANT_DIMENSIONS_MISMATCH");
    codeOf(() => resolveCheckoutVariant(item, 2, "Shirt", [{ ...activeVariant, isActive: 0 }]), "CHECKOUT_VARIANT_INACTIVE");
  });

  it("rejects missing identity data and restricted products", () => {
    codeOf(() => resolveCheckoutVariant(item, 2, "Shirt", [{ ...activeVariant, optionKey: "wrong" }]), "CHECKOUT_VARIANT_IDENTITY_INVALID");
    codeOf(() => resolveCheckoutVariant({ ...item, variantId: 999 }, 2, "Shirt", [activeVariant]), "CHECKOUT_VARIANT_NOT_FOUND");
    codeOf(() => resolveCheckoutVariant({ productId: 2, quantity: 1 }, 2, "Camiseta Clã 14 Bis", []), "CHECKOUT_PRODUCT_REQUIRES_AUTHORIZATION");
  });

  it("rejects a SKU duplicated within the product catalog", () => {
    const duplicate = { ...activeVariant, id: 12, color: "Branco", size: "G", optionKey: createVariantOptionKey("Branco", "G"), sku: " shirt-blk-m " };
    codeOf(() => resolveCheckoutVariant(item, 2, "Shirt", [activeVariant, duplicate]), "CHECKOUT_VARIANT_SKU_DUPLICATE");
  });

  it("rejects a SKU duplicated within the product catalog", () => {
    const duplicate = { ...activeVariant, id: 12, color: "Branco", size: "G", optionKey: createVariantOptionKey("Branco", "G"), sku: " shirt-blk-m " };
    codeOf(() => resolveCheckoutVariant(item, 2, "Shirt", [activeVariant, duplicate]), "CHECKOUT_VARIANT_SKU_DUPLICATE");
  });

  it("keeps simple products on the product-level path without inferring a variant", () => {
    expect(resolveCheckoutVariant({ productId: 1, quantity: 1, color: "Azul", size: "M" }, 1, "Simple shirt", [])).toBeNull();
  });
});
