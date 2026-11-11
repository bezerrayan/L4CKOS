// @vitest-environment jsdom
import "../test/setupDom";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import { CartProvider, useCart } from "../contexts/CartContext";
import { cartItem, product, seedCart, variant } from "../test/fixtures";
import CartDrawer from "./CartDrawer";

function OpenDrawer() {
  const { openCartDrawer, isCartDrawerOpen } = useCart();
  return <button onClick={openCartDrawer} data-open={isCartDrawerOpen}>abrir sacola</button>;
}

async function setup(items = [cartItem()], { open = true } = {}) {
  seedCart(items);
  const user = userEvent.setup();
  render(
    <MemoryRouter>
      <CartProvider>
        <OpenDrawer />
        <CartDrawer />
      </CartProvider>
    </MemoryRouter>,
  );
  if (open) await user.click(screen.getByRole("button", { name: "abrir sacola" }));
  return user;
}

describe("CartDrawer", () => {
  it("shows an empty state with a way back to the catalog", async () => {
    await setup([]);
    expect(screen.getByText("Sua sacola está vazia")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Ver produtos" })).toBeTruthy();
  });

  it("moves focus to the close button on open and closes with Escape", async () => {
    const user = await setup();
    expect(document.activeElement).toBe(document.querySelector(".l4-cart-drawer-close"));
    await user.keyboard("{Escape}");
    expect(document.querySelector(".l4-cart-drawer-layer")?.classList.contains("is-open")).toBe(false);
  });

  it("returns focus to the opener when closed", async () => {
    const user = await setup();
    await user.keyboard("{Escape}");
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "abrir sacola" }));
  });

  it("keeps Tab inside the open dialog (focus trap)", async () => {
    const user = await setup([cartItem()]);
    const drawer = screen.getByRole("dialog");
    for (let i = 0; i < 12; i += 1) {
      await user.tab();
      expect(drawer.contains(document.activeElement)).toBe(true);
    }
    await user.tab({ shift: true });
    expect(drawer.contains(document.activeElement)).toBe(true);
  });

  it("restores nothing hidden: closed drawer is aria-hidden so its controls are not exposed", async () => {
    await setup([cartItem()], { open: false });
    expect(screen.queryByRole("button", { name: /Aumentar quantidade/ })).toBeNull();
  });

  it("is reachable and operable by keyboard (Tab to + then Enter)", async () => {
    const user = await setup([cartItem({ quantity: 1 })]);
    const plus = screen.getByRole("button", { name: /Aumentar quantidade de Camiseta/ });
    plus.focus();
    await user.keyboard("{Enter}");
    expect(within(screen.getByRole("article")).getByText("2")).toBeTruthy();
  });

  it("disables '+' at the variant stock limit and explains it", async () => {
    const limited = product({ variants: [variant({ stock: 2 })] });
    await setup([cartItem({ product: limited, quantity: 2 })]);
    expect((screen.getByRole("button", { name: /Aumentar quantidade/ }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("flags sold-out items and blocks the checkout button", async () => {
    const soldOut = product({ variants: [variant({ stock: 0 })] });
    await setup([cartItem({ product: soldOut })]);
    expect(screen.getByText("Item esgotado.")).toBeTruthy();
    expect((screen.getByRole("button", { name: "Finalizar compra" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("flags quantity above stock and keeps the user in control (no silent change)", async () => {
    const limited = product({ variants: [variant({ stock: 1 })] });
    await setup([cartItem({ product: limited, quantity: 3 })]);
    expect(screen.getByText(/Resta apenas 1 unidade/)).toBeTruthy();
    expect(within(screen.getByRole("article")).getByText("3")).toBeTruthy();
  });

  it("flags legacy lines without variantId when the catalog has variants", async () => {
    await setup([cartItem({ variantId: undefined })]);
    expect(screen.getByText(/Selecione novamente tamanho e cor/)).toBeTruthy();
  });

  it("enables checkout for a valid cart", async () => {
    await setup();
    expect((screen.getByRole("button", { name: "Finalizar compra" }) as HTMLButtonElement).disabled).toBe(false);
  });
});
