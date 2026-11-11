import type { CartItem } from "../types/cart";
import type { Product } from "../types/product";

export const variant = (over: Partial<NonNullable<Product["variants"]>[number]> = {}) => ({
  id: 11, productId: 1, size: "M", color: "Preto", active: true, stock: 5, ...over,
});

export const product = (over: Partial<Product> = {}): Product => ({
  id: 1,
  name: "Camiseta Built for Adventure",
  price: 99.9,
  image: "/x.png",
  stock: 10,
  variantCatalogPresent: true,
  variants: [variant()],
  ...over,
});

export const cartItem = (over: Partial<CartItem> = {}): CartItem => ({
  product: product(),
  quantity: 1,
  variantId: 11,
  selectedOptions: { cor: "Preto", tamanho: "M" },
  addedAt: new Date(0),
  ...over,
});

export const seedCart = (items: CartItem[]) =>
  window.localStorage.setItem("loja-escoteira:cart", JSON.stringify(items));
