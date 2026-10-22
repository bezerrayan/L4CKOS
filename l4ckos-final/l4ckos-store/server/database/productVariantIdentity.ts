import { createHash } from "node:crypto";

const MYSQL_INT_MAX = 2_147_483_647;

export type VariantCombinationInput = {
  color: string;
  size: string;
  sku: string;
  /** Integer cents; null explicitly inherits the product base price. */
  price: number | null;
  stock: number;
  isActive: boolean;
};

export type CanonicalVariantCombination = VariantCombinationInput & {
  color: string;
  size: string;
  optionKey: string;
};

export type VariantPreflightProduct = {
  id: number;
  stock: number;
  salesMode?: "STOCK" | "PREORDER";
  hasVariantOptions?: boolean;
  invalidOptionJson?: boolean;
};

export type VariantPreflightRow = {
  id: number;
  productId: number;
  color: string | null;
  size: string | null;
  optionKey: string | null;
  sku: string | null;
  price: number | null;
  stock: number;
  isActive?: number | null;
};

export type VariantPreflightFinding =
  | { kind: "simple-product"; productId: number }
  | { kind: "options-without-variants"; productId: number }
  | { kind: "invalid-product-options"; productId: number }
  | { kind: "product-has-variants"; productId: number; count: number }
  | { kind: "pending-classification"; productId: number; variantId: number; missing: string[] }
  | { kind: "duplicate-combination"; productId: number; variantIds: number[] }
  | { kind: "noncanonical-option-key"; productId: number; variantId: number }
  | { kind: "duplicate-option-key"; productId: number; optionKey: string; variantIds: number[] }
  | { kind: "duplicate-sku"; sku: string; variantIds: number[] }
  | { kind: "referenced-variant"; variantId: number; orderItemCount: number; reservationCount: number }
  | { kind: "orphan-variant-reference"; variantId: number; orderItemCount: number; reservationCount: number }
  | { kind: "product-variant-stock-mismatch"; productId: number; productStock: number; variantStockTotal: number }
  | { kind: "invalid-product-stock"; productId: number }
  | { kind: "invalid-value"; productId: number; variantId: number; field: "price" | "stock" | "isActive" };

/** Display values are preserved (case and accents); only Unicode form and whitespace are normalized. */
export function normalizeVariantLabel(value: string): string {
  return value.normalize("NFKC").trim().replace(/\s+/gu, " ");
}

function identityPart(value: string, field: "color" | "size"): string {
  const label = normalizeVariantLabel(value);
  if (!label || Array.from(label).length > 60) throw new Error(`VARIANT_${field.toUpperCase()}_INVALID`);
  return label.toLowerCase();
}

/** Server-only canonical identity. Labels are not accent-folded, avoiding lossy legacy inference. */
export function createVariantOptionKey(color: string, size: string): string {
  const canonicalTuple = JSON.stringify([identityPart(color, "color"), identityPart(size, "size")]);
  return `v1:${createHash("sha256").update(canonicalTuple, "utf8").digest("hex")}`;
}

export function validateVariantCombinationSet(
  productId: number,
  combinations: VariantCombinationInput[],
): CanonicalVariantCombination[] {
  if (!Number.isSafeInteger(productId) || productId <= 0) throw new Error("VARIANT_PRODUCT_ID_INVALID");
  const seen = new Set<string>();

  return combinations.map(input => {
    const color = normalizeVariantLabel(input.color);
    const size = normalizeVariantLabel(input.size);
    const optionKey = createVariantOptionKey(color, size);
    if (seen.has(optionKey)) throw new Error("VARIANT_COMBINATION_DUPLICATE");
    seen.add(optionKey);

    const sku = input.sku.trim();
    if (!sku || Array.from(sku).length > 120) throw new Error("VARIANT_SKU_INVALID");
    if (!Number.isSafeInteger(input.stock) || input.stock < 0 || input.stock > MYSQL_INT_MAX) throw new Error("VARIANT_STOCK_INVALID");
    if (input.price !== null && (!Number.isSafeInteger(input.price) || input.price < 0 || input.price > MYSQL_INT_MAX)) {
      throw new Error("VARIANT_PRICE_INVALID");
    }
    if (typeof input.isActive !== "boolean") throw new Error("VARIANT_AVAILABILITY_INVALID");
    return { ...input, color, size, sku, optionKey };
  });
}

/** Pure, read-only preflight analyzer. It reports; it never infers or rewrites persisted identities. */
export function analyzeVariantPreflight(input: {
  products: VariantPreflightProduct[];
  variants: VariantPreflightRow[];
  orderItemVariantIds?: number[];
  reservationVariantIds?: number[];
}): VariantPreflightFinding[] {
  const findings: VariantPreflightFinding[] = [];
  const knownVariantIds = new Set(input.variants.map(row => row.id));
  const orderRefs = countReferences(input.orderItemVariantIds ?? []);
  const reservationRefs = countReferences(input.reservationVariantIds ?? []);
  const allReferences = new Set([...orderRefs.keys(), ...reservationRefs.keys()]);

  for (const product of input.products) {
    if (!Number.isSafeInteger(product.stock) || product.stock < 0 || product.stock > MYSQL_INT_MAX) {
      findings.push({ kind: "invalid-product-stock", productId: product.id });
    }
    if (product.invalidOptionJson) findings.push({ kind: "invalid-product-options", productId: product.id });
    const variants = input.variants.filter(row => row.productId === product.id);
    if (variants.length === 0) {
      if (product.hasVariantOptions) findings.push({ kind: "options-without-variants", productId: product.id });
      else findings.push({ kind: "simple-product", productId: product.id });
      continue;
    }
    findings.push({ kind: "product-has-variants", productId: product.id, count: variants.length });
    const identities = new Map<string, number[]>();
    const optionKeys = new Map<string, number[]>();
    let stockTotal = 0;

    for (const variant of variants) {
      const missing = [
        ...(variant.color?.trim() ? [] : ["color"]),
        ...(variant.size?.trim() ? [] : ["size"]),
        ...(variant.optionKey?.trim() ? [] : ["optionKey"]),
      ];
      if (missing.length) findings.push({ kind: "pending-classification", productId: product.id, variantId: variant.id, missing });
      if (variant.color?.trim() && variant.size?.trim()) {
        try {
          const computed = createVariantOptionKey(variant.color, variant.size);
          identities.set(computed, [...(identities.get(computed) ?? []), variant.id]);
          if (variant.optionKey && variant.optionKey !== computed) findings.push({ kind: "noncanonical-option-key", productId: product.id, variantId: variant.id });
        } catch {
          findings.push({ kind: "pending-classification", productId: product.id, variantId: variant.id, missing: ["invalid-dimension"] });
        }
      }
      if (variant.optionKey) optionKeys.set(variant.optionKey, [...(optionKeys.get(variant.optionKey) ?? []), variant.id]);
      if (!Number.isSafeInteger(variant.stock) || variant.stock < 0 || variant.stock > MYSQL_INT_MAX) findings.push({ kind: "invalid-value", productId: product.id, variantId: variant.id, field: "stock" });
      if (variant.price !== null && (!Number.isSafeInteger(variant.price) || variant.price < 0 || variant.price > MYSQL_INT_MAX)) findings.push({ kind: "invalid-value", productId: product.id, variantId: variant.id, field: "price" });
      if (variant.isActive != null && ![0, 1].includes(variant.isActive)) findings.push({ kind: "invalid-value", productId: product.id, variantId: variant.id, field: "isActive" });
      stockTotal += Number.isFinite(variant.stock) ? variant.stock : 0;
    }

    for (const variantIds of identities.values()) if (variantIds.length > 1) findings.push({ kind: "duplicate-combination", productId: product.id, variantIds });
    for (const [optionKey, variantIds] of optionKeys) if (variantIds.length > 1) findings.push({ kind: "duplicate-option-key", productId: product.id, optionKey, variantIds });
    if (product.salesMode !== "PREORDER" && Number.isSafeInteger(product.stock) && product.stock !== stockTotal) {
      findings.push({ kind: "product-variant-stock-mismatch", productId: product.id, productStock: product.stock, variantStockTotal: stockTotal });
    }
  }

  const skus = new Map<string, number[]>();
  for (const variant of input.variants) {
    const sku = variant.sku?.normalize("NFKC").trim().toLowerCase();
    if (sku) skus.set(sku, [...(skus.get(sku) ?? []), variant.id]);
  }
  for (const [sku, variantIds] of skus) if (variantIds.length > 1) findings.push({ kind: "duplicate-sku", sku, variantIds });

  for (const variantId of allReferences) {
    const orderItemCount = orderRefs.get(variantId) ?? 0;
    const reservationCount = reservationRefs.get(variantId) ?? 0;
    findings.push(knownVariantIds.has(variantId)
      ? { kind: "referenced-variant", variantId, orderItemCount, reservationCount }
      : { kind: "orphan-variant-reference", variantId, orderItemCount, reservationCount });
  }
  return findings;
}

function countReferences(ids: number[]): Map<number, number> {
  const counts = new Map<number, number>();
  for (const id of ids) counts.set(id, (counts.get(id) ?? 0) + 1);
  return counts;
}
