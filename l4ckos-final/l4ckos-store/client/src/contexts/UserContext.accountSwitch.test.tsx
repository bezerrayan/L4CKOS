// @vitest-environment jsdom
import "../test/setupDom";
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../lib/trpc", async () => await import("../test/fakeTrpc"));

import { resetTrpc, setTrpc } from "../test/fakeTrpc";
import { UserProvider, useUser } from "./UserContext";

const ME_KEY = [["auth", "me"], { type: "query" }];
const ATTEMPT_KEY = [["stockCheckout", "resumeLatest"], { type: "query" }];
const PROFILE_KEY = [["profile", "get"], { type: "query" }];

let me: { id: number; name: string } | null = null;
const logout = vi.fn(async () => { me = null; });

function Probe() {
  const { user, logout: doLogout } = useUser();
  return <><span data-testid="who">{user?.name ?? "anon"}</span><button onClick={doLogout}>sair</button></>;
}

function mount() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  client.setQueryData(ME_KEY, me);
  client.setQueryData(ATTEMPT_KEY, { attemptId: "attempt-A", status: "pending" });
  client.setQueryData(PROFILE_KEY, { name: "Usuária A" });
  const view = () => (
    <QueryClientProvider client={client}><UserProvider><Probe /></UserProvider></QueryClientProvider>
  );
  const utils = render(view());
  return { client, rerender: () => utils.rerender(view()) };
}

beforeEach(() => {
  resetTrpc();
  logout.mockClear();
  me = { id: 1, name: "A" };
  setTrpc("auth.me.useQuery", () => ({ data: me, isLoading: false }));
  setTrpc("auth.logout.useMutation", () => ({ mutateAsync: logout, isPending: false }));
});

describe("account switch: user-scoped cache never survives an identity change", () => {
  it("logout drops A's cached attempt and profile but keeps the session query", async () => {
    const { client } = mount();
    expect(client.getQueryData(ATTEMPT_KEY)).toBeTruthy();
    await userEvent.setup().click(screen.getByRole("button", { name: "sair" }));
    await act(async () => {});
    expect(logout).toHaveBeenCalled();
    expect(client.getQueryData(ATTEMPT_KEY)).toBeUndefined();
    expect(client.getQueryData(PROFILE_KEY)).toBeUndefined();
    expect(client.getQueryState(ME_KEY)).toBeTruthy();
  });

  it("another tab signs in as B (A -> B without logout here): A's data is purged", async () => {
    const { client, rerender } = mount();
    me = { id: 2, name: "B" };
    rerender();
    await act(async () => {});
    expect(screen.getByTestId("who").textContent).toBe("B");
    expect(client.getQueryData(ATTEMPT_KEY)).toBeUndefined();
    expect(client.getQueryData(PROFILE_KEY)).toBeUndefined();
  });

  it("the very first session load does not purge anything", async () => {
    const { client } = mount();
    await act(async () => {});
    expect(client.getQueryData(ATTEMPT_KEY)).toBeTruthy();
  });

  it("the same user refetching keeps the cache", async () => {
    const { client, rerender } = mount();
    me = { id: 1, name: "A" };
    rerender();
    await act(async () => {});
    expect(client.getQueryData(ATTEMPT_KEY)).toBeTruthy();
  });
});
