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

type Row = { id: number; size: string; color: string; active: boolean; isActive: 0 | 1; stock: number };
const rows = (): Row[] => [
  { id: 11, size: "M", color: "Preto", active: true, isActive: 1, stock: 3 },
  { id: 12, size: "G", color: "Preto", active: true, isActive: 1, stock: 0 },
  { id: 13, size: "G", color: "Branco", active: true, isActive: 1, stock: 5 },
  { id: 14, size: "M", color: "Branco", active: false, isActive: 1, stock: 9 }, // API disagrees: `active` wins
];

function serve(variants: Row[]) {
  setTrpc("products.getById.useQuery", () => ({
    isLoading: false,
    data: {
      id: 1, name: "Camiseta Built for Adventure", description: "d", price: 9990, stock: 8, category: "camisetas",
      imageUrl: "", images: [], optionColors: "[]", optionSizes: "[]", sizeType: "alpha",
      variants: variants.map(row => ({ ...row, productId: 1, sku: `SKU-${row.id}`, price: null })),
    },
  }));
}

function setup(variants = rows()) {
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
const size = (name: RegExp) => screen.getByRole("button", { name }) as HTMLButtonElement;

beforeEach(() => resetTrpc());

describe("ProductDetail — variants", () => {
  it("treats a row as sellable only when `active` is true, even if `isActive` is 1", async () => {
    const user = setup();
    await user.click(color(/Selecionar cor Branco/));
    // Branco/M has isActive=1 but active=false → M is unavailable in Branco; G (active, stock 5) is fine.
    expect(size(/Tamanho M indisponível na cor Branco/).disabled).toBe(true);
    expect(size(/^Tamanho G$/).disabled).toBe(false);
  });

  it("selects size and color with aria-pressed", async () => {
    const user = setup();
    await user.click(color(/Selecionar cor Preto/));
    await user.click(size(/^Tamanho M$/));
    expect(color(/Selecionar cor Preto/).getAttribute("aria-pressed")).toBe("true");
    expect(size(/^Tamanho M$/).getAttribute("aria-pressed")).toBe("true");
  });

  it("disables a sold-out size for the chosen color and says why", async () => {
    const user = setup();
    await user.click(color(/Selecionar cor Preto/));
    const sold = size(/Tamanho G indisponível na cor Preto/);
    expect(sold.disabled).toBe(true);
    await user.click(sold);
    expect(sold.getAttribute("aria-pressed")).toBe("false");
  });

  it("disables colors that do not exist in the chosen size", async () => {
    const user = setup();
    await user.click(size(/^Tamanho M$/));
    // M exists only in Preto with stock (Branco/M is inactive).
    expect(color(/Cor Branco indisponível no tamanho M/).disabled).toBe(true);
    expect(color(/Selecionar cor Preto/).disabled).toBe(false);
  });

  it("supports keyboard selection (focus + Space/Enter)", async () => {
    const user = setup();
    const preto = color(/Selecionar cor Preto/);
    preto.focus();
    await user.keyboard("[Space]");
    expect(preto.getAttribute("aria-pressed")).toBe("true");
    size(/^Tamanho M$/).focus();
    await user.keyboard("{Enter}");
    expect(size(/^Tamanho M$/).getAttribute("aria-pressed")).toBe("true");
  });

  it("skips disabled options when tabbing", async () => {
    const user = setup();
    await user.click(color(/Selecionar cor Preto/));
    const sold = size(/Tamanho G indisponível/);
    for (let i = 0; i < 30; i += 1) {
      await user.tab();
      expect(document.activeElement).not.toBe(sold);
    }
  });
});

describe("ProductDetail — add to cart", () => {
  it("asks for size and color before adding", async () => {
    const user = setup();
    await user.click(screen.getByRole("button", { name: "Adicionar à sacola" }));
    expect(cartInStorage()).toEqual([]);
  });

  it("adds the real variantId and the chosen quantity", async () => {
    const user = setup();
    await user.click(color(/Selecionar cor Preto/));
    await user.click(size(/^Tamanho M$/));
    await user.click(screen.getByRole("button", { name: "Aumentar quantidade" }));
    await user.click(screen.getByRole("button", { name: "Adicionar à sacola" }));
    await waitFor(() => expect(cartInStorage()).toHaveLength(1));
    expect(cartInStorage()[0]).toMatchObject({ variantId: 11, quantity: 2, selectedOptions: { cor: "Preto", tamanho: "M" } });
  });

  it("bounds quantity by the selected variant stock", async () => {
    const user = setup();
    await user.click(color(/Selecionar cor Preto/));
    await user.click(size(/^Tamanho M$/)); // stock 3
    const plus = screen.getByRole("button", { name: "Aumentar quantidade" }) as HTMLButtonElement;
    await user.click(plus);
    await user.click(plus);
    expect((screen.getByRole("spinbutton", { name: "Quantidade" }) as HTMLInputElement).value).toBe("3");
    expect(plus.disabled).toBe(true);
    expect(screen.getByText(/Máximo disponível: 3 unidades/)).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Adicionar à sacola" }));
    await waitFor(() => expect(cartInStorage()[0].quantity).toBe(3));
  });

  it("clamps a typed quantity above stock", async () => {
    const user = setup();
    await user.click(color(/Selecionar cor Preto/));
    await user.click(size(/^Tamanho M$/));
    const input = screen.getByRole("spinbutton", { name: "Quantidade" }) as HTMLInputElement;
    await user.clear(input);
    await user.type(input, "50");
    expect(input.value).toBe("3");
  });

  it("shows unavailable and disables purchase when every variant is sold out", () => {
    setup(rows().map(row => ({ ...row, stock: 0 })));
    expect((screen.getByRole("button", { name: "Indisponível" }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: "Adicionar à sacola" }) as HTMLButtonElement).disabled).toBe(true);
  });
});
