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
  create.mockReset().mockImplementation(async (request: { attemptId: string }) => ({
    attemptId: request.attemptId, orderId: "stock-preorder-synthetic", status: "pending", paymentId: "pay-preorder-synthetic",
    checkoutUrl: "https://pay.example/preorder", amountCents: 9990, replayed: false,
  }));
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

const preorderItem = (over: Record<string, unknown> = {}) => cartItem({ product: product({ id: 3, name: "Jaqueta Pré-venda", salesMode: "PREORDER", productionBatch: {
  id: 70, name: "Lote XIV Bis #1", status: "OPEN", salesOpenAt: null, salesCloseAt: null,
  estimatedShippingStart: "2027-02-01T00:00:00.000Z", estimatedShippingEnd: "2027-02-20T00:00:00.000Z",
  estimatedManufacturingStart: "2026-12-10", estimatedManufacturingEnd: "2027-01-20",
  capacity: { maximumQuantity: 3, claimedQuantity: 0, remainingQuantity: 3 },
} }), variant: variant({ variantId: 33 }), ...over });

function serveStockAndPreorderCatalog() {
  const batch = preorderItem().product.productionBatch;
  const products = [
    product({ id: 1, price: 99.9, salesMode: "STOCK" }),
    product({ id: 3, name: "Jaqueta Pré-venda", price: 99.9, salesMode: "PREORDER", productionBatch: batch }),
  ];
  setTrpc("products.list.useQuery", () => ({ data: products, isSuccess: true, isFetching: false, isLoading: false, refetch: async () => ({ isSuccess: true, data: products }) }));
  setTrpc("utils.products.sellableVariants.fetch", async (productId: number) => ({
    productId, hasVariants: true, publicPurchaseAllowed: true,
    variants: productId === 3
      ? [{ ...catalogVariant({ variantId: 33, price: 9990, availableUnits: null }), available: true }]
      : [{ ...catalogVariant(), available: true }],
  }));
}

describe("Pagamento — PREORDER routing", () => {
  it("routes a pre-sale-only cart through reservation checkout and displays its batch calendar", async () => {
    serveStockAndPreorderCatalog();
    const user = mountPagamento({ items: [preorderItem()] });
    await fillCheckout(user);
    expect(screen.getByText(/Fabricação estimada.*2026|Fabricação prevista.*2026/i)).toBeTruthy();
    expect(screen.getByText(/Postagem estimada.*2027|Envio estimado.*2027/i)).toBeTruthy();
    expect(screen.getByRole("button", { name: /^PIX/ })).toBeTruthy();
    await user.click(finalize());
    await waitFor(() => expect(create).toHaveBeenCalledTimes(1));
    expect(create.mock.calls[0]?.[0]).toMatchObject({ items: [{ productId: 3, variantId: 33, quantity: 1 }] });
  });
  it("blocks a mixed STOCK + pre-sale cart and explains that they require separate purchases", async () => {
    serveStockAndPreorderCatalog();
    mountPagamento({ items: [cartItem(), preorderItem()] });
    expect(await screen.findByText(/Estoque e pré-venda usam reservas separadas/)).toBeTruthy();
    expect(finalize().disabled).toBe(true);
    expect(create).not.toHaveBeenCalled();
  });
});
