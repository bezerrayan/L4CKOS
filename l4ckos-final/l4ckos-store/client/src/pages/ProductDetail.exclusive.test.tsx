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
import { cartItem, product as fixtureProduct, seedCart, variant } from "../test/fixtures";
import type { ProductDropView, ViewerAccessView } from "../../../shared/exclusiveDropsV1";
import ProductDetail from "./ProductDetail";

const variants = [
  { id: 11, size: "M", color: "Preto", active: true, isActive: 1, stock: 9 },
  { id: 12, size: "G", color: "Preto", active: true, isActive: 1, stock: 9 },
];

function exclusive(viewer: ViewerAccessView, drop: Record<string, unknown> = {}): ProductDropView {
  return {
    exclusive: true,
    drop: {
      id: 7, slug: "xiv-bis", name: "Clã XIV Bis × L4CKOS", description: null, state: "active", timezone: "America/Sao_Paulo", requiresAuthorization: true,
      requestWindow: { startsAt: null, endsAt: null, open: true }, purchaseWindow: { startsAt: "2026-11-20T12:00:00.000Z", endsAt: "2026-11-30T15:00:00.000Z", open: true }, ...drop,
    } as never,
    viewer,
  };
}

const queryOptions = vi.fn();

function setup(drop: ProductDropView | { loading: true } | { error: true } = { exclusive: false }) {
  setTrpc("products.getById.useQuery", () => ({
    isLoading: false,
    data: {
      id: 1, name: "Camiseta Clã XIV Bis", description: "Edição exclusiva", price: 12900, stock: 18, category: "camisetas", imageUrl: "", images: [], optionColors: "[]", optionSizes: "[]", sizeType: "alpha",
      variants: variants.map(row => ({ ...row, productId: 1, sku: `SKU-${row.id}`, price: null })),
    },
  }));
  setTrpc("exclusiveDrops.forProduct.useQuery", (_input: unknown, options: unknown) => {
    queryOptions(options);
    return "loading" in drop ? { data: undefined, isLoading: true, error: null }
      : "error" in drop ? { data: undefined, isLoading: false, error: new Error("down") }
        : { data: drop, isLoading: false, error: null };
  });
  setTrpc("exclusiveDrops.requestAccess.useMutation", () => ({ mutateAsync: vi.fn(), isPending: false }));
  setTrpc("exclusiveDrops.redeemCode.useMutation", () => ({ mutateAsync: vi.fn(), isPending: false }));
  const user = userEvent.setup();
  render(
    <MemoryRouter initialEntries={["/produto/1"]}>
      <ToastProvider><CartProvider><Routes><Route path="/produto/:id" element={<ProductDetail />} /></Routes></CartProvider></ToastProvider>
    </MemoryRouter>,
  );
  return user;
}

const buy = () => screen.queryByRole("button", { name: "Comprar agora" });
const add = () => screen.queryByRole("button", { name: "Adicionar à sacola" });
const cartInStorage = () => JSON.parse(window.localStorage.getItem("loja-escoteira:cart") ?? "[]");

beforeEach(() => { resetTrpc(); queryOptions.mockReset(); });

describe("ProductDetail — exclusive drop states", () => {
  it("public product: normal purchase, no drop UI", () => {
    setup({ exclusive: false });
    expect(add()).toBeTruthy();
    expect(buy()).toBeTruthy();
    expect(screen.queryByText("Drop exclusivo")).toBeNull();
  });

  it("exclusive without access: the page stays visible (name, price, sizes) but the only action is 'Solicitar acesso'", async () => {
    const user = setup(exclusive({ status: "none" }));
    expect(screen.getByRole("heading", { name: /Camiseta Clã XIV Bis/ })).toBeTruthy();
    expect(screen.getByText("Drop exclusivo")).toBeTruthy();
    expect(screen.getByRole("button", { name: /Tamanho M/ })).toBeTruthy(); // sizes remain consultable
    expect(screen.getByRole("button", { name: "Solicitar acesso" })).toBeTruthy();
    expect(add()).toBeNull();
    expect(buy()).toBeNull();
    await user.keyboard("{Enter}");
    expect(cartInStorage()).toEqual([]);
  });

  it.each([
    ["pending", /Aguardando aprovação/],
    ["rejected", /não foi aprovada/],
    ["revoked", /não está mais disponível/],
    ["expired", /não está mais disponível/],
  ] as const)("%s: purchase controls are absent", (status, text) => {
    setup(exclusive({ status }));
    expect(screen.getAllByRole("status").some(node => text.test(node.textContent ?? ""))).toBe(true);
    expect(add()).toBeNull();
    expect(buy()).toBeNull();
  });

  it("approved but locked: asks for the individual code; no purchase yet", () => {
    setup(exclusive({ status: "approved", unitLimit: 3, unitsRemaining: 3 }));
    expect(screen.getByLabelText("Código individual")).toBeTruthy();
    expect(add()).toBeNull();
  });

  it("unlocked inside the window: purchase is available again, and the quantity can never exceed the remaining units", async () => {
    const user = setup(exclusive({ status: "unlocked", unitLimit: 3, unitsUsed: 1, unitsRemaining: 2 }));
    expect(screen.getByText(/até 2 unidades/)).toBeTruthy();
    expect(add()).toBeTruthy();
    const plus = screen.getByRole("button", { name: /Aumentar quantidade/ }) as HTMLButtonElement;
    await user.click(screen.getByRole("button", { name: /Tamanho M/ }));
    await user.click(plus);
    await user.click(plus);
    await user.click(plus);
    expect((screen.getByRole("button", { name: /Aumentar quantidade/ }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText(/Máximo disponível: 2 unidades/)).toBeTruthy();
  });

  it("closed drop: visible, but no purchase even for an unlocked viewer", () => {
    setup(exclusive({ status: "unlocked", unitsRemaining: 2 }, { state: "closed", purchaseWindow: { startsAt: "", endsAt: "2026-11-30T15:00:00.000Z", open: false } }));
    expect(screen.getByText(/Drop encerrado/)).toBeTruthy();
    expect(add()).toBeNull();
    expect(buy()).toBeNull();
  });

  it("while the exclusivity is still being checked, purchase controls are withheld (no flash of a buy button)", () => {
    setup({ loading: true });
    expect(add()).toBeNull();
    expect(buy()).toBeNull();
  });

  it("if the drop query fails the page still renders; the server (cart/checkout) remains the gate", () => {
    setup({ error: true });
    expect(screen.getByRole("heading", { name: /Camiseta Clã XIV Bis/ })).toBeTruthy();
  });

  it("shows the quota the SERVER reports, split into authorized / open orders / bought / available", () => {
    setup(exclusive({ status: "unlocked", unitLimit: 3, unitsUsed: 2, unitsReserved: 1, unitsConsumed: 1, unitsRemaining: 1 }));
    const quota = screen.getByLabelText("Sua cota neste drop");
    expect(quota.textContent).toContain("Autorizadas3");
    expect(quota.textContent).toContain("Em pedidos abertos1");
    expect(quota.textContent).toContain("Compradas1");
    expect(quota.textContent).toContain("Disponíveis1");
  });

  it("units already in the cart count against the remaining units: 2 in cart + 3 left = at most 1 more", async () => {
    seedCart([cartItem({ product: fixtureProduct({ variants: [variant({ id: 11, stock: 9 })] }), quantity: 2 })]);
    const user = setup(exclusive({ status: "unlocked", unitLimit: 3, unitsUsed: 0, unitsReserved: 0, unitsConsumed: 0, unitsRemaining: 3 }));
    expect(screen.getByText(/já tem 2 unidades deste produto na sacola/)).toBeTruthy();
    await user.click(screen.getByRole("button", { name: /Tamanho M/ }));
    const plus = screen.getByRole("button", { name: /Aumentar quantidade/ }) as HTMLButtonElement;
    expect(plus.disabled).toBe(true); // 1 is already the cap
    expect(screen.getByText(/Máximo disponível: 1 unidade/)).toBeTruthy();
  });

  it("when the cart already holds every authorized unit there is nothing to add (no buy button, link to the cart)", () => {
    seedCart([cartItem({ product: fixtureProduct({ variants: [variant({ id: 11, stock: 9 })] }), quantity: 3 })]);
    setup(exclusive({ status: "unlocked", unitLimit: 3, unitsUsed: 0, unitsRemaining: 3 }));
    expect(screen.getByText(/sacola já usa todas as unidades/)).toBeTruthy();
    expect(screen.getByRole("link", { name: "Ver sacola" })).toBeTruthy();
    expect(add()).toBeNull();
    expect(buy()).toBeNull();
  });

  it("re-reads the access status when the customer returns to the tab, and polls while a request is pending", () => {
    setup(exclusive({ status: "pending" }));
    const options = queryOptions.mock.calls[0][0] as { refetchOnWindowFocus: boolean; refetchInterval: (q: { state: { data: unknown } }) => number | false };
    expect(options.refetchOnWindowFocus).toBe(true);
    expect(options.refetchInterval({ state: { data: exclusive({ status: "pending" }) } })).toBe(30_000);
    expect(options.refetchInterval({ state: { data: exclusive({ status: "unlocked" }) } })).toBe(false);
    expect(options.refetchInterval({ state: { data: { exclusive: false } } })).toBe(false);
  });
});
