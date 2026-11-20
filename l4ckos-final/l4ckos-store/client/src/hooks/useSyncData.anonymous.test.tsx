// @vitest-environment jsdom
import "../test/setupDom";
import { render } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const session = vi.hoisted(() => ({ user: null as null | { id: number }, isAuthenticated: false }));
vi.mock("../lib/trpc", async () => await import("../test/fakeTrpc"));
vi.mock("../contexts/UserContext", () => ({ useUser: () => ({ user: session.user, isAuthenticated: session.isAuthenticated, isLoading: false }) }));
vi.mock("../contexts/CartContext", () => ({ useCart: () => ({ cart: { items: [] } }) }));
vi.mock("../contexts/FavoritesContext", () => ({ useFavorites: () => ({ favorites: [] }) }));

import { resetTrpc, setTrpc } from "../test/fakeTrpc";
import { DataSyncProvider } from "../components/DataSyncProvider";

const idle = { data: undefined, isLoading: false, error: null };
const options = { cart: [] as unknown[], favorites: [] as unknown[] };

beforeEach(() => {
  resetTrpc();
  options.cart = []; options.favorites = [];
  session.user = null; session.isAuthenticated = false;
  setTrpc("cart.list.useQuery", (...args: unknown[]) => { options.cart.push(args[1] ?? args[0]); return idle; });
  setTrpc("favorites.list.useQuery", (...args: unknown[]) => { options.favorites.push(args[1] ?? args[0]); return idle; });
});

const enabledOf = (calls: unknown[]) => calls.map(call => (call as { enabled?: boolean } | undefined)?.enabled);

describe("DataSyncProvider: server cart/favorites are protected procedures", () => {
  it("does not fire cart.list / favorites.list for an anonymous visitor (they would only answer 401, twice each with retry)", () => {
    render(<DataSyncProvider><span /></DataSyncProvider>);
    expect(enabledOf(options.cart).every(value => value === false)).toBe(true);
    expect(enabledOf(options.favorites).every(value => value === false)).toBe(true);
  });

  it("fires both queries once the visitor is authenticated", () => {
    session.user = { id: 7 }; session.isAuthenticated = true;
    render(<DataSyncProvider><span /></DataSyncProvider>);
    expect(enabledOf(options.cart).every(value => value === true)).toBe(true);
    expect(enabledOf(options.favorites).every(value => value === true)).toBe(true);
  });
});
