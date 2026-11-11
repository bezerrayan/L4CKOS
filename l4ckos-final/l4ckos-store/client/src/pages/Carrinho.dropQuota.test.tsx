// @vitest-environment jsdom
import "../test/setupDom";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../lib/trpc", async () => await import("../test/fakeTrpc"));

import { CartProvider } from "../contexts/CartContext";
import { cartItem, product, seedCart, variant } from "../test/fixtures";
import { resetTrpc, setTrpc } from "../test/fakeTrpc";
import { serveCatalog } from "../test/v6Catalog";
import Carrinho from "./Carrinho";

type Viewer = { status: string; unitsRemaining?: number; unitLimit?: number };
const dropView = (viewer: Viewer, over: { id?: number; open?: boolean } = {}) => ({
  exclusive: true,
  drop: { id: over.id ?? 7, name: "Drop XIV", requiresAuthorization: true, purchaseWindow: { open: over.open ?? true } },
  viewer,
});
const serveDrops = (views: Record<number, unknown>) =>
  setTrpc("utils.exclusiveDrops.forProduct.fetch", async (input: { productId: number }) => views[input.productId] ?? { exclusive: false });

const line = (productId: number, size: string, variantId: number, quantity = 1) =>
  cartItem({ product: product({ id: productId, name: `Peça ${productId}` }), quantity, selectedOptions: { cor: "Preto", tamanho: size }, variant: variant({ variantId, size }) });

function setup(items = [line(1, "M", 11)]) {
  seedCart(items);
  const user = userEvent.setup();
  render(<MemoryRouter><CartProvider><Carrinho /></CartProvider></MemoryRouter>);
  return user;
}
const plusButtons = () => screen.getAllByRole("button", { name: "+" }) as HTMLButtonElement[];

beforeEach(() => { resetTrpc(); serveCatalog({ productIds: [1, 2], variants: [{ variantId: 11, color: "Preto", size: "M", price: 9990, availableUnits: 9 }, { variantId: 12, color: "Preto", size: "G", price: 9990, availableUnits: 9 }] }); });

describe("Carrinho: exclusive-drop purchase limits (server view, never invented)", () => {
  it("states the maximum and blocks '+' at the limit while checkout stays available", async () => {
    serveDrops({ 1: dropView({ status: "unlocked", unitsRemaining: 1, unitLimit: 1 }) });
    setup();
    const notice = await screen.findByText(/Limite de “Drop XIV” atingido: 1 unidade na sacola/);
    expect(notice.closest("[data-drop-quota]")?.getAttribute("data-drop-quota")).toBe("limit_reached");
    expect(plusButtons()[0].disabled).toBe(true);
    expect(await screen.findByRole("link", { name: "Finalizar compra" })).toBeTruthy();
    expect(screen.getByText(/confirmados ao finalizar o pedido/)).toBeTruthy();
  });

  it("allows '+' up to the cap and clamps there (sizes of one product add up)", async () => {
    serveDrops({ 1: dropView({ status: "unlocked", unitsRemaining: 2, unitLimit: 2 }) });
    const user = setup([line(1, "M", 11, 1)]);
    await screen.findByText(/até 2 unidades/);
    expect(plusButtons()[0].disabled).toBe(false);
    await user.click(plusButtons()[0]);
    await waitFor(() => expect(plusButtons()[0].disabled).toBe(true));
    expect(screen.getByText(/Limite de “Drop XIV” atingido: 2 unidades/)).toBeTruthy();
  });

  it("shares ONE cap across products of the drop: an item over the shared limit shows a warning and blocks checkout", async () => {
    const shared = dropView({ status: "unlocked", unitsRemaining: 1, unitLimit: 1 });
    serveDrops({ 1: shared, 2: shared });
    setup([line(1, "M", 11), line(2, "G", 12)]);
    const alert = await screen.findByRole("alert", { name: "" }).catch(() => null);
    expect(alert).not.toBeNull();
    expect(await screen.findByText(/acima do seu limite de 1 unidade\. Remova 1 unidade para continuar/)).toBeTruthy();
    const blocked = await screen.findByRole("button", { name: "Revise o limite do drop" });
    expect((blocked as HTMLButtonElement).disabled).toBe(true);
    expect(screen.queryByRole("link", { name: "Finalizar compra" })).toBeNull();
    for (const plus of plusButtons()) expect(plus.disabled).toBe(true);
  });

  it("explains a missing authorisation and a closed window (blocking, no invented numbers)", async () => {
    serveDrops({ 1: dropView({ status: "pending" }) });
    setup();
    expect(await screen.findByText(/exige acesso aprovado e desbloqueado nesta conta/)).toBeTruthy();
    expect(await screen.findByRole("button", { name: "Revise o limite do drop" })).toBeTruthy();
  });

  it("applies no cap when the server view is unavailable (checkout stays the definitive gate)", async () => {
    setTrpc("utils.exclusiveDrops.forProduct.fetch", async () => { throw new Error("offline"); });
    const user = setup();
    expect(await screen.findByRole("link", { name: "Finalizar compra" })).toBeTruthy();
    expect(document.querySelector("[data-drop-quota]")).toBeNull();
    expect(plusButtons()[0].disabled).toBe(false);
    await user.click(plusButtons()[0]);
    expect(screen.getAllByText("2").length).toBeGreaterThan(0);
  });

  it("treats a signed-out viewer (expired session) as needing login, not as a limit", async () => {
    serveDrops({ 1: dropView({ status: "login_required" }) });
    setup();
    expect(await screen.findByText(/Entre na sua conta para validar o seu limite/)).toBeTruthy();
    expect(screen.getByRole("link", { name: "Entrar" })).toBeTruthy();
  });

  it("does not show anything for non-exclusive products", async () => {
    serveDrops({});
    setup();
    await screen.findByRole("link", { name: "Finalizar compra" });
    expect(document.querySelector("[data-drop-quota]")).toBeNull();
  });
});
