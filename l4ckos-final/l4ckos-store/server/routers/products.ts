import { batchAcceptsSales, batchHasCapacity } from "../../shared/preorder";
﻿import { z } from "zod";
import { router, publicProcedure, adminProcedure, protectedProcedure } from "../_core/trpc";
import {
  getProducts,
  getProductByIdWithDetails,
  getPublicProductVariants,
  createProduct,
  updateProduct,
  deleteProduct,
  createVerifiedProductReview,
  getEligibleReviewProducts,
  getProductReviews,
  getPromoBanners,
  getPublicHomeHighlights,
} from "../db";
import { TRPCError } from "@trpc/server";
import { createReviewInputSchema } from "../reviews/policy";
import { isRestrictedPublicPurchase, isStagingQaCatalogProduct } from "../database/publicPurchasePolicy";

export const productsRouter = router({
  promotions: publicProcedure.query(async () => {
    return await getPromoBanners({ activeOnly: true });
  }),

  homeHighlights: publicProcedure.query(async () => {
    const presentation = await getPublicHomeHighlights();
    return {
      displayMode: presentation.displayMode,
      rotationIntervalSeconds: presentation.rotationIntervalSeconds,
      campaigns: presentation.campaigns,
    };
  }),

  // Listar todos os produtos com filtros opcionais
  list: publicProcedure
    .input(
      z.object({
        category: z.string().trim().max(120).optional(),
        search: z.string().trim().max(120).optional(),
        minPrice: z.number().nonnegative().optional(),
        maxPrice: z.number().nonnegative().optional(),
        inStockOnly: z.boolean().optional(),
        sortBy: z.enum(["relevance", "price_asc", "price_desc", "name_asc", "name_desc"]).optional(),
        limit: z.number().optional().default(100),
      })
    )
    .query(async ({ input }) => {
      let products = await getProducts();

      if (input.category) {
        products = products.filter((p) => p.category === input.category);
      }

      if (input.search) {
        const term = input.search.toLowerCase();
        products = products.filter(
          (p) =>
            p.name.toLowerCase().includes(term) ||
            p.description?.toLowerCase().includes(term)
        );
      }

      if (input.minPrice !== undefined) {
        products = products.filter((p) => Number(p.price) >= input.minPrice!);
      }

      if (input.maxPrice !== undefined) {
        products = products.filter((p) => Number(p.price) <= input.maxPrice!);
      }

      if (input.inStockOnly) {
        products = products.filter(p => p.salesMode === "PREORDER"
          ? batchAcceptsSales(p.productionBatch) && batchHasCapacity(p.productionBatch) && (p.hasVariants !== true || p.hasSellableVariants === true)
          : p.hasVariants === true ? p.hasSellableVariants === true : Number(p.stock ?? 0) > 0);
      }

      if (input.sortBy && input.sortBy !== "relevance") {
        const sorted = [...products];
        if (input.sortBy === "price_asc") sorted.sort((a, b) => Number(a.price) - Number(b.price));
        if (input.sortBy === "price_desc") sorted.sort((a, b) => Number(b.price) - Number(a.price));
        if (input.sortBy === "name_asc") sorted.sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));
        if (input.sortBy === "name_desc") sorted.sort((a, b) => b.name.localeCompare(a.name, "pt-BR"));
        products = sorted;
      }

      return products.slice(0, input.limit);
    }),

  // Obter um produto especifico por ID com detalhes
  getById: publicProcedure.input(z.number()).query(async ({ input }) => {
    const product = await getProductByIdWithDetails(input);
    if (!product || isStagingQaCatalogProduct(product.name, product.variants)) {
      throw new TRPCError({ code: "NOT_FOUND", message: "Produto não encontrado." });
    }
    const { variants: _internalVariants, ...publicProduct } = product;
    return publicProduct;
  }),

  /** Preparatory catalog projection only; checkout/cart do not consume this endpoint yet. */
  sellableVariants: publicProcedure.input(z.number().int().positive()).query(async ({ input }) => {
    const result = await getPublicProductVariants(input);
    if (!result.product) throw new TRPCError({ code: "NOT_FOUND", message: "Produto não encontrado." });
    if (isStagingQaCatalogProduct(result.product.name, result.product.variants)) {
      throw new TRPCError({ code: "NOT_FOUND", message: "Produto não encontrado." });
    }
    if (isRestrictedPublicPurchase(result.product.name)) {
      return { productId: input, hasVariants: result.hasVariants, publicPurchaseAllowed: false as const, variants: [] as const };
    }
    if (!result.hasVariants) return { productId: input, hasVariants: false as const, publicPurchaseAllowed: true as const, variants: [] as const };
    const preorderAvailable = result.product.salesMode === "PREORDER"
      && batchAcceptsSales(result.product.productionBatch)
      && batchHasCapacity(result.product.productionBatch);
    const variants = result.variants
      .filter(variant => result.product!.salesMode === "PREORDER" ? preorderAvailable : variant.availableUnits !== null && variant.availableUnits > 0)
      .map(variant => ({
        variantId: variant.variantId,
        color: variant.color,
        size: variant.size,
        price: variant.price,
        available: true as const,
        availableUnits: variant.availableUnits,
      }));
    return { productId: input, hasVariants: true as const, publicPurchaseAllowed: true as const, variants };
  }),

  reviews: publicProcedure.input(z.number().int().positive()).query(async ({ input }) => {
    return await getProductReviews(input);
  }),

  reviewEligibility: protectedProcedure
    .input(z.object({ orderId: z.number().int().positive() }).strict().optional())
    .query(async ({ ctx, input }) => {
      return await getEligibleReviewProducts(ctx.user.id, input?.orderId);
    }),

  reviewCreate: protectedProcedure
    .input(createReviewInputSchema)
    .mutation(async ({ input, ctx }) => {
      try {
        const result = await createVerifiedProductReview({ ...input, userId: ctx.user.id });
        if (result.outcome === "not_eligible") {
          throw new TRPCError({
            code: "FORBIDDEN",
            message: "A avaliação é exclusiva para compras pagas e entregues desta conta.",
          });
        }
        if (result.outcome === "duplicate") {
          throw new TRPCError({
            code: "CONFLICT",
            message: "Você já avaliou este item desta compra.",
          });
        }
        if (result.outcome === "invalid_image") {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "A foto expirou ou não pertence a esta avaliação. Envie novamente.",
          });
        }
        return result;
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        const message = error instanceof Error ? error.message : "";
        if (/duplicate|unique|ER_DUP_ENTRY/i.test(message)) {
          throw new TRPCError({ code: "CONFLICT", message: "Você já avaliou este item desta compra." });
        }
        throw error;
      }
    }),

  // Criar novo produto (apenas admin)
  create: adminProcedure
    .input(
      z.object({
        name: z.string().min(1),
        category: z.string().min(1),
        price: z.number().positive(),
        description: z.string().optional(),
        fullDescription: z.string().optional(),
        imageUrl: z.string().optional(),
        imageThumbnailUrl: z.string().optional(),
        imageDetailUrl: z.string().optional(),
        imageBannerUrl: z.string().optional(),
        stock: z.number().optional().default(0),
      })
    )
    .mutation(async ({ input }) => {
      const result = await createProduct(input);
      return result;
    }),

  // Atualizar produto (apenas admin)
  update: adminProcedure
    .input(
      z.object({
        id: z.number(),
        name: z.string().optional(),
        category: z.string().optional(),
        price: z.number().optional(),
        description: z.string().optional(),
        fullDescription: z.string().optional(),
        imageUrl: z.string().optional(),
        imageThumbnailUrl: z.string().optional(),
        imageDetailUrl: z.string().optional(),
        imageBannerUrl: z.string().optional(),
        stock: z.number().optional(),
      })
    )
    .mutation(async ({ input }) => {
      const { id, ...data } = input;
      await updateProduct(id, data);
      return { success: true };
    }),

  // Deletar produto (apenas admin)
  delete: adminProcedure.input(z.number()).mutation(async ({ input }) => {
    await deleteProduct(input);
    return { success: true };
  }),
});
