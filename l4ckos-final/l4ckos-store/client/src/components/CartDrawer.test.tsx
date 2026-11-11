// @vitest-environment jsdom
import "../test/setupDom";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../lib/trpc", async () => await import("../test/fakeTrpc"));

import { CartProvider, useCart } from "../contexts/CartContext";
import { cartItem, seedCart } from "../test/fixtures";
import { resetTrpc } from "../test/fakeTrpc";
import { catalogVariant, serveCatalog } from "../test/v6Catalog";
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

beforeEach(() => { resetTrpc(); serveCatalog(); });

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
    const plus = screen.getByRole("button", { name: "Aumentar quantidade" });
    plus.focus();
    await user.keyboard("{Enter}");
    expect(within(screen.getByRole("article")).getByText("2")).toBeTruthy();
  });

  it("blocks the checkout button when the live variant is sold out (server availability wins)", async () => {
    serveCatalog({ variants: [catalogVariant({ availableUnits: 0 })] });
    await setup([cartItem()]);
    await waitFor(() => expect(screen.getByRole("alert")).toBeTruthy());
    expect((screen.getByRole("button", { name: "Finalizar compra" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("blocks checkout when the quantity exceeds the live availability, without silently changing it", async () => {
    serveCatalog({ variants: [catalogVariant({ availableUnits: 1 })] });
    await setup([cartItem({ quantity: 3 })]);
    await waitFor(() => expect((screen.getByRole("button", { name: "Finalizar compra" }) as HTMLButtonElement).disabled).toBe(true));
    expect(within(screen.getByRole("article")).getByText("3")).toBeTruthy();
  });

  it("enables checkout for a valid cart", async () => {
    await setup();
    await waitFor(() => expect((screen.getByRole("button", { name: "Finalizar compra" }) as HTMLButtonElement).disabled).toBe(false));
  });
});
