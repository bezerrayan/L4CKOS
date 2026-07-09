import { z } from "zod";
import { router, publicProcedure, adminProcedure, protectedProcedure } from "../_core/trpc";
import {
  getProducts,
  getProductByIdWithDetails,
  createProduct,
  updateProduct,
  deleteProduct,
  createOrUpdateProductReview,
  getProductReviews,
  getPromoBanners,
} from "../db";

export const productsRouter = router({
  promotions: publicProcedure.query(async () => {
    return await getPromoBanners({ activeOnly: true });
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
        products = products.filter((p) => Number(p.stock ?? 0) > 0);
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
    if (!product) {
      throw new Error("Produto nao encontrado");
    }
    return product;
  }),

  reviews: publicProcedure.input(z.number().int().positive()).query(async ({ input }) => {
    return await getProductReviews(input);
  }),

  reviewUpsert: protectedProcedure
    .input(
      z.object({
        productId: z.number().int().positive(),
        rating: z.number().int().min(1).max(5),
        comment: z.string().max(1000).optional(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      return await createOrUpdateProductReview({
        productId: input.productId,
        userId: ctx.user.id,
        rating: input.rating,
        comment: input.comment,
      });
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
