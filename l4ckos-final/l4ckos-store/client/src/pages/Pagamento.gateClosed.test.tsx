// @vitest-environment jsdom
import "../test/setupDom";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

const session = vi.hoisted(() => ({ user: null as null | { id: number; name: string; email: string; role: string } }));
const csrfFetch = vi.hoisted(() => vi.fn());

vi.mock("../lib/trpc", async () => await import("../test/fakeTrpc"));
vi.mock("../lib/csrf", () => ({ csrfFetch, getCsrfToken: vi.fn() }));
vi.mock("../contexts/UserContext", () => ({
  useUser: () => ({ user: session.user, isAuthenticated: Boolean(session.user) }),
}));

import { CartProvider } from "../contexts/CartContext";
import { createUserAttemptStorage } from "../stock/attemptStorage";
import { getOrCreateStockAttemptId, saveStockAttemptStatus } from "../stock/stockCheckoutClient";
import { resetTrpc, setTrpc } from "../test/fakeTrpc";
import { catalogVariant, serveCatalog } from "../test/v6Catalog";
import { cartItem, product, seedCart, variant } from "../test/fixtures";
import Pagamento from "./Pagamento";

const ATTEMPT = "attempt-0000000000000001";
const ITEMS = [{ productId: 1, variantId: 11, quantity: 1 }];
const localOption = { id: "local-plano-piloto", label: "Entrega local - Plano Piloto", description: "Agendamento", price: 0, minDays: 1, maxDays: 2 };

const resumeBody = (over: Record<string, unknown> = {}) => ({
  attemptId: ATTEMPT, status: "pending", orderId: "501", amountCents: 9990,
  reservationExpiresAt: "2026-12-01T12:00:00.000Z", canStartNewAttempt: false,
  checkoutUrl: "https://pay.example/501", ...over,
});

const echo = (over: Record<string, unknown> = {}) => ({ attemptId }: { attemptId: string }) => resumeBody({ attemptId, ...over });
const create = vi.fn();
const resume = vi.fn();
const resumeLatest = vi.fn();

function jsonResponse(body: unknown, ok = true) {
  return { ok, status: ok ? 200 : 500, json: async () => body };
}

function mountPagamento({ items = [cartItem()], attempt }: { items?: ReturnType<typeof cartItem>[]; attempt?: { status: string; canStartNewAttempt?: boolean } } = {}) {
  session.user = { id: 7, name: "Maria Silva", email: "maria@example.com", role: "user" };
  seedCart(items);
  if (attempt) {
    const storage = createUserAttemptStorage(7);
    getOrCreateStockAttemptId({ storage, items: ITEMS, createId: () => ATTEMPT });
    saveStockAttemptStatus({ storage, items: ITEMS, attemptId: ATTEMPT, status: attempt.status as never, canStartNewAttempt: attempt.canStartNewAttempt });
  }
  const user = userEvent.setup();
  render(
    <MemoryRouter initialEntries={["/checkout"]}>
      <CartProvider><Pagamento /></CartProvider>
    </MemoryRouter>,
  );
  return user;
}

async function fillCheckout(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByLabelText(/CPF ou CNPJ/), "12345678909");
  await user.type(screen.getByLabelText(/^CEP/), "70040010");
  await user.click(await screen.findByRole("button", { name: /Entrega local - Plano Piloto/ }, { timeout: 3000 }));
  await user.type(screen.getByLabelText(/^Número/), "10");
}

const finalize = () => screen.getByRole("button", { name: /Finalizar compra|Compra em acompanhamento|Preparando checkout/ }) as HTMLButtonElement;

beforeEach(() => {
  resetTrpc();
  serveCatalog();
  create.mockReset();
  resume.mockReset();
  resumeLatest.mockReset();
  csrfFetch.mockReset();
  csrfFetch.mockResolvedValue(jsonResponse({ options: [localOption], source: "fallback-local" }));
  vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({ logradouro: "SQS 308", bairro: "Asa Sul", localidade: "Brasília", uf: "DF" })));
  const mutation = { mutateAsync: create, isPending: false, error: null };
  setTrpc("stockCheckout.create.useMutation", () => mutation);
  setTrpc("utils.stockCheckout.resume.fetch", (input: { attemptId: string }) => resume(input));
  setTrpc("stockCheckout.resumeLatest.useQuery", () => ({ data: undefined, isLoading: false, error: null, refetch: vi.fn() }));
  setTrpc("stockCheckout.resume.useQuery", ({ attemptId }: { attemptId: string }) => ({ data: resumeBody({ attemptId }), isLoading: false, isFetching: false, error: null, refetch: vi.fn() }));
  resume.mockResolvedValue(null);
});

describe("Pagamento — checkout closed (gates off)", () => {
  it.each(["PUBLIC_CHECKOUT_DISABLED", "PUBLIC_STORE_CLOSED"])("%s: customer sees a plain message, no attempt is stored and no legacy charge is created", async code => {
    create.mockRejectedValue(Object.assign(new Error("texto interno"), { data: { code: "FORBIDDEN", appError: { code } } }));
    const user = mountPagamento();
    await fillCheckout(user);
    await waitFor(() => expect(finalize().disabled).toBe(false));
    await user.click(finalize());
    await waitFor(() => expect(create).toHaveBeenCalledTimes(1));
    expect(await screen.findByText(/ainda não está liberada\. Sua sacola foi mantida/)).toBeTruthy();
    expect(document.body.textContent).not.toContain(code);
    expect(document.body.textContent).not.toMatch(/homologa/i);
    expect(screen.queryByText(/Cobrança gerada|Pagamento aprovado/)).toBeNull();
  });
});
