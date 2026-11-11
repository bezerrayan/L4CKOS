// @vitest-environment jsdom
import "../test/setupDom";
import { render, screen, waitFor } from "@testing-library/react";
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

type Sellable = { variantId: number; color: string; size: string; price: number; availableUnits: number | null; available: true };
// What the public `products.sellableVariants` procedure returns: only sellable rows (inactive and sold-out rows never reach the client).
const catalog = (): Sellable[] => [
  { variantId: 11, color: "Preto", size: "M", price: 9990, availableUnits: 3, available: true },
  { variantId: 13, color: "Preto", size: "G", price: 9990, availableUnits: 5, available: true },
  { variantId: 14, color: "Branco", size: "G", price: 9990, availableUnits: 5, available: true },
];

function serve(variants: Sellable[]) {
  setTrpc("products.getById.useQuery", () => ({
    isLoading: false,
    data: {
      id: 1, name: "Camiseta Built for Adventure", description: "d", price: 9990, stock: 8, category: "camisetas",
      imageUrl: "", images: [], optionColors: "[]", optionSizes: "[]", sizeType: "alpha", salesMode: "STOCK", productionBatch: null,
    },
  }));
  setTrpc("products.sellableVariants.useQuery", () => ({
    isLoading: false,
    data: { productId: 1, hasVariants: true, publicPurchaseAllowed: true, variants },
  }));
}

function setup(variants = catalog()) {
  serve(variants);
  const user = userEvent.setup();
  render(
    <MemoryRouter initialEntries={["/produto/1"]}>
      <ToastProvider>
        <CartProvider>
          <Routes><Route path="/produto/:id" element={<ProductDetail />} /></Routes>
        </CartProvider>
      </ToastProvider>
    </MemoryRouter>,
  );
  return user;
}

const cartInStorage = () => JSON.parse(window.localStorage.getItem("loja-escoteira:cart") ?? "[]");
const color = (name: RegExp) => screen.getByRole("button", { name }) as HTMLButtonElement;
const size = (label: string) => screen.getByRole("button", { name: label }) as HTMLButtonElement;

beforeEach(() => resetTrpc());

describe("ProductDetail — variants (V6 UI over the server's sellable catalog)", () => {
  it("offers only the colors and sizes the server lists as sellable", async () => {
    const user = setup();
    expect(color(/Selecionar cor Preto/)).toBeTruthy();
    expect(color(/Selecionar cor Branco/)).toBeTruthy();
    await user.click(color(/Selecionar cor Branco/));
    // Branco exists only in G: M (sold out / inactive on the server) is not offered at all.
    expect(screen.queryByRole("button", { name: "M" })).toBeNull();
    expect(size("G")).toBeTruthy();
  });

  it("selects size and color with aria-pressed", async () => {
    const user = setup();
    await user.click(color(/Selecionar cor Preto/));
    await user.click(size("M"));
    expect(color(/Selecionar cor Preto/).getAttribute("aria-pressed")).toBe("true");
    expect(size("M").getAttribute("aria-pressed")).toBe("true");
  });

  it("drops a selected size that does not exist in the newly chosen color", async () => {
    const user = setup();
    await user.click(color(/Selecionar cor Preto/));
    await user.click(size("M"));
    await user.click(color(/Selecionar cor Branco/));
    expect(screen.getByText("Nenhum tamanho")).toBeTruthy();
    expect((screen.getByRole("button", { name: "Adicionar à sacola" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("supports keyboard selection (focus + Space/Enter)", async () => {
    const user = setup();
    const preto = color(/Selecionar cor Preto/);
    preto.focus();
    await user.keyboard("[Space]");
    expect(preto.getAttribute("aria-pressed")).toBe("true");
    size("M").focus();
    await user.keyboard("{Enter}");
    expect(size("M").getAttribute("aria-pressed")).toBe("true");
  });
});

describe("ProductDetail — add to cart", () => {
  it("does not add anything before size and color are chosen", async () => {
    const user = setup();
    await user.click(screen.getByRole("button", { name: "Adicionar à sacola" }));
    expect(cartInStorage()).toEqual([]);
  });

  it("adds the real variantId and the chosen quantity", async () => {
    const user = setup();
    await user.click(color(/Selecionar cor Preto/));
    await user.click(size("M"));
    await user.click(screen.getByRole("button", { name: "Aumentar quantidade" }));
    await user.click(screen.getByRole("button", { name: "Adicionar à sacola" }));
    await waitFor(() => expect(cartInStorage()).toHaveLength(1));
    expect(cartInStorage()[0]).toMatchObject({ variant: { variantId: 11, color: "Preto", size: "M", priceCents: 9990, availableUnits: 3 }, quantity: 2, selectedOptions: { cor: "Preto", tamanho: "M" } });
  });

  it("bounds quantity by the selected variant's available units", async () => {
    const user = setup();
    await user.click(color(/Selecionar cor Preto/));
    await user.click(size("M")); // 3 units
    const plus = screen.getByRole("button", { name: "Aumentar quantidade" }) as HTMLButtonElement;
    await user.click(plus);
    await user.click(plus);
    await user.click(plus);
    expect((screen.getByRole("spinbutton", { name: "Quantidade" }) as HTMLInputElement).value).toBe("3");
    expect(screen.getByText(/Máximo disponível: 3 unidades/)).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Adicionar à sacola" }));
    await waitFor(() => expect(cartInStorage()[0].quantity).toBe(3));
  });

  it("clamps a typed quantity above the available units", async () => {
    const user = setup();
    await user.click(color(/Selecionar cor Preto/));
    await user.click(size("M"));
    const input = screen.getByRole("spinbutton", { name: "Quantidade" }) as HTMLInputElement;
    await user.clear(input);
    await user.type(input, "50");
    expect(input.value).toBe("3");
  });

  it("shows unavailable and disables purchase when the server lists no sellable variant", () => {
    setup([]);
    expect((screen.getByRole("button", { name: "Indisponível" }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: "Adicionar à sacola" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("blocks purchase entirely when the server says public purchase is not allowed", () => {
    serve(catalog());
    setTrpc("products.sellableVariants.useQuery", () => ({ isLoading: false, data: { productId: 1, hasVariants: true, publicPurchaseAllowed: false, variants: [] } }));
    render(
      <MemoryRouter initialEntries={["/produto/1"]}>
        <ToastProvider><CartProvider><Routes><Route path="/produto/:id" element={<ProductDetail />} /></Routes></CartProvider></ToastProvider>
      </MemoryRouter>,
    );
    expect((screen.getByRole("button", { name: "Adicionar à sacola" }) as HTMLButtonElement).disabled).toBe(true);
  });
});
