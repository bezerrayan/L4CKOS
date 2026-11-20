import { trpc } from "../lib/trpc";

/**
 * Hook para listar favoritos do usuário
 */
export function useFavoritesSync(options?: { enabled?: boolean }) {
  // `favorites.list` is a protected procedure: callers pass `enabled: false` for anonymous visitors so it is never requested (401).
  return trpc.favorites.list.useQuery(undefined, { enabled: options?.enabled ?? true });
}

/**
 * Hook para adicionar favorito
 */
export function useAddFavorite() {
  return trpc.favorites.add.useMutation();
}

/**
 * Hook para remover favorito
 */
export function useRemoveFavorite() {
  return trpc.favorites.remove.useMutation();
}

/**
 * Hook para verificar se um produto é favorito
 */
export function useIsFavorite(productId: number) {
  return trpc.favorites.isFavorite.useQuery(productId, {
    enabled: !!productId,
  });
}
