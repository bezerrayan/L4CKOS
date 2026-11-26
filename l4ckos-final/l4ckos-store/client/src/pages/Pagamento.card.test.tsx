// @vitest-environment jsdom
import "../test/setupDom";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const session = vi.hoisted(() => ({ user: null as null | { id: number; name: string; email: string; role: string } }));
const csrfFetch = vi.hoisted(() => vi.fn());
const gate = vi.hoisted(() => ({ cardCheckoutEnabled: true }));

vi.mock("../lib/trpc", async () => await import("../test/fakeTrpc"));
vi.mock("../lib/csrf", () => ({ csrfFetch, getCsrfToken: vi.fn() }));
vi.mock("../contexts/UserContext", () => ({
  useUser: () => ({ user: session.user, isAuthenticated: Boolean(session.user) }),
}));
vi.mock("../config/cardCheckout", () => ({ get cardCheckoutEnabled() { return gate.cardCheckoutEnabled; } }));

import { CartProvider } from "../contexts/CartContext";
import { resetTrpc, setTrpc } from "../test/fakeTrpc";
import { serveCatalog } from "../test/v6Catalog";
import { cartItem, seedCart } from "../test/fixtures";
import Pagamento from "./Pagamento";

const ATTEMPT = "attempt-card-000000001";
const SANDBOX_INVOICE = "https://sandbox.asaas.com/i/0_card_invoice";
const localOption = { id: "local-plano-piloto", label: "Entrega local - Plano Piloto", description: "Agendamento", price: 0, minDays: 1, maxDays: 2 };
const resumeBody = (over: Record<string, unknown> = {}) => ({
  attemptId: ATTEMPT, status: "pending", paymentMethod: "CARD", orderId: "501", amountCents: 9990,
  reservationExpiresAt: "2026-12-01T12:00:00.000Z", canStartNewAttempt: false, checkoutUrl: SANDBOX_INVOICE, ...over,
});
const create = vi.fn();
const resume = vi.fn();
const assign = vi.fn();
const jsonResponse = (body: unknown) => ({ ok: true, status: 200, json: async () => body });
const originalLocation = window.location;

function mount() {
  session.user = { id: 7, name: "Maria Silva", email: "maria@example.com", role: "user" };
  seedCart([cartItem()]);
  const user = userEvent.setup();
  render(<MemoryRouter initialEntries={["/checkout"]}><CartProvider><Pagamento /></CartProvider></MemoryRouter>);
  return user;
}
async function fillCheckout(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByLabelText(/CPF ou CNPJ/), "12345678909");
  await user.type(screen.getByLabelText(/^CEP/), "70040010");
  await user.click(await screen.findByRole("button", { name: /Entrega local - Plano Piloto/ }, { timeout: 3000 }));
  await user.type(screen.getByLabelText(/^Número/), "10");
}
const finalize = () => screen.getByRole("button", { name: /Finalizar compra|Compra em acompanhamento|Preparando checkout/ }) as HTMLButtonElement;
const cardButton = () => screen.queryByRole("button", { name: /Cartão de crédito/ });

beforeEach(() => {
  resetTrpc();
  serveCatalog();
  create.mockReset(); resume.mockReset(); assign.mockReset(); csrfFetch.mockReset();
  gate.cardCheckoutEnabled = true;
  vi.stubEnv("VITE_DEPLOY_TARGET", "staging");
  Object.defineProperty(window, "location", { configurable: true, value: { ...originalLocation, assign } });
  csrfFetch.mockResolvedValue(jsonResponse({ options: [localOption], source: "fallback-local" }));
  vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({ logradouro: "SQS 308", bairro: "Asa Sul", localidade: "Brasília", uf: "DF" })));
  setTrpc("stockCheckout.create.useMutation", () => ({ mutateAsync: create, isPending: false, error: null }));
  setTrpc("utils.stockCheckout.resume.fetch", (input: { attemptId: string }) => resume(input));
  setTrpc("stockCheckout.resumeLatest.useQuery", () => ({ data: undefined, isLoading: false, error: null, refetch: vi.fn() }));
  resume.mockResolvedValue(null);
});
afterEach(() => {
  Object.defineProperty(window, "location", { configurable: true, value: originalLocation });
  vi.unstubAllEnvs();
});

describe("Pagamento — hosted card", () => {
  it("creates a CARD attempt and sends the customer to the exact Asaas host, without presuming payment", async () => {
    create.mockResolvedValue({ attemptId: ATTEMPT, orderId: "501", status: "pending", paymentId: "pay_1", checkoutUrl: SANDBOX_INVOICE, amountCents: 9990, replayed: false });
    const user = mount();
    await fillCheckout(user);
    await user.click(screen.getByRole("button", { name: /Cartão de crédito/ }));
    await waitFor(() => expect(finalize().disabled).toBe(false));
    await user.click(finalize());
    await waitFor(() => expect(assign).toHaveBeenCalledWith(SANDBOX_INVOICE));
    expect(create).toHaveBeenCalledTimes(1);
    expect(create.mock.calls[0][0]).toMatchObject({ paymentMethod: "CARD", items: [{ productId: 1, variantId: 11, quantity: 1 }] });
    // The storefront never carries card data or a client price: only cart lines, delivery and the chosen method.
    expect(JSON.stringify(create.mock.calls[0][0])).not.toMatch(/price|amount|cvv|ccv|holder|expiry|cardNumber/i);
    expect(screen.queryByText("Pagamento aprovado")).toBeNull();
  });

  it("never redirects to a URL outside the build's Asaas host", async () => {
    create.mockResolvedValue({ attemptId: ATTEMPT, orderId: "501", status: "pending", paymentId: "pay_1", checkoutUrl: "https://evil.example/pay", amountCents: 9990, replayed: false });
    resume.mockResolvedValue(resumeBody({ checkoutUrl: "https://evil.example/pay" }));
    const user = mount();
    await fillCheckout(user);
    await user.click(screen.getByRole("button", { name: /Cartão de crédito/ }));
    await waitFor(() => expect(finalize().disabled).toBe(false));
    await user.click(finalize());
    const status = await screen.findByRole("status");
    expect(assign).not.toHaveBeenCalled();
    expect(within(status).queryByRole("link")).toBeNull();
    expect(screen.getByTestId("stock-card-unavailable")).not.toBeNull();
  });

  it("does not offer the card in a build where it was not enabled, and PIX keeps working", async () => {
    gate.cardCheckoutEnabled = false;
    create.mockResolvedValue({ attemptId: ATTEMPT, orderId: "501", status: "pending", amountCents: 9990, replayed: false });
    resume.mockResolvedValue(resumeBody({ paymentMethod: "PIX", checkoutUrl: "https://www.asaas.com/i/pix", pix: { copyPaste: "00020126580014br.gov.bcb.pix0136synthetic" } }));
    const user = mount();
    await fillCheckout(user);
    expect(cardButton()).toBeNull();
    await waitFor(() => expect(finalize().disabled).toBe(false));
    await user.click(finalize());
    await waitFor(() => expect(document.querySelector("[data-stock-status]")).not.toBeNull());
    expect(create.mock.calls[0][0]).toMatchObject({ paymentMethod: "PIX" });
    expect(assign).not.toHaveBeenCalled();
  });

  it("falls back to PIX when the server reports the card closed, without treating the outcome as unknown", async () => {
    create.mockRejectedValue({ message: "forbidden", data: { code: "FORBIDDEN", appError: { code: "CARD_CHECKOUT_DISABLED" } } });
    const user = mount();
    await fillCheckout(user);
    await user.click(screen.getByRole("button", { name: /Cartão de crédito/ }));
    await waitFor(() => expect(finalize().disabled).toBe(false));
    await user.click(finalize());
    expect(await screen.findByText(/Pagamento com cartão indisponível no momento/)).not.toBeNull();
    await waitFor(() => expect(cardButton()).toBeNull());
    expect(assign).not.toHaveBeenCalled();
    expect(resume).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: /PIX/ }).getAttribute("aria-pressed")).toBe("true");
  });

  it("resumes a pending card attempt on the hosted invoice, not with PIX instructions", async () => {
    create.mockResolvedValue({ attemptId: ATTEMPT, orderId: "501", status: "pending", amountCents: 9990, replayed: false });
    resume.mockResolvedValue(resumeBody());
    const user = mount();
    await fillCheckout(user);
    await user.click(screen.getByRole("button", { name: /Cartão de crédito/ }));
    await waitFor(() => expect(finalize().disabled).toBe(false));
    // No usable invoice URL on the create response: the customer lands on the resumed attempt.
    create.mockResolvedValue({ attemptId: ATTEMPT, orderId: "501", status: "pending", amountCents: 9990, replayed: false });
    await user.click(finalize());
    const status = await screen.findByRole("status");
    expect(within(status).getByText("Aguardando confirmação do pagamento")).toBeTruthy();
    expect(within(status).getByRole("link", { name: "Continuar no pagamento seguro" }).getAttribute("href")).toBe(SANDBOX_INVOICE);
    expect(screen.queryByTestId("stock-pix-instructions")).toBeNull();
    expect(finalize().disabled).toBe(true);
  });
});
