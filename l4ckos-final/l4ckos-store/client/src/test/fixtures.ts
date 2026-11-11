import type { CartItem, CartVariant } from "../types/cart";
import type { Product } from "../types/product";

/** V6 cart variant (server-resolved): the STOCK checkout reads `variantId` from here. */
export const variant = (over: Partial<CartVariant> = {}): CartVariant => ({
  variantId: 11, color: "Preto", size: "M", priceCents: 9990, availableUnits: 5, ...over,
});

export const product = (over: Partial<Product> = {}): Product => ({
  id: 1,
  name: "Camiseta Built for Adventure",
  price: 99.9,
  image: "/x.png",
  stock: 10,
  salesMode: "STOCK",
  ...over,
} as Product);

export const cartItem = (over: Partial<CartItem> = {}): CartItem => ({
  product: product(),
  quantity: 1,
  selectedOptions: { cor: "Preto", tamanho: "M" },
  variant: variant(),
  addedAt: new Date(0),
  ...over,
});

export const seedCart = (items: CartItem[]) =>
  window.localStorage.setItem("loja-escoteira:cart", JSON.stringify(items));
