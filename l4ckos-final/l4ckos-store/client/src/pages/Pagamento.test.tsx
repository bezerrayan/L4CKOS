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

describe("Pagamento — shipping", () => {
  it("offers only what the backend quoted and shows its price", async () => {
    csrfFetch.mockResolvedValue(jsonResponse({ options: [{ ...localOption, price: 0 }, { id: "melhor-envio-1", label: "SEDEX", description: "Correios", price: 31.9, minDays: 2, maxDays: 4 }] }));
    const user = mountPagamento();
    await user.type(screen.getByLabelText(/^CEP/), "70040010");
    expect(await screen.findByRole("button", { name: /SEDEX/ }, { timeout: 3000 })).toBeTruthy();
    expect(screen.getByRole("button", { name: /SEDEX/ }).textContent).toContain("R$");
    expect(csrfFetch.mock.calls[0][1].body).toContain('"subtotal":99.9');
  });

  it("shows an error and NO delivery option when the quote request fails (never free local delivery)", async () => {
    csrfFetch.mockRejectedValue(new TypeError("Failed to fetch"));
    const user = mountPagamento();
    await user.type(screen.getByLabelText(/^CEP/), "70040010");
    expect(await screen.findByText(/Não foi possível consultar o frete agora/, {}, { timeout: 3000 })).toBeTruthy();
    expect(screen.queryByText(/Entrega local/)).toBeNull();
    expect(screen.queryByRole("button", { name: /Plano Piloto/ })).toBeNull();
    expect(finalize().disabled).toBe(true);
  });

  it("shows an error and no option when the backend returns an empty list (CEP outside the approved range)", async () => {
    csrfFetch.mockResolvedValue(jsonResponse({ options: [] }));
    const user = mountPagamento();
    await user.type(screen.getByLabelText(/^CEP/), "01001000");
    expect(await screen.findByText(/Ainda não entregamos neste CEP/, {}, { timeout: 3000 })).toBeTruthy();
    expect(finalize().disabled).toBe(true);
  });

  it("shows freight as 'Calcular' until a real option is selected", () => {
    mountPagamento();
    expect(screen.getAllByText("Calcular").length).toBeGreaterThan(0);
  });
});

describe("Pagamento — creating and payment states", () => {
  it("creates the attempt, then shows PENDING (not approved) from resume — even if create says paid", async () => {
    create.mockResolvedValue({ attemptId: ATTEMPT, orderId: "501", status: "paid", amountCents: 9990, replayed: false });
    resume.mockImplementation(echo({ status: "pending" }));
    const user = mountPagamento();
    await fillCheckout(user);
    await waitFor(() => expect(finalize().disabled).toBe(false));
    await user.click(finalize());
    const status = await screen.findByRole("status");
    expect(status.getAttribute("data-stock-status")).toBe("pending");
    expect(within(status).getByText("Aguardando confirmação do pagamento")).toBeTruthy();
    expect(screen.queryByText("Pagamento aprovado")).toBeNull();
    expect(within(status).getByRole("link", { name: "Continuar pagamento" }).getAttribute("href")).toBe("https://pay.example/501");
    expect(finalize().disabled).toBe(true);
    expect(create).toHaveBeenCalledTimes(1);
    const request = create.mock.calls[0][0];
    expect(request.items).toEqual([{ productId: 1, variantId: 11, quantity: 1 }]);
    expect(JSON.stringify(request)).not.toMatch(/price|amount/i);
    expect(request.delivery.optionId).toBe("local-plano-piloto");
  });

  describe("carrier freight on a STOCK cart", () => {
    const sedex = { id: "melhor-envio-1", label: "SEDEX", description: "Correios", price: 31.9, minDays: 2, maxDays: 4 };
    const quote = vi.fn();
    const signed = (priceCents: number) => ({ source: "melhor-envio", options: [{ optionId: "melhor-envio-1", label: "SEDEX", description: "Correios", priceCents, minDays: 2, maxDays: 4, quoteToken: "signed-token-".padEnd(60, "x"), expiresAt: "2026-12-01T12:00:00.000Z" }] });
    async function chooseSedex(user: ReturnType<typeof userEvent.setup>) {
      csrfFetch.mockResolvedValue(jsonResponse({ options: [sedex] }));
      setTrpc("stockCheckout.quoteShipping.useMutation", () => ({ mutateAsync: quote, isPending: false, error: null }));
      await user.type(screen.getByLabelText(/CPF ou CNPJ/), "12345678909");
      await user.type(screen.getByLabelText(/^CEP/), "01001000");
      await user.click(await screen.findByRole("button", { name: /SEDEX/ }, { timeout: 3000 }));
      await user.type(screen.getByLabelText(/^Número/), "10");
    }
    beforeEach(() => quote.mockReset());

    it("asks the server for a signed quote and creates with its token, never with a client price", async () => {
      quote.mockResolvedValue(signed(3190));
      create.mockResolvedValue({ attemptId: ATTEMPT, orderId: "501", status: "pending", amountCents: 16090, replayed: false });
      resume.mockImplementation(echo({ status: "pending", amountCents: 16090 }));
      const user = mountPagamento();
      await chooseSedex(user);
      await waitFor(() => expect(finalize().disabled).toBe(false));
      await user.click(finalize());
      await waitFor(() => expect(create).toHaveBeenCalledTimes(1));
      const request = create.mock.calls[0][0];
      expect(request.delivery).toMatchObject({ optionId: "melhor-envio-1", quoteToken: expect.stringMatching(/^signed-token-/) });
      expect(request.delivery.address.zipCode).toBe("01001000");
      expect(JSON.stringify(request)).not.toMatch(/priceCents|shippingPrice|"price"|amount/i);
      expect(quote.mock.calls[0][0].items).toEqual([{ productId: 1, variantId: 11, quantity: 1 }]);
    });

    it("stops with an explanation when the server quote differs from the displayed price, and creates nothing", async () => {
      quote.mockResolvedValue(signed(4590));
      const user = mountPagamento();
      await chooseSedex(user);
      await waitFor(() => expect(finalize().disabled).toBe(false));
      await user.click(finalize());
      expect(await screen.findByText(/O valor do frete mudou/)).toBeTruthy();
      expect(create).not.toHaveBeenCalled();
    });

    it("stops when the carrier option is no longer offered by the server", async () => {
      quote.mockResolvedValue({ source: "unavailable", options: [] });
      const user = mountPagamento();
      await chooseSedex(user);
      await waitFor(() => expect(finalize().disabled).toBe(false));
      await user.click(finalize());
      expect(await screen.findByText(/não está mais disponível/)).toBeTruthy();
      expect(create).not.toHaveBeenCalled();
    });
  });

  it("does not create twice on a double click", async () => {
    let release: (value: unknown) => void = () => {};
    create.mockImplementation(() => new Promise(resolve => { release = resolve; }));
    resume.mockImplementation(echo());
    const user = mountPagamento();
    await fillCheckout(user);
    await waitFor(() => expect(finalize().disabled).toBe(false));
    await user.dblClick(finalize());
    await act(async () => { release({ attemptId: ATTEMPT, orderId: "501", status: "pending", amountCents: 9990, replayed: false }); });
    expect(create).toHaveBeenCalledTimes(1);
  });

  it("confirms only after resume reports paid: shows approval and clears the cart", async () => {
    resume.mockResolvedValue(resumeBody({ status: "paid", checkoutUrl: undefined }));
    mountPagamento({ attempt: { status: "pending" } });
    expect(await screen.findByText("Pagamento aprovado")).toBeTruthy();
    expect(await screen.findByRole("link", { name: "Ver meus pedidos" })).toBeTruthy();
    expect(screen.getByText("Pedido #501")).toBeTruthy();
    await waitFor(() => expect(window.localStorage.getItem("loja-escoteira:cart")).toBeNull());
  });

  it("keeps the cart and says 'em análise' for ambiguous, blocking another attempt", async () => {
    resume.mockResolvedValue(resumeBody({ status: "ambiguous", checkoutUrl: undefined }));
    mountPagamento({ attempt: { status: "ambiguous" } });
    expect(await screen.findByText("Pagamento em análise")).toBeTruthy();
    expect(screen.getByText(/Não pague novamente/)).toBeTruthy();
    expect(window.localStorage.getItem("loja-escoteira:cart")).not.toBeNull();
    expect(finalize().disabled).toBe(true);
  });

  it.each([
    ["failed", "Pagamento não concluído"],
    ["expired", "Tentativa expirada"],
  ])("allows a new attempt after %s when the server says so", async (status, title) => {
    resume.mockResolvedValue(resumeBody({ status, checkoutUrl: undefined, canStartNewAttempt: true }));
    const user = mountPagamento({ attempt: { status, canStartNewAttempt: true } });
    expect(await screen.findByText(title)).toBeTruthy();
    await fillCheckout(user);
    await waitFor(() => expect(finalize().disabled).toBe(false));
  });

  it("maps STOCK_UNAVAILABLE by code and never shows internal codes", async () => {
    create.mockRejectedValue(Object.assign(new Error("qualquer texto"), { data: { code: "CONFLICT", appError: { code: "STOCK_UNAVAILABLE" } } }));
    const user = mountPagamento();
    await fillCheckout(user);
    await waitFor(() => expect(finalize().disabled).toBe(false));
    await user.click(finalize());
    expect(await screen.findByText(/acabou de ficar indisponível/)).toBeTruthy();
    expect(document.body.textContent).not.toContain("STOCK_UNAVAILABLE");
  });

  it("on a network error tells the customer to check the status and re-queries (no blind retry)", async () => {
    create.mockRejectedValue(new TypeError("Failed to fetch"));
    resume.mockResolvedValue(null);
    const user = mountPagamento();
    await fillCheckout(user);
    await waitFor(() => expect(finalize().disabled).toBe(false));
    await user.click(finalize());
    expect(await screen.findByText(/Falha de conexão/)).toBeTruthy();
    await waitFor(() => expect(resume).toHaveBeenCalled());
  });

  it("PAYMENT_UNDER_ANALYSIS blocks a new charge and re-queries", async () => {
    create.mockRejectedValue(Object.assign(new Error("x"), { data: { code: "CONFLICT", appError: { code: "PAYMENT_UNDER_ANALYSIS" } } }));
    const user = mountPagamento();
    await fillCheckout(user);
    await waitFor(() => expect(finalize().disabled).toBe(false));
    await user.click(finalize());
    expect(await screen.findByText(/O pagamento está em análise/)).toBeTruthy();
    await waitFor(() => expect(resume).toHaveBeenCalled());
  });

  it("blocks new attempts for sold-out lines but lists the reason", async () => {
    serveCatalog({ variants: [catalogVariant({ availableUnits: 0 })] });
    mountPagamento();
    expect(await screen.findByText(/não está disponível na quantidade escolhida/)).toBeTruthy();
    expect(finalize().disabled).toBe(true);
  });

  it("requires login before finalizing", () => {
    seedCart([cartItem()]);
    session.user = null;
    render(<MemoryRouter><CartProvider><Pagamento /></CartProvider></MemoryRouter>);
    expect(finalize().disabled).toBe(true);
  });
});

describe("Pagamento — order recovery", () => {
  it("resumes an open attempt with an emptied cart using the real resume procedure", async () => {
    session.user = { id: 7, name: "Maria Silva", email: "maria@example.com", role: "user" };
    const storage = createUserAttemptStorage(7);
    getOrCreateStockAttemptId({ storage, items: ITEMS, createId: () => ATTEMPT });
    render(<MemoryRouter><CartProvider><Pagamento /></CartProvider></MemoryRouter>);
    expect(await screen.findByText("Seu pedido em andamento")).toBeTruthy();
    expect(screen.getByText("Aguardando confirmação do pagamento")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Continuar pagamento" })).toBeTruthy();
  });

  it("falls back to resumeLatest when localStorage was cleared", async () => {
    session.user = { id: 7, name: "Maria Silva", email: "maria@example.com", role: "user" };
    setTrpc("stockCheckout.resumeLatest.useQuery", () => ({ data: resumeBody({ status: "pending" }), isLoading: false, error: null, refetch: vi.fn() }));
    render(<MemoryRouter><CartProvider><Pagamento /></CartProvider></MemoryRouter>);
    expect(await screen.findByText("Seu pedido em andamento")).toBeTruthy();
  });

  it("does not resurrect a settled order from resumeLatest", () => {
    session.user = { id: 7, name: "Maria Silva", email: "maria@example.com", role: "user" };
    setTrpc("stockCheckout.resumeLatest.useQuery", () => ({ data: resumeBody({ status: "paid" }), isLoading: false, error: null, refetch: vi.fn() }));
    render(<MemoryRouter><CartProvider><Pagamento /></CartProvider></MemoryRouter>);
    expect(screen.queryByText("Seu pedido em andamento")).toBeNull();
  });

  it("shows the normal empty state when there is nothing to recover", () => {
    session.user = { id: 7, name: "Maria Silva", email: "maria@example.com", role: "user" };
    render(<MemoryRouter><CartProvider><Pagamento /></CartProvider></MemoryRouter>);
    expect(screen.queryByText("Seu pedido em andamento")).toBeNull();
    expect(screen.queryByText("Pagamento aprovado")).toBeNull();
  });
});

describe("Pagamento — resume safety with a full cart (localStorage lost / other device)", () => {
  const notFound = () => Promise.reject(Object.assign(new Error("nf"), { data: { code: "NOT_FOUND" } }));
  beforeEach(() => {
    setTrpc("utils.stockCheckout.resumeLatest.fetch", () => resumeLatest());
    resume.mockImplementation(notFound);
  });

  it("consults the backend first: an open attempt of the same user blocks a second charge and create is never called", async () => {
    resumeLatest.mockResolvedValue(resumeBody({ attemptId: "attempt-0000000000000077", status: "pending" }));
    const user = mountPagamento();
    const status = await screen.findByRole("status");
    expect(status.getAttribute("data-stock-status")).toBe("pending");
    expect(within(status).getByRole("link", { name: "Continuar pagamento" })).toBeTruthy();
    await fillCheckout(user);
    expect(finalize().disabled).toBe(true);
    expect(create).not.toHaveBeenCalled();
  });

  it("a settled older order from resumeLatest is not shown as pending, does not confirm and does not clear the cart", async () => {
    resumeLatest.mockResolvedValue(resumeBody({ status: "paid", checkoutUrl: undefined }));
    const user = mountPagamento();
    await waitFor(() => expect(resumeLatest).toHaveBeenCalled());
    await fillCheckout(user);
    await waitFor(() => expect(finalize().disabled).toBe(false));
    expect(screen.queryByText("Pagamento aprovado")).toBeNull();
    expect(screen.queryByText("Aguardando confirmação do pagamento")).toBeNull();
    expect(window.localStorage.getItem("loja-escoteira:cart")).not.toBeNull();
  });

  it("cancelled/expired older attempts do not block the user from buying again", async () => {
    resumeLatest.mockResolvedValue(resumeBody({ status: "cancelled", canStartNewAttempt: true, checkoutUrl: undefined }));
    const user = mountPagamento();
    await waitFor(() => expect(resumeLatest).toHaveBeenCalled());
    await fillCheckout(user);
    await waitFor(() => expect(finalize().disabled).toBe(false));
  });

  it("a network error while asking the backend is not a definitive 'no attempt': checkout stays blocked and offers to re-check", async () => {
    resumeLatest.mockRejectedValue(new TypeError("Failed to fetch"));
    const user = mountPagamento();
    expect(await screen.findByText(/Não foi possível consultar esta tentativa/)).toBeTruthy();
    await fillCheckout(user);
    expect(finalize().disabled).toBe(true);
    expect(create).not.toHaveBeenCalled();
    resumeLatest.mockResolvedValue(null);
    await user.click(screen.getByRole("button", { name: "Consultar status" }));
    await waitFor(() => expect(finalize().disabled).toBe(false));
  });

  it("does not allow starting an attempt while the backend is still being consulted", async () => {
    let release: (value: unknown) => void = () => {};
    resumeLatest.mockImplementation(() => new Promise(resolve => { release = resolve; }));
    const user = mountPagamento();
    await fillCheckout(user);
    expect(finalize().disabled).toBe(true);
    await act(async () => { release(null); });
    await waitFor(() => expect(finalize().disabled).toBe(false));
    expect(create).not.toHaveBeenCalled();
    void user;
  });

  it("survives a reload: the stored attempt is resumed from the backend, not recreated", async () => {
    resume.mockImplementation(echo({ status: "pending" }));
    mountPagamento({ attempt: { status: "pending" } });
    const status = await screen.findByRole("status");
    expect(status.getAttribute("data-stock-status")).toBe("pending");
    expect(resume).toHaveBeenCalledWith({ attemptId: ATTEMPT });
    expect(create).not.toHaveBeenCalled();
  });
});

describe("Pagamento — stable error codes", () => {
  const codeError = (code: string, trpc = "CONFLICT") => Object.assign(new Error("texto qualquer"), { data: { code: trpc, appError: { code } } });

  it("CHECKOUT_ATTEMPT_EXPIRED: the next click uses a NEW attemptId", async () => {
    create.mockRejectedValueOnce(codeError("CHECKOUT_ATTEMPT_EXPIRED"))
      .mockImplementation(async (request: { attemptId: string }) => ({ attemptId: request.attemptId, orderId: "502", status: "pending", amountCents: 9990, replayed: false }));
    resume.mockRejectedValue(Object.assign(new Error("nf"), { data: { code: "NOT_FOUND" } }));
    const user = mountPagamento();
    await fillCheckout(user);
    await waitFor(() => expect(finalize().disabled).toBe(false));
    await user.click(finalize());
    expect(await screen.findByText(/A reserva expirou/)).toBeTruthy();
    await waitFor(() => expect(finalize().disabled).toBe(false));
    await user.click(finalize());
    await waitFor(() => expect(create).toHaveBeenCalledTimes(2));
    expect(create.mock.calls[1][0].attemptId).not.toBe(create.mock.calls[0][0].attemptId);
  });

  it("PAYMENT_UNDER_ANALYSIS keeps the button blocked until the backend reconciles, even if the re-query finds nothing", async () => {
    create.mockRejectedValue(codeError("PAYMENT_UNDER_ANALYSIS"));
    resume.mockRejectedValue(Object.assign(new Error("nf"), { data: { code: "NOT_FOUND" } }));
    const user = mountPagamento();
    await fillCheckout(user);
    await waitFor(() => expect(finalize().disabled).toBe(false));
    await user.click(finalize());
    expect(await screen.findByText(/O pagamento está em análise/)).toBeTruthy();
    await waitFor(() => expect(resume).toHaveBeenCalled());
    await waitFor(() => expect(finalize().disabled).toBe(true));
    expect(create).toHaveBeenCalledTimes(1);
  });

  it("ignores message text: a 'STOCK_UNAVAILABLE' message without data.appError.code is treated as an unknown outcome", async () => {
    create.mockRejectedValue(new Error("STOCK_UNAVAILABLE"));
    resume.mockRejectedValue(Object.assign(new Error("nf"), { data: { code: "NOT_FOUND" } }));
    const user = mountPagamento();
    await fillCheckout(user);
    await waitFor(() => expect(finalize().disabled).toBe(false));
    await user.click(finalize());
    expect(await screen.findByText(/Falha de conexão/)).toBeTruthy();
    expect(screen.queryByText(/acabou de ficar indisponível/)).toBeNull();
  });
});
