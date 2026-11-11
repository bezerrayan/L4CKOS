// @vitest-environment jsdom
import "../../test/setupDom";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../lib/trpc", async () => await import("../../test/fakeTrpc"));

import { resetTrpc, setTrpc } from "../../test/fakeTrpc";
import type { ProductDropView, ViewerAccessView } from "../../../../shared/exclusiveDropsV1";
import ExclusiveAccessPanel, { ExclusiveUnlockedNotice, exclusiveErrorMessage } from "./ExclusiveAccessPanel";

type Exclusive = Extract<ProductDropView, { exclusive: true }>;
const view = (viewer: ViewerAccessView, drop: Partial<Exclusive["drop"]> = {}): Exclusive => ({
  exclusive: true,
  drop: {
    id: 7, slug: "xiv-bis", name: "Clã XIV Bis × L4CKOS", description: null, state: "active", timezone: "America/Sao_Paulo", requiresAuthorization: true,
    requestWindow: { startsAt: "2026-11-01T03:00:00.000Z", endsAt: "2026-11-25T02:59:00.000Z", open: true },
    purchaseWindow: { startsAt: "2026-11-20T12:00:00.000Z", endsAt: "2026-11-30T15:00:00.000Z", open: true },
    ...drop,
  },
  viewer,
});

const request = vi.fn();
const redeem = vi.fn();
const invalidate = vi.fn(async () => undefined);

function renderPanel(v: Exclusive) {
  return render(<MemoryRouter><ExclusiveAccessPanel view={v} productId={4} /></MemoryRouter>);
}

beforeEach(() => {
  resetTrpc();
  request.mockReset().mockResolvedValue({ requestId: 1, status: "pending", created: true });
  redeem.mockReset().mockResolvedValue({ unlocked: true });
  invalidate.mockClear();
  setTrpc("exclusiveDrops.requestAccess.useMutation", () => ({ mutateAsync: request, isPending: false }));
  setTrpc("exclusiveDrops.redeemCode.useMutation", () => ({ mutateAsync: redeem, isPending: false }));
  setTrpc("utils.exclusiveDrops.forProduct.invalidate", invalidate);
});

describe("ExclusiveAccessPanel — one state per access status", () => {
  it("always identifies the drop and shows the period in the drop's own timezone", () => {
    renderPanel(view({ status: "none" }));
    expect(screen.getByText("Drop exclusivo")).toBeTruthy();
    expect(screen.getByText("Clã XIV Bis × L4CKOS")).toBeTruthy();
    const period = screen.getByLabelText("Período do drop");
    expect(period.textContent).toContain("09:00"); // 12:00Z = 09:00 America/Sao_Paulo
    expect(period.textContent).toContain("12:00"); // 15:00Z = 12:00
    expect(period.textContent).toContain("Compras abertas");
  });

  it("anonymous: 'Solicitar acesso' sends the visitor to sign in and back to the product", () => {
    renderPanel(view({ status: "login_required" }));
    const link = screen.getByRole("link", { name: "Solicitar acesso" });
    expect(link.getAttribute("href")).toBe("/entrar?next=%2Fproduto%2F4");
    expect(screen.queryByRole("button", { name: /sacola|comprar/i })).toBeNull();
  });

  it("signed in without a request: requests access once, then refreshes the status", async () => {
    const user = userEvent.setup();
    renderPanel(view({ status: "none" }));
    await user.click(screen.getByRole("button", { name: "Solicitar acesso" }));
    expect(request).toHaveBeenCalledWith({ dropId: 7 });
    await waitFor(() => expect(invalidate).toHaveBeenCalled());
  });

  it("request window closed: the button is disabled and says why", () => {
    renderPanel(view({ status: "none" }, { requestWindow: { startsAt: null, endsAt: null, open: false } }));
    expect((screen.getByRole("button", { name: "Solicitar acesso" }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText(/solicitações de acesso não estão abertas/i)).toBeTruthy();
  });

  it("pending: 'Aguardando aprovação' with no purchase or request control", () => {
    renderPanel(view({ status: "pending" }));
    expect(screen.getByRole("status").textContent).toContain("Aguardando aprovação");
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("approved: asks for the individual code with an accessible label and unlocks with it", async () => {
    const user = userEvent.setup();
    renderPanel(view({ status: "approved", unitLimit: 3, unitsRemaining: 3 }));
    const input = screen.getByLabelText("Código individual") as HTMLInputElement;
    expect((screen.getByRole("button", { name: "Desbloquear" }) as HTMLButtonElement).disabled).toBe(true);
    await user.type(input, "abcde-fghjk-mnpqr-stvwx");
    await user.click(screen.getByRole("button", { name: "Desbloquear" }));
    expect(redeem).toHaveBeenCalledWith({ code: "abcde-fghjk-mnpqr-stvwx" });
    await waitFor(() => expect(invalidate).toHaveBeenCalled());
    expect(input.value).toBe(""); // the code does not linger in the field
  });

  it("a wrong code shows a generic, announced error (no hint about whose code it is)", async () => {
    const user = userEvent.setup();
    redeem.mockRejectedValue(Object.assign(new Error("x"), { data: { appError: { code: "EXCLUSIVE_CODE_INVALID" } } }));
    renderPanel(view({ status: "approved" }));
    await user.type(screen.getByLabelText("Código individual"), "AAAAA-BBBBB-CCCCC-DDDDD");
    await user.click(screen.getByRole("button", { name: "Desbloquear" }));
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toBe("Código inválido ou indisponível para esta conta.");
    expect(screen.getByLabelText("Código individual").getAttribute("aria-invalid")).toBe("true");
  });

  it("rejected: states it without internal detail and allows asking again while the window is open", async () => {
    const user = userEvent.setup();
    renderPanel(view({ status: "rejected" }));
    expect(screen.getByText(/não foi aprovada/i)).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Solicitar novamente" }));
    expect(request).toHaveBeenCalled();
  });

  it.each(["revoked", "expired"] as const)("%s: blocks purchase, offers nothing to click", status => {
    renderPanel(view({ status }));
    expect(screen.getByRole("status").textContent).toMatch(/não está mais disponível/);
    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.queryByRole("link")).toBeNull();
  });

  it("closed drop: visible but unavailable for new orders, whatever the viewer status", () => {
    renderPanel(view({ status: "unlocked", unitsRemaining: 2 }, { state: "closed", purchaseWindow: { startsAt: "", endsAt: "2026-11-30T15:00:00.000Z", open: false } }));
    expect(screen.getByRole("status").textContent).toContain("Drop encerrado");
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("unlocked before the window opens: explains when purchases open; with no units left: says so", () => {
    const { unmount } = renderPanel(view({ status: "unlocked", unitsRemaining: 2 }, { state: "scheduled", purchaseWindow: { startsAt: "2026-11-20T12:00:00.000Z", endsAt: "2026-11-30T15:00:00.000Z", open: false } }));
    expect(screen.getByRole("status").textContent).toMatch(/compras abrem em .*09:00/);
    unmount();
    renderPanel(view({ status: "unlocked", unitsRemaining: 0 }));
    expect(screen.getByRole("status").textContent).toMatch(/utilizou todas as unidades/);
  });

  it("request errors are announced from stable codes, never raw text", async () => {
    const user = userEvent.setup();
    request.mockRejectedValue(Object.assign(new Error("SQL syntax error near ..."), { data: { appError: { code: "EXCLUSIVE_REQUEST_WINDOW_CLOSED" } } }));
    renderPanel(view({ status: "none" }));
    await user.click(screen.getByRole("button", { name: "Solicitar acesso" }));
    expect((await screen.findByRole("alert")).textContent).toMatch(/não estão abertas/);
    expect(document.body.textContent).not.toContain("SQL");
    expect(exclusiveErrorMessage(new Error("EXCLUSIVE_CODE_INVALID"))).toMatch(/Tente novamente/); // message text is ignored
  });
});

describe("ExclusiveUnlockedNotice", () => {
  it("tells the viewer how many units (any sizes) they can still buy", () => {
    render(<ExclusiveUnlockedNotice view={view({ status: "unlocked", unitsRemaining: 3 })} />);
    expect(screen.getByRole("status").textContent).toContain("até 3 unidades");
    expect(screen.getByRole("status").textContent).toContain("qualquer combinação de tamanhos");
  });
});
