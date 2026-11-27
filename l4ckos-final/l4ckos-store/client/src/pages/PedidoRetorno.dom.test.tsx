// @vitest-environment jsdom
import "../test/setupDom";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../lib/trpc", async () => await import("../test/fakeTrpc"));
vi.mock("../contexts/UserContext", () => ({ useUser: () => ({ isAuthenticated: true, isLoading: false, user: { id: 7, role: "user" } }) }));
import { resetTrpc, setTrpc } from "../test/fakeTrpc";
import PedidoRetorno from "./PedidoRetorno";

const attempt = {
  attemptId: "attempt-return-page-0001", status: "pending", paymentMethod: "CARD", orderId: "42", paymentId: "pay_1",
  checkoutUrl: "https://sandbox.asaas.com/i/abc", amountCents: 3759, reservationExpiresAt: "2026-11-26T20:00:00.000Z", canStartNewAttempt: false,
};
const serve = (data: unknown) => setTrpc("stockCheckout.resumeLatest.useQuery", () => ({ data, isLoading: false, isError: false, refetch: vi.fn() }));
const renderPage = () => render(<MemoryRouter><PedidoRetorno /></MemoryRouter>);

beforeEach(() => { resetTrpc(); vi.stubEnv("VITE_DEPLOY_TARGET", "staging"); });
afterEach(() => vi.unstubAllEnvs());

describe("PedidoRetorno (DOM)", () => {
  it("does not present a returning customer as paid while the backend still reports pending", () => {
    serve(attempt);
    renderPage();
    expect(screen.getByText("Aguardando confirmação do pagamento")).not.toBeNull();
    expect(screen.queryByText("Pagamento aprovado")).toBeNull();
    expect(screen.getByText(/Voltar da página de pagamento não confirma o pedido/)).not.toBeNull();
    expect(screen.getByRole("link", { name: "Continuar no pagamento seguro" })).not.toBeNull();
  });

  it("shows approval only when the backend reports paid, with a link to follow the order", () => {
    serve({ ...attempt, status: "paid" });
    renderPage();
    expect(screen.getByText("Pagamento aprovado")).not.toBeNull();
    expect(screen.getByRole("link", { name: "Acompanhar pedido" }).getAttribute("href")).toBe("/meus-pedidos/42");
    expect(screen.queryByRole("link", { name: "Continuar no pagamento seguro" })).toBeNull();
  });

  it("explains an unfinished payment and offers a retry only when the server allows one", () => {
    serve({ ...attempt, status: "failed", canStartNewAttempt: true });
    renderPage();
    expect(screen.getByText("Pagamento não concluído")).not.toBeNull();
    expect(screen.queryByText("Pagamento aprovado")).toBeNull();
  });

  it("handles a customer with no recent attempt", () => {
    serve(null);
    renderPage();
    expect(screen.getByText(/Não encontramos um pedido recente/)).not.toBeNull();
  });
});
