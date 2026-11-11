// @vitest-environment jsdom
import "../../../test/setupDom";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../lib/trpc", async () => await import("../../../test/fakeTrpc"));

import { resetTrpc, setTrpc } from "../../../test/fakeTrpc";
import AdminExclusiveDrops from "./AdminExclusiveDrops";

const drop = {
  id: 1, slug: "xiv-bis", name: "Clã XIV Bis × L4CKOS", description: null, state: "active", timezone: "America/Sao_Paulo", requiresAuthorization: true,
  requestWindow: { startsAt: null, endsAt: null, open: true }, purchaseWindow: { startsAt: "2026-11-20T12:00:00.000Z", endsAt: "2026-11-30T15:00:00.000Z", open: true },
  storedStatus: "published", defaultUnitLimit: 3, productIds: [4],
};
const requestRow = (over: Record<string, unknown> = {}) => ({
  requestId: 10, dropId: 1, dropName: drop.name, userId: 81, userName: "Integrante Um", userEmail: "um@example.invalid", status: "pending", createdAt: "2026-11-20T10:00:00.000Z", decidedAt: null, grant: null, ...over,
});

const approve = vi.fn(); const reject = vi.fn(); const revoke = vi.fn(); const reissue = vi.fn(); const saveDrop = vi.fn();
let rows: ReturnType<typeof requestRow>[] = [];
const lastFilter = vi.fn();

beforeEach(() => {
  resetTrpc();
  for (const fn of [approve, reject, revoke, reissue, saveDrop, lastFilter]) fn.mockReset();
  approve.mockResolvedValue({ grantId: 5, code: "ABCDE-FGHJK-MNPQR-STVWX", unitLimit: 3, expiresAt: "x" });
  reissue.mockResolvedValue({ grantId: 5, code: "ZZZZZ-YYYYY-XXXXX-WWWWW" });
  reject.mockResolvedValue({ status: "rejected" }); revoke.mockResolvedValue({ status: "revoked" }); saveDrop.mockResolvedValue({ dropId: 1 });
  rows = [requestRow()];
  setTrpc("exclusiveDrops.admin.listDrops.useQuery", () => ({ data: [drop], isLoading: false }));
  setTrpc("exclusiveDrops.admin.listRequests.useQuery", (filter: unknown) => { lastFilter(filter); return { data: rows, isLoading: false }; });
  setTrpc("exclusiveDrops.admin.history.useQuery", () => ({ data: [{ id: 1, event: "requested", details: null, actorUserId: null, createdAt: "2026-11-20T10:00:00.000Z" }, { id: 2, event: "approved", details: "limit=3", actorUserId: 83, createdAt: "2026-11-20T11:00:00.000Z" }] }));
  for (const [name, fn] of [["approve", approve], ["reject", reject], ["revoke", revoke], ["reissueCode", reissue], ["saveDrop", saveDrop]] as const) {
    setTrpc(`exclusiveDrops.admin.${name}.useMutation`, () => ({ mutateAsync: fn, isPending: false }));
  }
  setTrpc("utils.exclusiveDrops.admin.listDrops.invalidate", async () => undefined);
  setTrpc("utils.exclusiveDrops.admin.listRequests.invalidate", async () => undefined);
});

describe("AdminExclusiveDrops", () => {
  it("lists drops (timezone shown) and requests with status", () => {
    render(<AdminExclusiveDrops />);
    expect(screen.getAllByText("Clã XIV Bis × L4CKOS").length).toBeGreaterThan(0);
    expect(screen.getByText("America/Sao_Paulo")).toBeTruthy();
    expect(within(screen.getByRole("table", { name: "Solicitações de acesso" })).getByText("Pendente")).toBeTruthy();
    expect(screen.getByText("Integrante Um")).toBeTruthy();
  });

  it("filters by drop and status through the query input", async () => {
    const user = userEvent.setup();
    render(<AdminExclusiveDrops />);
    await user.selectOptions(screen.getByLabelText("Drop"), "1");
    await user.selectOptions(screen.getByLabelText("Status"), "pending");
    expect(lastFilter).toHaveBeenLastCalledWith({ dropId: 1, status: "pending" });
  });

  it("approves with a unit limit and an explicit-offset expiry, then shows the code ONCE", async () => {
    const user = userEvent.setup();
    render(<AdminExclusiveDrops />);
    await user.click(screen.getByRole("button", { name: "Aprovar" }));
    const form = screen.getByRole("form", { name: "Aprovar solicitação" });
    const limit = within(form).getByLabelText(/Unidades autorizadas/) as HTMLInputElement;
    expect(limit.value).toBe("3"); // drop default
    await user.clear(limit); await user.type(limit, "2");
    await user.click(within(form).getByRole("button", { name: "Aprovar e gerar código" }));
    await waitFor(() => expect(approve).toHaveBeenCalled());
    const input = approve.mock.calls[0][0];
    expect(input).toMatchObject({ requestId: 10, unitLimit: 2 });
    expect(input.expiresAt).toMatch(/-03:00$/); // drop timezone, explicit offset
    expect((await screen.findByTestId("issued-code")).textContent).toBe("ABCDE-FGHJK-MNPQR-STVWX");
    await user.click(screen.getByRole("button", { name: /Já copiei/ }));
    expect(screen.queryByTestId("issued-code")).toBeNull();
    expect(document.body.textContent).not.toContain("ABCDE-FGHJK");
  });

  it("rejects pending requests; revokes and reissues for approved ones (new code once)", async () => {
    const user = userEvent.setup();
    const { unmount } = render(<AdminExclusiveDrops />);
    await user.click(screen.getByRole("button", { name: "Recusar" }));
    expect(reject).toHaveBeenCalledWith({ requestId: 10 });
    unmount();

    rows = [requestRow({ status: "approved", grant: { id: 5, unitLimit: 3, unitsUsed: 2, unitsReserved: 1, unitsConsumed: 1, expiresAt: "2026-11-30T15:00:00.000Z", unlocked: true } })];
    render(<AdminExclusiveDrops />);
    expect(screen.getByText(/até 3 un\. · reservadas 1 · compradas 1/)).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Revogar" }));
    expect(revoke).not.toHaveBeenCalled(); // irreversible: needs an explicit second click
    await user.click(screen.getByRole("button", { name: "Confirmar revogação" }));
    expect(revoke).toHaveBeenCalledWith({ requestId: 10 });
    await user.click(screen.getByRole("button", { name: "Reemitir código" }));
    expect(reissue).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Confirmar reemissão" }));
    expect((await screen.findByTestId("issued-code")).textContent).toBe("ZZZZZ-YYYYY-XXXXX-WWWWW");
  });

  it("a double click on 'Aprovar e gerar código' approves ONCE (no second request, no confusing 'already approved' error)", async () => {
    const user = userEvent.setup();
    let release: (value: unknown) => void = () => {};
    approve.mockImplementation(() => new Promise(resolve => { release = resolve; }));
    render(<AdminExclusiveDrops />);
    await user.click(screen.getByRole("button", { name: "Aprovar" }));
    await user.dblClick(screen.getByRole("button", { name: "Aprovar e gerar código" }));
    release({ grantId: 5, code: "ABCDE-FGHJK-MNPQR-STVWX", unitLimit: 3, expiresAt: "x" });
    await screen.findByTestId("issued-code");
    expect(approve).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("alert", { name: "" })?.textContent ?? "").not.toMatch(/já aprovada/);
  });

  it("a double click on the reissue confirmation re-issues ONCE (a second call would silently kill the code just shown)", async () => {
    const user = userEvent.setup();
    rows = [requestRow({ status: "approved", grant: { id: 5, unitLimit: 3, unitsUsed: 0, unitsReserved: 0, unitsConsumed: 0, expiresAt: "2026-11-30T15:00:00.000Z", unlocked: true } })];
    let release: (value: unknown) => void = () => {};
    reissue.mockImplementation(() => new Promise(resolve => { release = resolve; }));
    render(<AdminExclusiveDrops />);
    await user.click(screen.getByRole("button", { name: "Reemitir código" }));
    await user.dblClick(screen.getByRole("button", { name: "Confirmar reemissão" }));
    release({ grantId: 5, code: "ZZZZZ-YYYYY-XXXXX-WWWWW" });
    await screen.findByTestId("issued-code");
    expect(reissue).toHaveBeenCalledTimes(1);
  });

  it("moves focus to the approval form when it opens (it appears far below the row)", async () => {
    const user = userEvent.setup();
    render(<AdminExclusiveDrops />);
    await user.click(screen.getByRole("button", { name: "Aprovar" }));
    expect(document.activeElement).toBe(screen.getByRole("form", { name: "Aprovar solicitação" }));
  });

  it("shows loading and error states instead of a misleading 'nenhuma solicitação'", () => {
    setTrpc("exclusiveDrops.admin.listRequests.useQuery", () => ({ data: undefined, isLoading: true, error: null }));
    const { unmount } = render(<AdminExclusiveDrops />);
    expect(screen.getByText("Carregando solicitações…")).toBeTruthy();
    expect(screen.queryByText("Nenhuma solicitação.")).toBeNull();
    unmount();
    setTrpc("exclusiveDrops.admin.listRequests.useQuery", () => ({ data: undefined, isLoading: false, error: new Error("down") }));
    render(<AdminExclusiveDrops />);
    expect(screen.getByRole("alert", { name: "" }).textContent ?? "").toBeDefined();
    expect(screen.getByText("Não foi possível carregar as solicitações.")).toBeTruthy();
  });

  it("wide tables are keyboard-scrollable labelled regions (small screens)", () => {
    render(<AdminExclusiveDrops />);
    for (const region of screen.getAllByRole("region", { name: /role horizontalmente/ })) expect(region.getAttribute("tabindex")).toBe("0");
  });

  it("shows the authorization history of a request", async () => {
    const user = userEvent.setup();
    render(<AdminExclusiveDrops />);
    await user.click(screen.getByRole("button", { name: "Histórico" }));
    const region = screen.getByRole("region", { name: /Histórico da solicitação 10/ });
    expect(region.textContent).toContain("approved (limit=3)");
    expect(region.textContent).toContain("admin #83");
  });

  it("an API refusal is announced (e.g. already decided)", async () => {
    const user = userEvent.setup();
    reject.mockRejectedValue(Object.assign(new Error("x"), { data: { appError: { message: "Só solicitações pendentes podem ser recusadas." } } }));
    render(<AdminExclusiveDrops />);
    await user.click(screen.getByRole("button", { name: "Recusar" }));
    expect((await screen.findByRole("alert")).textContent).toContain("Só solicitações pendentes");
  });

  it("saves a drop with every date converted to the drop zone's explicit offset", async () => {
    const user = userEvent.setup();
    render(<AdminExclusiveDrops />);
    await user.click(screen.getByRole("button", { name: "Novo drop" }));
    const form = screen.getByRole("form", { name: "Novo drop" });
    await user.type(within(form).getByLabelText("Nome"), "Drop Teste");
    await user.type(within(form).getByLabelText("Slug"), "drop-teste");
    await user.type(within(form).getByLabelText("Compra — início"), "2026-12-01T09:00");
    await user.type(within(form).getByLabelText("Compra — fim"), "2026-12-05T12:00");
    await user.type(within(form).getByLabelText(/IDs dos produtos/), "4, 5");
    await user.click(within(form).getByRole("button", { name: "Salvar drop" }));
    await waitFor(() => expect(saveDrop).toHaveBeenCalled());
    expect(saveDrop.mock.calls[0][0]).toMatchObject({ slug: "drop-teste", purchaseStartsAt: "2026-12-01T09:00:00-03:00", purchaseEndsAt: "2026-12-05T12:00:00-03:00", productIds: [4, 5], status: "draft" });
  });
});
