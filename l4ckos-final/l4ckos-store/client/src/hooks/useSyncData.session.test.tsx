// @vitest-environment jsdom
import "../test/setupDom";
import { render } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const session = vi.hoisted(() => ({ user: null as null | { id: number }, isAuthenticated: false }));
const local = vi.hoisted(() => ({ cartItems: [{ product: { id: 5 }, quantity: 2 }] as unknown[], favorites: [{ id: 9 }] as unknown[] }));
vi.mock("../lib/trpc", async () => await import("../test/fakeTrpc"));
vi.mock("../contexts/UserContext", () => ({ useUser: () => ({ user: session.user, isAuthenticated: session.isAuthenticated, isLoading: false }) }));
vi.mock("../contexts/CartContext", () => ({ useCart: () => ({ cart: { items: local.cartItems } }) }));
vi.mock("../contexts/FavoritesContext", () => ({ useFavorites: () => ({ favorites: local.favorites }) }));

import { resetTrpc, setTrpc } from "../test/fakeTrpc";
import { DataSyncProvider } from "../components/DataSyncProvider";

// The server answers only once the (enabled) query has been fetched: `serverReady` models the async response.
const server = { ready: false, requests: 0 };
const addCart = vi.fn();
const addFavorite = vi.fn();

beforeEach(() => {
  resetTrpc(); addCart.mockReset(); addFavorite.mockReset();
  server.ready = false; server.requests = 0;
  session.user = null; session.isAuthenticated = false;
  const query = (rows: unknown[]) => (_input: unknown, options?: { enabled?: boolean }) => {
    const enabled = options?.enabled !== false;
    if (enabled && server.ready) return { data: rows, isLoading: false, error: null };
    return { data: undefined, isLoading: enabled, error: null };
  };
  setTrpc("cart.list.useQuery", query([]));
  setTrpc("favorites.list.useQuery", query([]));
  setTrpc("cart.add.useMutation", () => ({ mutate: addCart }));
  setTrpc("favorites.add.useMutation", () => ({ mutate: addFavorite }));
});

const login = () => { session.user = { id: 7 }; session.isAuthenticated = true; };
const logout = () => { session.user = null; session.isAuthenticated = false; };

describe("DataSyncProvider: session transitions", () => {
  it("syncs the local cart and favorites once the server lists arrive after a reload as a logged-in user", () => {
    login();
    const view = render(<DataSyncProvider><span /></DataSyncProvider>);
    expect(addCart).not.toHaveBeenCalled(); // server list not fetched yet
    server.ready = true;
    view.rerender(<DataSyncProvider><span /></DataSyncProvider>);
    expect(addCart).toHaveBeenCalledWith({ productId: 5, quantity: 2 });
    expect(addFavorite).toHaveBeenCalledWith(9);
  });

  it("syncs after an in-session login (anonymous first, then authenticated, then the lists arrive)", () => {
    const view = render(<DataSyncProvider><span /></DataSyncProvider>);
    login();
    view.rerender(<DataSyncProvider><span /></DataSyncProvider>);
    server.ready = true;
    view.rerender(<DataSyncProvider><span /></DataSyncProvider>);
    expect(addCart).toHaveBeenCalledTimes(1);
    expect(addFavorite).toHaveBeenCalledTimes(1);
  });

  it("stops syncing and stops querying after logout", () => {
    login(); server.ready = true;
    const view = render(<DataSyncProvider><span /></DataSyncProvider>);
    addCart.mockClear(); addFavorite.mockClear();
    logout();
    local.cartItems = [...local.cartItems, { product: { id: 6 }, quantity: 1 }];
    view.rerender(<DataSyncProvider><span /></DataSyncProvider>);
    expect(addCart).not.toHaveBeenCalled();
    expect(addFavorite).not.toHaveBeenCalled();
  });
});
