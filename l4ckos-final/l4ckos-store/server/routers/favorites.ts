import { z } from "zod";
import { router, protectedProcedure } from "../_core/trpc";
import { getFavorites, addFavorite, removeFavorite, getProductByIdWithDetails } from "../db";
import { isPublicProductUnavailable } from "../database/publicPurchasePolicy";
import { TRPCError } from "@trpc/server";

export const favoritesRouter = router({
  list: protectedProcedure.query(async ({ ctx }) => {
    const favorites = await getFavorites(ctx.user.id);

    const enrichedFavorites = await Promise.all(
      favorites.map(async fav => {
        const product = await getProductByIdWithDetails(fav.productId);
        if (!product || isPublicProductUnavailable(product.name, product.variants)) return null;
        const { variants: _variants, images: _images, productionBatch: _batch, ...publicProduct } = product;
        return {
          ...fav,
          product: publicProduct,
        };
      }),
    );

    return enrichedFavorites.filter((favorite): favorite is NonNullable<typeof favorite> => favorite !== null);
  }),

  add: protectedProcedure
    .input(z.number().int().positive())
    .mutation(async ({ input, ctx }) => {
      const product = await getProductByIdWithDetails(input);
      if (!product || isPublicProductUnavailable(product.name, product.variants)) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Produto não encontrado." });
      }
      await addFavorite(ctx.user.id, input);
      return { success: true };
    }),

  remove: protectedProcedure
    .input(z.number().int().positive())
    .mutation(async ({ input, ctx }) => {
      await removeFavorite(ctx.user.id, input);
      return { success: true };
    }),

  isFavorite: protectedProcedure
    .input(z.number().int().positive())
    .query(async ({ input, ctx }) => {
      const product = await getProductByIdWithDetails(input);
      if (!product || isPublicProductUnavailable(product.name, product.variants)) return false;
      const favorites = await getFavorites(ctx.user.id);
      const isFav = favorites.some(fav => fav.productId === input);
      return isFav;
    }),
});
