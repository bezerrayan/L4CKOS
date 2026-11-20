// @vitest-environment jsdom
import "../test/setupDom";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

const session = vi.hoisted(() => ({ user: null as null | { id: number; name: string; email: string; role: string } }));
const csrfFetch = vi.hoisted(() => vi.fn());
const create = vi.hoisted(() => vi.fn());
const charge = vi.hoisted(() => vi.fn());

vi.mock("../lib/trpc", async () => await import("../test/fakeTrpc"));
vi.mock("../lib/csrf", () => ({ csrfFetch, getCsrfToken: vi.fn() }));
vi.mock("../contexts/UserContext", () => ({
  useUser: () => ({ user: session.user, isAuthenticated: Boolean(session.user), isLoading: false }),
}));

import { CartProvider } from "../contexts/CartContext";
import { resetTrpc, setTrpc } from "../test/fakeTrpc";
import { serveCatalog } from "../test/v6Catalog";
import { cartItem, product, seedCart, variant } from "../test/fixtures";
import Pagamento from "./Pagamento";

const CART_KEY = "loja-escoteira:cart";

function Probe() {
  return null;
}

function mount(items = [cartItem()]) {
  seedCart(items);
  const user = userEvent.setup();
  const view = render(
    <MemoryRouter initialEntries={["/checkout"]}>
      <CartProvider><Pagamento /><Probe /></CartProvider>
    </MemoryRouter>,
  );
  return { user, ...view };
}

beforeEach(() => {
  window.localStorage.clear();
  resetTrpc(); serveCatalog();
  create.mockReset(); charge.mockReset(); csrfFetch.mockReset();
  csrfFetch.mockResolvedValue({ ok: true, status: 200, json: async () => ({ options: [] }) });
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, status: 200, json: async () => ({}) })));
  setTrpc("stockCheckout.create.useMutation", () => ({ mutateAsync: create, isPending: false, error: null }));
  setTrpc("orders.createAsaasCharge.useMutation", () => ({ mutateAsync: charge, isPending: false, error: null }));
  setTrpc("stockCheckout.resumeLatest.useQuery", () => ({ data: undefined, isLoading: false, error: null, refetch: vi.fn() }));
});

describe("Pagamento — anonymous visitor", () => {
  it("shows a clear sign-in / sign-up call to action that returns to /checkout", async () => {
    session.user = null;
    mount();
    const region = await screen.findByRole("region", { name: /entre para finalizar/i });
    const login = within(region).getByRole("link", { name: /^entrar$/i });
    const signup = within(region).getByRole("link", { name: /criar conta/i });
    expect(login.getAttribute("href")).toBe("/login?next=%2Fcheckout");
    expect(signup.getAttribute("href")).toBe("/cadastro?next=%2Fcheckout");
  });

  it("is reachable by keyboard (links are focusable, in tab order, before the form fields)", async () => {
    session.user = null;
    const { user } = mount();
    const region = await screen.findByRole("region", { name: /entre para finalizar/i });
    const login = within(region).getByRole("link", { name: /^entrar$/i });
    const signup = within(region).getByRole("link", { name: /criar conta/i });
    expect(login.tabIndex).toBeGreaterThanOrEqual(0);
    expect(signup.tabIndex).toBeGreaterThanOrEqual(0);
    const seen: Element[] = [];
    for (let i = 0; i < 40; i += 1) {
      await user.tab();
      if (document.activeElement) seen.push(document.activeElement);
      if (document.activeElement === signup) break;
    }
    expect(seen).toContain(login);
    expect(seen).toContain(signup);
    expect(seen.indexOf(login)).toBeLessThan(seen.indexOf(signup));
    expect(seen.find(el => el.tagName === "INPUT")).toBeUndefined(); // CTA comes before the first form field
  });

  it("keeps the finalize button disabled, explains why, and creates no order or payment", async () => {
    session.user = null;
    mount();
    await screen.findByRole("region", { name: /entre para finalizar/i });
    const finalize = screen.getByRole("button", { name: /Finalizar compra|Preparando checkout/ }) as HTMLButtonElement;
    expect(finalize.disabled).toBe(true);
    expect(document.body.textContent).toMatch(/Entre ou crie uma conta para finalizar/i);
    expect(create).not.toHaveBeenCalled();
    expect(charge).not.toHaveBeenCalled();
  });

  it("does not touch the cart (items, variant and quantity stay byte-identical)", async () => {
    session.user = null;
    const items = [cartItem({ quantity: 3 }), cartItem({ product: product({ id: 2, name: "Boné" }), variant: variant({ variantId: 22, size: "U" }), quantity: 1 })];
    seedCart(items);
    const before = window.localStorage.getItem(CART_KEY);
    mount(items);
    await screen.findByRole("region", { name: /entre para finalizar/i });
    expect(window.localStorage.getItem(CART_KEY)).toBe(before);
    expect(screen.getAllByText(/Camiseta Built for Adventure/).length).toBeGreaterThan(0);
  });

  it("does not show the call to action to an authenticated customer", async () => {
    session.user = { id: 7, name: "Maria Silva", email: "maria@example.com", role: "user" };
    mount();
    await screen.findByRole("button", { name: /Finalizar compra|Preparando checkout/ });
    expect(screen.queryByRole("region", { name: /entre para finalizar/i })).toBeNull();
    expect(document.body.textContent).not.toMatch(/Entre ou crie uma conta para finalizar/i);
  });
});
