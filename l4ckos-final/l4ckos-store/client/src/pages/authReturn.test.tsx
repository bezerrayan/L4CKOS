// @vitest-environment jsdom
import "../test/setupDom";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

const session = vi.hoisted(() => ({ isAuthenticated: false }));
const loginMutate = vi.hoisted(() => vi.fn());
const signupMutate = vi.hoisted(() => vi.fn());
vi.mock("../lib/trpc", async () => await import("../test/fakeTrpc"));
vi.mock("../contexts/UserContext", () => ({ useUser: () => ({ user: null, isAuthenticated: session.isAuthenticated, isLoading: false }) }));
vi.mock("../contexts/ToastContext", () => ({ useToast: () => ({ showToast: vi.fn() }) }));

import { resetTrpc, setTrpc } from "../test/fakeTrpc";
import Login from "./Login";
import Cadastro from "./Cadastro";

function Where() {
  const l = useLocation();
  return <div data-testid="where">{l.pathname}{l.search}</div>;
}
const CART_KEY = "loja-escoteira:cart";

function mount(path: string) {
  const user = userEvent.setup();
  render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/login" element={<><Login /><Where /></>} />
        <Route path="/cadastro" element={<><Cadastro /><Where /></>} />
        <Route path="*" element={<Where />} />
      </Routes>
    </MemoryRouter>,
  );
  return user;
}

beforeEach(() => {
  window.localStorage.clear();
  session.isAuthenticated = false;
  loginMutate.mockReset().mockResolvedValue({ ok: true });
  signupMutate.mockReset().mockResolvedValue({ ok: true });
  resetTrpc();
  setTrpc("auth.localLogin.useMutation", () => ({ mutateAsync: loginMutate, isPending: false, error: null }));
  setTrpc("auth.localSignup.useMutation", () => ({ mutateAsync: signupMutate, isPending: false, error: null }));
});

async function submitLogin(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByLabelText(/^E-mail/), "maria@example.com");
  await user.type(screen.getByLabelText(/^Senha/), "Senha#Forte123");
  await user.click(screen.getByRole("button", { name: /^Entrar$/ }));
}
async function submitSignup(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByLabelText(/Nome/i, { selector: "input[name=firstName]" }), "Maria");
  await user.type(screen.getByLabelText(/E-mail/i), "maria@example.com");
  await user.type(document.querySelector("input[name=password]") as HTMLInputElement, "Senha#Forte123");
  await user.type(document.querySelector("input[name=confirmPassword]") as HTMLInputElement, "Senha#Forte123");
  await user.click(screen.getByRole("checkbox", { name: /Concordo/i }));
  await user.click(screen.getByRole("button", { name: /criar conta/i }));
}

describe("Login return path", () => {
  it("returns to /checkout after a successful login", async () => {
    const cart = JSON.stringify([{ keep: "me" }]);
    window.localStorage.setItem(CART_KEY, cart);
    const user = mount("/login?next=%2Fcheckout");
    await submitLogin(user);
    await waitFor(() => expect(screen.getByTestId("where").textContent).toBe("/checkout"));
    expect(loginMutate).toHaveBeenCalledTimes(1);
    expect(window.localStorage.getItem(CART_KEY)).toBe(cart);
  });
  it.each(["//evil.example", "/\\evil.example", "https://evil.example", "javascript:alert(1)", "/%2F%2Fevil.example", "/login"])("falls back to / for next=%s", async next => {
    const user = mount(`/login?next=${encodeURIComponent(next)}`);
    await submitLogin(user);
    await waitFor(() => expect(screen.getByTestId("where").textContent).toBe("/"));
  });
  it("an already authenticated visitor is sent to the validated destination, never off-site", async () => {
    session.isAuthenticated = true;
    mount("/login?next=%2F%2Fevil.example");
    await waitFor(() => expect(screen.getByTestId("where").textContent).toBe("/"));
  });
  it("the sign-up link keeps the destination (and drops unsafe ones)", () => {
    mount("/login?next=%2Fcheckout");
    expect(screen.getByRole("link", { name: /criar conta/i }).getAttribute("href")).toBe("/cadastro?next=%2Fcheckout");
  });
  it("the sign-up link omits an unsafe destination", () => {
    mount("/login?next=%2F%2Fevil.example");
    expect(screen.getByRole("link", { name: /criar conta/i }).getAttribute("href")).toBe("/cadastro");
  });
});

describe("Cadastro return path", () => {
  it("returns to /checkout after a successful sign-up", async () => {
    const cart = JSON.stringify([{ keep: "me" }]);
    window.localStorage.setItem(CART_KEY, cart);
    const user = mount("/cadastro?next=%2Fcheckout");
    await submitSignup(user);
    await waitFor(() => expect(screen.getByTestId("where").textContent).toBe("/checkout"));
    expect(signupMutate).toHaveBeenCalledTimes(1);
    expect(window.localStorage.getItem(CART_KEY)).toBe(cart);
  });
  it.each(["//evil.example", "https://evil.example", "/\\evil.example", "/cadastro"])("falls back to / for next=%s", async next => {
    const user = mount(`/cadastro?next=${encodeURIComponent(next)}`);
    await submitSignup(user);
    await waitFor(() => expect(screen.getByTestId("where").textContent).toBe("/"));
  });
  it("an already authenticated visitor is sent to the validated destination", async () => {
    session.isAuthenticated = true;
    mount("/cadastro?next=%2Fcheckout");
    await waitFor(() => expect(screen.getByTestId("where").textContent).toBe("/checkout"));
  });
  it("the login link keeps the destination", () => {
    mount("/cadastro?next=%2Fcheckout");
    expect(screen.getByRole("link", { name: /fazer login/i }).getAttribute("href")).toBe("/login?next=%2Fcheckout");
  });
});
