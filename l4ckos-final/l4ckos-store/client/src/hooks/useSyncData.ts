/**
 * Hook para sincronizar dados entre localStorage e servidor
 * Roda automaticamente quando o usuário está autenticado
 */

import { useEffect } from "react";
import { useCart as useCartServer, useAddToCart, useRemoveFromCart } from "./useCart";
import { useAddFavorite, useRemoveFavorite, useFavoritesSync } from "./useFavoritesSync";
import { useUser } from "../contexts/UserContext";
import { useCart as useCartLocal } from "../contexts/CartContext";
import { useFavorites as useFavoritesLocal } from "../contexts/FavoritesContext";

export function useSyncData() {
  const { user, isAuthenticated } = useUser();
  const { cart } = useCartLocal();
  const { favorites } = useFavoritesLocal();

  // Queries do servidor
  const cartServerQuery = useCartServer({ enabled: isAuthenticated });
  const favoritesServerQuery = useFavoritesSync({ enabled: isAuthenticated });

  // Mutations
  const addToCartMutation = useAddToCart();
  const removeFromCartMutation = useRemoveFromCart();
  const addFavoriteMutation = useAddFavorite();
  const removeFavoriteMutation = useRemoveFavorite();

  // Sincronizar carrinho quando houver mudanças no localStorage
  useEffect(() => {
    if (!user || !cart.items.length) return;

    // Sincronizar itens do carrinho com o servidor
    if (cartServerQuery.data) {
      const serverIds = cartServerQuery.data.map((item: any) => item.productId);
      const localIds = cart.items.map((item) => item.product.id);

      // Adicionar itens que estão no localStorage mas não no servidor
      cart.items.forEach((item) => {
        if (!serverIds.includes(item.product.id)) {
          addToCartMutation.mutate({
            productId: item.product.id,
            quantity: item.quantity,
          });
        }
      });
    }
  }, [user, cart.items.length, cartServerQuery.data]);

  // Sincronizar favoritos quando houver mudanças no localStorage
  useEffect(() => {
    if (!user || !favorites.length) return;

    // Sincronizar favoritos com o servidor
    if (favoritesServerQuery.data) {
      const serverIds = favoritesServerQuery.data.map((fav: any) => fav.productId);

      // Adicionar favoritos que estão no localStorage mas não no servidor
      favorites.forEach((product) => {
        if (!serverIds.includes(product.id)) {
          addFavoriteMutation.mutate(product.id);
        }
      });

      // Remover favoritos que estão no servidor mas não no localStorage
      favoritesServerQuery.data.forEach((fav: any) => {
        if (!favorites.find((p) => p.id === fav.productId)) {
          removeFavoriteMutation.mutate(fav.productId);
        }
      });
    }
  }, [user, favorites.length, favoritesServerQuery.data]);
}
