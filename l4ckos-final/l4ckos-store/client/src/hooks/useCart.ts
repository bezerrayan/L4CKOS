import { trpc } from "../lib/trpc";

/**
 * Hook para listar itens do carrinho
 */
export function useCart(options?: { enabled?: boolean }) {
  // `cart.list` is a protected procedure: callers pass `enabled: false` for anonymous visitors so it is never requested (401).
  return trpc.cart.list.useQuery(undefined, { enabled: options?.enabled ?? true });
}

/**
 * Hook para adicionar item ao carrinho
 */
export function useAddToCart() {
  return trpc.cart.add.useMutation();
}

/**
 * Hook para remover item do carrinho
 */
export function useRemoveFromCart() {
  return trpc.cart.remove.useMutation();
}

/**
 * Hook para limpar carrinho
 */
export function useClearCart() {
  return trpc.cart.clear.useMutation();
}
