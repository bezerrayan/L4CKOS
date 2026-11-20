// @vitest-environment jsdom
import "../test/setupDom";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../lib/trpc", async () => await import("../test/fakeTrpc"));
vi.mock("../lib/csrf", () => ({ csrfFetch: vi.fn(), getCsrfToken: vi.fn() }));
vi.mock("../components/reviews/ProductReviews", () => ({ ProductReviews: () => null }));
vi.mock("../contexts/FavoritesContext", () => ({
  useFavorites: () => ({ addToFavorites: vi.fn(), removeFromFavorites: vi.fn(), isFavorited: () => false }),
}));

import { CartProvider } from "../contexts/CartContext";
import { ToastProvider } from "../contexts/ToastContext";
import { resetTrpc, setTrpc } from "../test/fakeTrpc";
import ProductDetail from "./ProductDetail";

const product = { id: 1, name: "Camiseta Built for Adventure", description: "d", price: 9990, stock: 8, category: "camisetas", imageUrl: "", images: [], optionColors: "[]", optionSizes: "[]", sizeType: "alpha", salesMode: "STOCK", productionBatch: null };
const sellable = [{ variantId: 11, color: "Preto", size: "M", price: 9990, availableUnits: 3, available: true }];

function render_(catalog: unknown) {
  setTrpc("products.getById.useQuery", () => ({ isLoading: false, data: product }));
  setTrpc("products.sellableVariants.useQuery", () => catalog === "error"
    ? { isLoading: false, isError: true, error: { data: { code: "INTERNAL_SERVER_ERROR" } }, data: undefined }
    : { isLoading: false, data: catalog });
  render(
    <MemoryRouter initialEntries={["/produto/1"]}>
      <ToastProvider><CartProvider>
        <Routes><Route path="/produto/:id" element={<ProductDetail />} /><Route path="/checkout" element={<p>PAGINA-CHECKOUT</p>} /></Routes>
      </CartProvider></ToastProvider>
    </MemoryRouter>,
  );
}
const cartInStorage = () => JSON.parse(window.localStorage.getItem("loja-escoteira:cart") ?? "[]");

beforeEach(() => resetTrpc());

describe("ProductDetail — purchase states communicated to the customer", () => {
  it("does not call an in-stock product 'Indisponível' just because color and size were not chosen yet", async () => {
    render_({ productId: 1, hasVariants: true, publicPurchaseAllowed: true, variants: sellable });
    const buy = screen.getByRole("button", { name: /Comprar agora/ }) as HTMLButtonElement;
    expect(buy.disabled).toBe(false);
    expect(screen.queryByRole("button", { name: "Indisponível" })).toBeNull();
  });

  it("asks for color and size when the customer tries to buy without choosing, and adds nothing", async () => {
    const user = userEvent.setup();
    render_({ productId: 1, hasVariants: true, publicPurchaseAllowed: true, variants: sellable });
    await user.click(screen.getByRole("button", { name: /Adicionar à sacola/ }));
    expect(await screen.findAllByText(/Selecione cor e tamanho antes de adicionar/)).not.toHaveLength(0);
    expect(cartInStorage()).toEqual([]);
  });

  it.each([
    ["Adicionar à sacola", /Adicionar à sacola/],
    ["Comprar agora", /Comprar agora/],
  ])("%s with nothing or only part selected never adds an item and never goes to checkout", async (_label, name) => {
    const user = userEvent.setup();
    render_({ productId: 1, hasVariants: true, publicPurchaseAllowed: true, variants: sellable });
    await user.click(screen.getByRole("button", { name }));
    expect(cartInStorage()).toEqual([]);
    await user.click(screen.getByRole("button", { name: /Selecionar cor Preto/ }));
    await user.click(screen.getByRole("button", { name }));
    expect(cartInStorage()).toEqual([]);
    expect(screen.queryByText("PAGINA-CHECKOUT")).toBeNull();
    // Completing the selection adds exactly the chosen variant (control).
    await user.click(screen.getByRole("button", { name: "M" }));
    await user.click(screen.getByRole("button", { name }));
    expect(cartInStorage()).toHaveLength(1);
    expect(cartInStorage()[0].variant.variantId).toBe(11);
  });

  it("keeps a sold-out product 'Indisponível' and disabled (no sellable variant)", () => {
    render_({ productId: 1, hasVariants: true, publicPurchaseAllowed: true, variants: [] });
    expect((screen.getByRole("button", { name: "Indisponível" }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.queryByRole("button", { name: /Comprar agora/ })).toBeNull();
  });

  it("keeps a restricted (not publicly purchasable) product 'Indisponível' and disabled", () => {
    render_({ productId: 1, hasVariants: true, publicPurchaseAllowed: false, variants: [] });
    expect((screen.getByRole("button", { name: "Indisponível" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("explains that availability could not be verified when the variants request fails (no misleading stock text)", () => {
    render_("error");
    expect(screen.getByText(/Não foi possível verificar a disponibilidade/)).toBeTruthy();
    expect(screen.queryByText(/Estoque reduzido|Disponível para compra/)).toBeNull();
    expect((screen.getByRole("button", { name: "Indisponível" }) as HTMLButtonElement).disabled).toBe(true);
  });
});
