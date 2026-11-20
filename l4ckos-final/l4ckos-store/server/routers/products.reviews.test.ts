import { beforeEach, describe, expect, it, vi } from "vitest";
import { TRPCError } from "@trpc/server";

const dbMocks = vi.hoisted(() => ({
  createVerifiedProductReview: vi.fn(),
  getEligibleReviewProducts: vi.fn(),
  getProductByIdWithDetails: vi.fn(),
  getProductReviews: vi.fn(),
}));

vi.mock("../db", () => ({
  createVerifiedProductReview: dbMocks.createVerifiedProductReview,
  getEligibleReviewProducts: dbMocks.getEligibleReviewProducts,
  getProducts: vi.fn(),
  getProductByIdWithDetails: dbMocks.getProductByIdWithDetails,
  createProduct: vi.fn(),
  updateProduct: vi.fn(),
  deleteProduct: vi.fn(),
  getProductReviews: dbMocks.getProductReviews,
  getPromoBanners: vi.fn(),
}));

import { productsRouter } from "./products";

const user = {
  id: 41,
  openId: "review-user",
  name: "Cliente",
  email: "cliente@example.com",
  role: "user",
  isVip: 0,
  isBlocked: 0,
  sessionVersion: 1,
  createdAt: new Date(),
  updatedAt: new Date(),
  lastSignedIn: new Date(),
} as any;

function createCaller() {
  return productsRouter.createCaller({ user, req: {} as any, res: {} as any });
}

function publicCaller() {
  return productsRouter.createCaller({ user: null, req: {} as any, res: {} as any } as any);
}

const validInput = {
  productId: 7,
  stockReservationId: 70,
  rating: 5,
  comment: "Produto muito confortável e acabamento excelente.",
  sizePerception: "true_to_size" as const,
};

describe("products.reviewCreate", () => {
  beforeEach(() => vi.clearAllMocks());

  it("derives user ownership from the authenticated context", async () => {
    dbMocks.createVerifiedProductReview.mockResolvedValue({ outcome: "created", id: 10 });
    await expect(createCaller().reviewCreate(validInput)).resolves.toEqual({ outcome: "created", id: 10 });
    expect(dbMocks.createVerifiedProductReview).toHaveBeenCalledWith({ ...validInput, userId: 41 });
  });

  it("rejects browser-controlled order and user identifiers", async () => {
    await expect(createCaller().reviewCreate({ ...validInput, orderId: 900 } as any)).rejects.toBeInstanceOf(TRPCError);
    await expect(createCaller().reviewCreate({ ...validInput, userId: 900 } as any)).rejects.toBeInstanceOf(TRPCError);
    expect(dbMocks.createVerifiedProductReview).not.toHaveBeenCalled();
  });

  it("keeps the selected purchase identifier but derives ownership from authentication", async () => {
    dbMocks.createVerifiedProductReview.mockResolvedValue({ outcome: "created", id: 11 });
    await createCaller().reviewCreate(validInput);
    expect(dbMocks.createVerifiedProductReview).toHaveBeenCalledWith({
      ...validInput,
      userId: 41,
    });
  });

  it("rejects a product without a paid and delivered purchase", async () => {
    dbMocks.createVerifiedProductReview.mockResolvedValue({ outcome: "not_eligible" });
    await expect(createCaller().reviewCreate(validInput)).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("rejects a second review for the same user and product", async () => {
    dbMocks.createVerifiedProductReview.mockResolvedValue({ outcome: "duplicate" });
    await expect(createCaller().reviewCreate(validInput)).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("rejects an image token not owned by this review", async () => {
    dbMocks.createVerifiedProductReview.mockResolvedValue({ outcome: "invalid_image" });
    await expect(createCaller().reviewCreate({ ...validInput, imageToken: "b9a741dd-7402-4599-b87c-9479aa43ea28" }))
      .rejects.toMatchObject({ code: "BAD_REQUEST" });
  });
});

describe("public product reviews hide restricted catalog rows", () => {
  beforeEach(() => vi.clearAllMocks());

  it.each(["Clã XIV Bis", "CLAN XIV-BIS", "[QA-STAGING] Fixture"])("returns NOT_FOUND for %s", async name => {
    dbMocks.getProductByIdWithDetails.mockResolvedValue({
      id: 7, name, variants: [{ sku: "QA-FIXTURE-M", price: 7990, stock: 9 }],
    });
    await expect(publicCaller().reviews(7)).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(dbMocks.getProductReviews).not.toHaveBeenCalled();
  });

  it("preserves review projection for an ordinary product", async () => {
    const response = { summary: { total: 0, average: 0 }, reviews: [] };
    dbMocks.getProductByIdWithDetails.mockResolvedValue({ id: 8, name: "Produto legítimo", variants: [{ sku: "REAL-M" }] });
    dbMocks.getProductReviews.mockResolvedValue(response);
    await expect(publicCaller().reviews(8)).resolves.toEqual(response);
  });
});
