import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { getTableColumns } from "drizzle-orm";
import { productImages, products } from "../drizzle/schema";
import { buildProductImageList } from "./db";

const variants = ["imageThumbnailUrl", "imageDetailUrl", "imageBannerUrl"] as const;

describe("product image variants", () => {
  it("keeps migration 0016 strictly additive and nullable", async () => {
    const migration = await readFile("drizzle/0016_product_image_variants.sql", "utf8");
    expect(migration).toContain("ALTER TABLE `products`");
    expect(migration).toContain("ALTER TABLE `productImages`");
    for (const field of variants) expect(migration).toContain(`\`${field}\` varchar(500) NULL`);
    expect(migration).not.toMatch(/\bUPDATE\b|\bDELETE\b|\bDROP\b/i);
  });

  it("declares exactly the nullable variant fields in both tables", () => {
    for (const table of [products, productImages]) {
      const columns = getTableColumns(table);
      for (const field of variants) {
        expect(columns[field].notNull).toBe(false);
        expect(columns[field].dataType).toBe("string");
      }
    }
  });

  it("returns legacy gallery rows with explicit null variants", () => {
    const [image] = buildProductImageList([{
      id: 1, productId: 10, imageUrl: "https://assets.example.test/legacy.webp",
      imageThumbnailUrl: null, imageDetailUrl: null, imageBannerUrl: null,
      color: null, alt: null, order: 0, createdAt: new Date(),
    }]);
    expect(image).toMatchObject({
      imageUrl: "https://assets.example.test/legacy.webp",
      imageThumbnailUrl: null,
      imageDetailUrl: null,
      imageBannerUrl: null,
    });
  });

  it("returns persisted gallery variants without inventing fallback values", () => {
    const [image] = buildProductImageList([{
      id: 1, productId: 10, imageUrl: "https://assets.example.test/original.webp",
      imageThumbnailUrl: "https://assets.example.test/thumb.webp",
      imageDetailUrl: "https://assets.example.test/detail.webp",
      imageBannerUrl: "https://assets.example.test/banner.webp",
      color: "Verde", alt: "Produto verde", order: 0, createdAt: new Date(),
    }]);
    expect(image).toMatchObject({
      imageThumbnailUrl: "https://assets.example.test/thumb.webp",
      imageDetailUrl: "https://assets.example.test/detail.webp",
      imageBannerUrl: "https://assets.example.test/banner.webp",
    });
  });
});
