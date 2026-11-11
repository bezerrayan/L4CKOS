// @vitest-environment jsdom
import "../test/setupDom";
import { act, render, screen, waitFor } from "@testing-library/react";
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
import { ATTEMPTS_STORAGE_KEY, getOrCreateStockAttemptId, saveStockAttemptStatus } from "../stock/stockCheckoutClient";
import { resetTrpc, setTrpc } from "../test/fakeTrpc";
import { cartItem, seedCart } from "../test/fixtures";
import Pagamento from "./Pagamento";

const ATTEMPT = "attempt-0000000000000001";
const ITEMS = [{ productId: 1, variantId: 11, quantity: 1 }];
const localOption = { id: "local-plano-piloto", label: "Entrega local - Plano Piloto", description: "Agendamento", price: 0, minDays: 1, maxDays: 2 };
const userA = { id: 7, name: "Maria Silva", email: "maria@example.com", role: "user" };
const userB = { id: 8, name: "Bruno Souza", email: "bruno@example.com", role: "user" };
const notFound = () => Promise.reject(Object.assign(new Error("nf"), { data: { code: "NOT_FOUND" } }));
const trpcError = (code: string, appCode?: string) => Object.assign(new Error("texto qualquer"), { data: { code, ...(appCode ? { appError: { code: appCode } } : {}) } });

const body = (over: Record<string, unknown> = {}) => ({
  attemptId: ATTEMPT, status: "pending", orderId: "501", amountCents: 9990,
  reservationExpiresAt: "2026-12-01T12:00:00.000Z", canStartNewAttempt: false, checkoutUrl: "https://pay.example/501", ...over,
});

const create = vi.fn();
const resume = vi.fn();
const resumeLatest = vi.fn();

function seedLocalAttempt(userId: number, status: string, canStartNewAttempt = false, items = ITEMS) {
  const storage = createUserAttemptStorage(userId);
  getOrCreateStockAttemptId({ storage, items, createId: () => ATTEMPT });
  saveStockAttemptStatus({ storage, items, attemptId: ATTEMPT, status: status as never, canStartNewAttempt });
}

function mount({ user = userA as typeof userA | null, items = [cartItem()] } = {}) {
  session.user = user;
  seedCart(items);
  const ui = () => <MemoryRouter initialEntries={["/checkout"]}><CartProvider><Pagamento /></CartProvider></MemoryRouter>;
  const utils = render(ui());
  return { user: userEvent.setup(), switchTo: (next: typeof userA | null) => { session.user = next; utils.rerender(ui()); } };
}

async function fillCheckout(user: ReturnType<typeof userEvent.setup>) {
  if (!screen.queryByLabelText(/CPF ou CNPJ/)) return;
  await user.type(screen.getByLabelText(/CPF ou CNPJ/), "12345678909");
  await user.type(screen.getByLabelText(/^CEP/), "70040010");
  await user.click(await screen.findByRole("button", { name: /Entrega local - Plano Piloto/ }, { timeout: 3000 }));
  await user.type(screen.getByLabelText(/^Número/), "10");
}
const finalize = () => screen.getByRole("button", { name: /Finalizar compra|Compra em acompanhamento|Preparando checkout/ }) as HTMLButtonElement;
const ready = async () => { await waitFor(() => expect(finalize().disabled).toBe(false)); };

beforeEach(() => {
  resetTrpc();
  create.mockReset(); resume.mockReset(); resumeLatest.mockReset(); csrfFetch.mockReset();
  csrfFetch.mockResolvedValue({ ok: true, status: 200, json: async () => ({ options: [localOption] }) });
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ logradouro: "SQS 308", bairro: "Asa Sul", localidade: "Brasília", uf: "DF" }) })));
  setTrpc("stockCheckout.create.useMutation", () => ({ mutateAsync: create, isPending: false, error: null }));
  setTrpc("utils.stockCheckout.resume.fetch", (input: { attemptId: string }) => resume(input));
  setTrpc("utils.stockCheckout.resumeLatest.fetch", () => resumeLatest());
  setTrpc("stockCheckout.resumeLatest.useQuery", () => ({ data: undefined, isLoading: false, error: null, refetch: vi.fn() }));
  setTrpc("stockCheckout.resume.useQuery", ({ attemptId }: { attemptId: string }) => ({ data: body({ attemptId }), isLoading: false, isFetching: false, error: null, refetch: vi.fn() }));
  resume.mockImplementation(notFound);
  resumeLatest.mockResolvedValue(null);
});

describe("account switch (same browser)", () => {
  it("A's pending attempt is not shown to B and B's resume never uses A's attemptId", async () => {
    seedLocalAttempt(userA.id, "pending");
    resume.mockImplementation(({ attemptId }: { attemptId: string }) => Promise.resolve(body({ attemptId })));
    const { switchTo } = mount({ user: userA });
    expect((await screen.findByRole("status")).getAttribute("data-stock-status")).toBe("pending");
    expect(screen.getByText("Pedido #501")).toBeTruthy();
    resume.mockClear();
    resume.mockImplementation(notFound);
    switchTo(userB);
    await waitFor(() => expect(screen.queryByText("Pedido #501")).toBeNull());
    expect(screen.queryByText("Aguardando confirmação do pagamento")).toBeNull();
    expect(resume).not.toHaveBeenCalledWith({ attemptId: ATTEMPT });
    expect(create).not.toHaveBeenCalled();
  });

  it("A's payment confirmation is not carried over to B", async () => {
    seedLocalAttempt(userA.id, "pending");
    resume.mockResolvedValue(body({ status: "paid", checkoutUrl: undefined }));
    const { switchTo } = mount({ user: userA });
    expect(await screen.findByText("Pagamento aprovado")).toBeTruthy();
    switchTo(userB);
    await waitFor(() => expect(screen.queryByText("Pagamento aprovado")).toBeNull());
    expect(screen.queryByText("Pedido #501")).toBeNull();
  });

  it("after logout, a previously fetched server attempt is not rendered as 'seu pedido em andamento'", () => {
    setTrpc("stockCheckout.resumeLatest.useQuery", () => ({ data: body(), isLoading: false, error: null, refetch: vi.fn() }));
    mount({ user: null, items: [] });
    expect(screen.queryByText("Seu pedido em andamento")).toBeNull();
    expect(screen.queryByText("Pedido #501")).toBeNull();
  });

  it("B does not see A's form data after the switch", async () => {
    const { user, switchTo } = mount({ user: userA });
    await user.type(screen.getByLabelText(/CPF ou CNPJ/), "12345678909");
    expect((screen.getByLabelText(/CPF ou CNPJ/) as HTMLInputElement).value).not.toBe("");
    switchTo(userB);
    await waitFor(() => expect((screen.getByLabelText(/CPF ou CNPJ/) as HTMLInputElement).value).toBe(""));
  });

  it("an authorization failure on resume never falls back to creating or showing anything", async () => {
    seedLocalAttempt(userA.id, "pending");
    resume.mockRejectedValue(trpcError("UNAUTHORIZED"));
    const { user } = mount({ user: userA });
    expect(await screen.findByText(/Não foi possível consultar esta tentativa/)).toBeTruthy();
    await fillCheckout(user);
    expect(finalize().disabled).toBe(true);
    expect(create).not.toHaveBeenCalled();
    expect(screen.queryByRole("status")).toBeNull();
  });
});

describe("multiple tabs and reloads", () => {
  it("another tab creating the attempt is picked up via the storage event, before any click here", async () => {
    const { user } = mount({ user: userA });
    await fillCheckout(user);
    await ready();
    resume.mockImplementation(({ attemptId }: { attemptId: string }) => Promise.resolve(body({ attemptId })));
    seedLocalAttempt(userA.id, "pending"); // what tab 1 wrote
    await act(async () => {
      window.dispatchEvent(new StorageEvent("storage", { key: `l4ckos:user:${userA.id}:${ATTEMPTS_STORAGE_KEY}` }));
    });
    expect((await screen.findByRole("status")).getAttribute("data-stock-status")).toBe("pending");
    expect(finalize().disabled).toBe(true);
    expect(create).not.toHaveBeenCalled();
  });

  it("storage events from another account's registry are ignored", async () => {
    mount({ user: userA });
    await waitFor(() => expect(resumeLatest).toHaveBeenCalled());
    resumeLatest.mockClear(); resume.mockClear();
    await act(async () => {
      window.dispatchEvent(new StorageEvent("storage", { key: `l4ckos:user:${userB.id}:${ATTEMPTS_STORAGE_KEY}` }));
    });
    expect(resume).not.toHaveBeenCalled();
    expect(resumeLatest).not.toHaveBeenCalled();
  });

  it("reload while the first create was still in flight: the same attemptId is reused, never a new one", async () => {
    seedLocalAttempt(userA.id, "pending"); // written before the request left; server has not persisted it
    create.mockImplementation(async (request: { attemptId: string }) => ({ attemptId: request.attemptId, orderId: "501", status: "pending", amountCents: 9990, replayed: true }));
    resume.mockImplementationOnce(notFound).mockImplementation(({ attemptId }: { attemptId: string }) => Promise.resolve(body({ attemptId })));
    const { user } = mount({ user: userA });
    await fillCheckout(user);
    await ready();
    await user.click(finalize());
    await waitFor(() => expect(create).toHaveBeenCalledTimes(1));
    expect(create.mock.calls[0][0].attemptId).toBe(ATTEMPT);
  });

  it("clearing localStorage with an attempt alive on the server: the backend is asked and no new charge is possible", async () => {
    resumeLatest.mockResolvedValue(body({ attemptId: "attempt-0000000000000099", status: "ambiguous", checkoutUrl: undefined }));
    const { user } = mount({ user: userA });
    expect(await screen.findByText("Pagamento em análise")).toBeTruthy();
    await fillCheckout(user);
    expect(finalize().disabled).toBe(true);
    expect(create).not.toHaveBeenCalled();
  });

  it("with items in the cart, a cached server attempt feeds the status card on the form, not a replacement screen", async () => {
    setTrpc("stockCheckout.resumeLatest.useQuery", () => ({ data: body({ status: "pending" }), isLoading: false, error: null, refetch: vi.fn() }));
    resumeLatest.mockResolvedValue(body({ attemptId: "attempt-0000000000000099", status: "pending" }));
    mount({ user: userA });
    expect((await screen.findByRole("status")).getAttribute("data-stock-status")).toBe("pending");
    expect(screen.queryByText("Seu pedido em andamento")).toBeNull();
    expect(screen.getByLabelText(/CPF ou CNPJ/)).toBeTruthy();
    expect(finalize().disabled).toBe(true);
  });

  it("cart changed after an attempt exists: the open attempt still blocks a second one", async () => {
    seedLocalAttempt(userA.id, "pending"); // fingerprint of qty 1
    resumeLatest.mockResolvedValue(body({ attemptId: ATTEMPT, status: "pending" }));
    const { user } = mount({ user: userA, items: [cartItem({ quantity: 2 })] });
    expect((await screen.findByRole("status")).getAttribute("data-stock-status")).toBe("pending");
    await fillCheckout(user);
    expect(finalize().disabled).toBe(true);
    expect(create).not.toHaveBeenCalled();
  });
});

describe("failures never cause an automatic second charge", () => {
  it("API unavailable on load: no automatic create, checkout stays blocked until re-checked", async () => {
    seedLocalAttempt(userA.id, "pending");
    resume.mockRejectedValue(trpcError("INTERNAL_SERVER_ERROR"));
    const { user } = mount({ user: userA });
    expect(await screen.findByText(/Não foi possível consultar esta tentativa/)).toBeTruthy();
    await fillCheckout(user);
    expect(finalize().disabled).toBe(true);
    expect(create).not.toHaveBeenCalled();
  });

  it("timeout on create, address corrected, retry: SAME attemptId is sent (server decides), never a fresh one", async () => {
    create.mockRejectedValueOnce(new TypeError("Failed to fetch"))
      .mockRejectedValue(trpcError("CONFLICT", "CHECKOUT_ATTEMPT_NOT_REUSABLE"));
    const { user } = mount({ user: userA });
    await fillCheckout(user);
    await ready();
    await user.click(finalize());
    expect(await screen.findByText(/Falha de conexão/)).toBeTruthy();
    await user.clear(screen.getByLabelText(/^Número/));
    await user.type(screen.getByLabelText(/^Número/), "99");
    resume.mockImplementation(({ attemptId }: { attemptId: string }) => Promise.resolve(body({ attemptId })));
    await ready();
    await user.click(finalize());
    await waitFor(() => expect(create).toHaveBeenCalledTimes(2));
    expect(create.mock.calls[1][0].attemptId).toBe(create.mock.calls[0][0].attemptId);
    expect(create.mock.calls[1][0].delivery.address.number).toBe("99");
    // The server refused to reuse it: the customer is told to check status and is blocked, not re-charged.
    expect(await screen.findByText(/não pode ser repetida/)).toBeTruthy();
    await waitFor(() => expect(finalize().disabled).toBe(true));
    expect(create).toHaveBeenCalledTimes(2);
  });

  it("session expired during create: asks to sign in again, keeps the cart, and does not rotate the attemptId", async () => {
    create.mockRejectedValueOnce(trpcError("UNAUTHORIZED"))
      .mockImplementation(async (request: { attemptId: string }) => ({ attemptId: request.attemptId, orderId: "501", status: "pending", amountCents: 9990, replayed: false }));
    const { user } = mount({ user: userA });
    await fillCheckout(user);
    await ready();
    await user.click(finalize());
    expect(await screen.findByText(/sessão expirou/)).toBeTruthy();
    expect(window.localStorage.getItem("loja-escoteira:cart")).not.toBeNull();
    await ready();
    await user.click(finalize());
    await waitFor(() => expect(create).toHaveBeenCalledTimes(2));
    expect(create.mock.calls[1][0].attemptId).toBe(create.mock.calls[0][0].attemptId);
  });

  it.each([
    ["failed", "Pagamento não concluído"],
    ["cancelled", "Pedido cancelado"],
    ["expired", "Tentativa expirada"],
  ])("%s without server release keeps the button blocked (no premature retry)", async (status, title) => {
    seedLocalAttempt(userA.id, status, false);
    resume.mockResolvedValue(body({ status, canStartNewAttempt: false, checkoutUrl: undefined }));
    const { user } = mount({ user: userA });
    expect(await screen.findByText(title)).toBeTruthy();
    await fillCheckout(user);
    expect(finalize().disabled).toBe(true);
    expect(create).not.toHaveBeenCalled();
  });

  it("a paid attempt is never presented as pending and never offers payment again", async () => {
    seedLocalAttempt(userA.id, "pending");
    resume.mockResolvedValue(body({ status: "paid", checkoutUrl: "https://pay.example/501" }));
    mount({ user: userA });
    expect(await screen.findByText("Pagamento aprovado")).toBeTruthy();
    expect(screen.queryByText("Aguardando confirmação do pagamento")).toBeNull();
    expect(screen.queryByRole("link", { name: "Continuar pagamento" })).toBeNull();
  });

  it("create reporting 'paid' is not a confirmation: only the backend resume can confirm", async () => {
    create.mockResolvedValue({ attemptId: ATTEMPT, orderId: "501", status: "paid", amountCents: 9990, replayed: false });
    const { user } = mount({ user: userA });
    await fillCheckout(user);
    await ready();
    resume.mockImplementation(({ attemptId }: { attemptId: string }) => Promise.resolve(body({ attemptId, status: "pending" })));
    await user.click(finalize());
    expect((await screen.findByRole("status")).getAttribute("data-stock-status")).toBe("pending");
    expect(screen.queryByText("Pagamento aprovado")).toBeNull();
    expect(window.localStorage.getItem("loja-escoteira:cart")).not.toBeNull();
  });
});
