// @vitest-environment jsdom
import "../test/setupDom";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../lib/trpc", async () => await import("../test/fakeTrpc"));

import { CartProvider } from "../contexts/CartContext";
import { cartItem, seedCart } from "../test/fixtures";
import { resetTrpc } from "../test/fakeTrpc";
import { catalogVariant, serveCatalog } from "../test/v6Catalog";
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

beforeEach(() => { resetTrpc(); serveCatalog(); });

describe("Carrinho (V6 cart + server availability)", () => {
  it("shows the empty state", () => {
    setup([]);
    expect(screen.getByText("SUA SACOLA ESTÁ VAZIA")).toBeTruthy();
  });

  it("links to checkout once the live catalog confirms every line", async () => {
    setup();
    expect(await screen.findByRole("link", { name: "Finalizar compra" })).toBeTruthy();
  });

  it("replaces the checkout link with a disabled, explained button when the live variant is sold out", async () => {
    serveCatalog({ variants: [catalogVariant({ availableUnits: 0 })] });
    setup();
    const blocked = await screen.findByRole("button", { name: "Item indisponível" });
    expect((blocked as HTMLButtonElement).disabled).toBe(true);
    expect(screen.queryByRole("link", { name: "Finalizar compra" })).toBeNull();
  });

  it("changes quantity within the server availability and removes a line", async () => {
    const user = setup([cartItem({ quantity: 1 })]);
    await screen.findByRole("link", { name: "Finalizar compra" });
    await user.click(screen.getByRole("button", { name: "+" }));
    expect(screen.getAllByText("2").length).toBeGreaterThan(0);
    await user.click(screen.getByRole("button", { name: "Remover item" }));
    await waitFor(() => expect(screen.getByText("SUA SACOLA ESTÁ VAZIA")).toBeTruthy());
  });

  it("does not let '+' exceed the live availability (no silent over-selection)", async () => {
    serveCatalog({ variants: [catalogVariant({ availableUnits: 1 })] });
    const user = setup([cartItem({ quantity: 1 })]);
    await screen.findByRole("link", { name: "Finalizar compra" });
    await user.click(screen.getByRole("button", { name: "+" }));
    await waitFor(() => expect(within(document.body).queryAllByText("2")).toHaveLength(0));
  });
});
