// @vitest-environment jsdom
import "../test/setupDom";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../lib/trpc", async () => await import("../test/fakeTrpc"));

import { CartProvider } from "../contexts/CartContext";
import { cartItem, product, seedCart, variant } from "../test/fixtures";
import { resetTrpc, setTrpc } from "../test/fakeTrpc";
import Carrinho from "./Carrinho";

function setup(items = [cartItem()]) {
  seedCart(items);
  const user = userEvent.setup();
  render(
    <MemoryRouter>
      <CartProvider>
        <Carrinho />
      </CartProvider>
    </MemoryRouter>,
  );
  return user;
}

beforeEach(() => resetTrpc());

describe("Carrinho", () => {
  it("shows the empty state", () => {
    setup([]);
    expect(screen.getByText("SUA SACOLA ESTÁ VAZIA")).toBeTruthy();
  });

  it("increments and decrements with labelled, keyboard-operable buttons", async () => {
    const user = setup([cartItem({ quantity: 1 })]);
    const row = () => screen.getByText("Camiseta Built for Adventure").closest("div")!.parentElement!;
    const plus = screen.getByRole("button", { name: /Aumentar quantidade de Camiseta/ });
    plus.focus();
    await user.keyboard("{Enter}");
    expect(screen.getByLabelText("Quantidade: 2")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: /Diminuir quantidade de Camiseta/ }));
    expect(screen.getByLabelText("Quantidade: 1")).toBeTruthy();
    expect(row()).toBeTruthy();
  });

  it("disables '-' at 1 and '+' at the variant stock limit", async () => {
    const limited = product({ variants: [variant({ stock: 2 })] });
    const user = setup([cartItem({ product: limited, quantity: 1 })]);
    const minus = screen.getByRole("button", { name: /Diminuir quantidade/ }) as HTMLButtonElement;
    const plus = screen.getByRole("button", { name: /Aumentar quantidade/ }) as HTMLButtonElement;
    expect(minus.disabled).toBe(true);
    await user.click(plus);
    expect(screen.getByLabelText("Quantidade: 2")).toBeTruthy();
    expect(plus.disabled).toBe(true);
    await user.click(plus);
    expect(screen.getByLabelText("Quantidade: 2")).toBeTruthy();
  });

  it("never exceeds the backend cap of 99 per line", async () => {
    const big = product({ variants: [variant({ stock: 500 })] });
    const user = setup([cartItem({ product: big, quantity: 98 })]);
    const plus = screen.getByRole("button", { name: /Aumentar quantidade/ }) as HTMLButtonElement;
    await user.click(plus);
    expect(screen.getByLabelText("Quantidade: 99")).toBeTruthy();
    expect(plus.disabled).toBe(true);
  });

  it("announces sold-out items and replaces the checkout link with a disabled button", () => {
    const soldOut = product({ variants: [variant({ stock: 0 })] });
    setup([cartItem({ product: soldOut })]);
    expect(screen.getAllByRole("alert").some(node => node.textContent === "Item esgotado.")).toBe(true);
    expect(screen.queryByRole("link", { name: "Finalizar compra" })).toBeNull();
    expect((screen.getByRole("button", { name: "Finalizar compra" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("links to checkout when every line is purchasable", () => {
    setup();
    expect(screen.getByRole("link", { name: "Finalizar compra" }).getAttribute("href")).toBe("/checkout");
  });

  it("refreshes stock from the backend catalog (price/stock follow the server)", async () => {
    // Snapshot says 5 in stock; backend now says 1.
    setTrpc("utils.products.getById.fetch", async (id: number) => ({
      id, price: 9990, stock: 1,
      variants: [{ id: 11, productId: 1, size: "M", color: "Preto", active: true, isActive: 1, stock: 1 }],
    }));
    setup([cartItem({ quantity: 3 })]);
    expect(await screen.findByText(/Resta apenas 1 unidade/)).toBeTruthy();
  });

  it("enforces stock per variant, not per product: M has 1 unit, G has 5 in the same product", async () => {
    const both = product({ stock: 6, variants: [variant({ id: 11, size: "M", stock: 1 }), variant({ id: 12, size: "G", stock: 5 })] });
    const lineM = cartItem({ product: both, variantId: 11, quantity: 1, selectedOptions: { cor: "Preto", tamanho: "M" } });
    const lineG = cartItem({ product: both, variantId: 12, quantity: 1, selectedOptions: { cor: "Preto", tamanho: "G" } });
    const user = setup([lineM, lineG]);
    const [plusM, plusG] = screen.getAllByRole("button", { name: /Aumentar quantidade/ }) as HTMLButtonElement[];
    expect(plusM.disabled).toBe(true);
    expect(plusG.disabled).toBe(false);
    await user.click(plusG);
    expect(screen.getAllByRole("button", { name: /Aumentar quantidade/ })[0]).toHaveProperty("disabled", true);
  });

  it("removes a line", async () => {
    const user = setup();
    await user.click(screen.getByRole("button", { name: /Remover Camiseta/ }));
    expect(screen.getByText("SUA SACOLA ESTÁ VAZIA")).toBeTruthy();
    expect(within(document.body).queryByText("Camiseta Built for Adventure")).toBeNull();
  });
});
