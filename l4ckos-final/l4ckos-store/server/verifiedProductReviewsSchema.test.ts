import { readFile } from "node:fs/promises";
import { getTableColumns } from "drizzle-orm";
import { getTableConfig } from "drizzle-orm/mysql-core";
import { describe, expect, it } from "vitest";
import { orders, productReviews, productReviewUploads } from "../drizzle/schema";

const reviewFields = ["orderId", "stockReservationId", "sizePerception", "imageUrl", "imageStatus", "moderationStatus", "verifiedPurchase", "moderatedBy", "moderatedAt"] as const;

describe("verified product reviews schema", () => {
  it("keeps migration 0017 additive without inferred financial history", async () => {
    const migration = await readFile("drizzle/0017_verified_product_reviews.sql", "utf8");
    expect(migration).toContain("ALTER TABLE `productReviews`");
    expect(migration).toContain("CREATE TABLE `productReviewUploads`");
    expect(migration).not.toMatch(/\b(?:UPDATE|DELETE|DROP|INSERT)\b/i);
    expect(migration).not.toContain("productReviews_user_product_unique");
  });

  it("declares nullable purchase references and safe defaults for legacy reviews", () => {
    const columns = getTableColumns(productReviews);
    for (const field of ["orderId", "stockReservationId", "sizePerception", "imageUrl", "moderatedBy", "moderatedAt"] as const) {
      expect(columns[field].notNull).toBe(false);
    }
    expect(columns.imageStatus.notNull).toBe(true);
    expect(columns.imageStatus.default).toBe("none");
    expect(columns.moderationStatus.default).toBe("published");
    expect(columns.verifiedPurchase.notNull).toBe(true);
    expect(columns.verifiedPurchase.default).toBe(0);
  });

  it("indexes public review reads and permits only one non-null review per reservation", () => {
    const config = getTableConfig(productReviews);
    const publicIndex = config.indexes.find(value => value.config.name === "productReviews_public_idx");
    const reservationIndex = config.indexes.find(value => value.config.name === "productReviews_stockReservationId_unique");
    expect(publicIndex?.config.columns.map(column => column.name)).toEqual(["productId", "verifiedPurchase", "moderationStatus", "createdAt"]);
    expect(reservationIndex?.config.unique).toBe(true);
    expect(reservationIndex?.config.columns.map(column => column.name)).toEqual(["stockReservationId"]);
  });

  it("declares the deferred upload-token table exactly", () => {
    const columns = getTableColumns(productReviewUploads);
    expect(columns.token.primary).toBe(true);
    expect(columns.token.length).toBe(64);
    expect(columns.imageUrl.length).toBe(500);
    for (const field of ["userId", "productId", "imageUrl", "expiresAt", "createdAt"] as const) expect(columns[field].notNull).toBe(true);
    expect(columns.claimedAt.notNull).toBe(false);
    const indexes = getTableConfig(productReviewUploads).indexes;
    expect(indexes.map(value => value.config.name)).toEqual(expect.arrayContaining(["productReviewUploads_user_product_idx", "productReviewUploads_expiry_idx"]));
  });

  it("does not introduce a concurrent financial state on orders", () => {
    const orderColumns = getTableColumns(orders);
    for (const field of ["paymentStatus", "paymentConfirmedAt", "paymentConfirmedBy"] as const) expect(orderColumns[field]).toBeUndefined();
    expect(reviewFields).toContain("stockReservationId");
  });
});
