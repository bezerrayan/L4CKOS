import { z } from "zod";
import { router, protectedProcedure } from "../_core/trpc";
import { getCartItems, addToCart, removeFromCartByUser, clearCart, getProductById } from "../db";
import { assertCanAddToServerCart } from "../exclusive/checkoutGuard";

export const cartRouter = router({
  // Listar itens do carrinho do usuário autenticado
  list: protectedProcedure.query(async ({ ctx }) => {
    const items = await getCartItems(ctx.user.id);

    // Enriquecer os itens com informações do produto
    const enrichedItems = await Promise.all(
      items.map(async (item) => {
        const product = await getProductById(item.productId);
        return {
          ...item,
          product,
        };
      })
    );

    return enrichedItems;
  }),

  // Adicionar item ao carrinho
  add: protectedProcedure
    .input(
        z.object({
        productId: z.number().int().positive(),
        quantity: z.number().int().positive().max(99),
      })
    )
    .mutation(async ({ input, ctx }) => {
      // Exclusive products need an unlocked, in-quota authorization even to enter the server cart (checkout re-verifies).
      await assertCanAddToServerCart({ userId: ctx.user.id, productId: input.productId, quantity: input.quantity });
      await addToCart(ctx.user.id, input.productId, input.quantity);
      return { success: true };
    }),

  // Remover item do carrinho
  remove: protectedProcedure
    .input(z.number().int().positive())
    .mutation(async ({ input, ctx }) => {
      await removeFromCartByUser(ctx.user.id, input);
      return { success: true };
    }),

  // Limpar carrinho completamente
  clear: protectedProcedure.mutation(async ({ ctx }) => {
    await clearCart(ctx.user.id);
    return { success: true };
  }),
});
