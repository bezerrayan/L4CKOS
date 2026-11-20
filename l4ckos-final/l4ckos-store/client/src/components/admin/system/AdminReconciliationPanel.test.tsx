import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { AdminReconciliationPanel, formatAge, openCount, type ReconciliationAlertRow } from "./AdminReconciliationPanel";

const row = (over: Partial<ReconciliationAlertRow> = {}): ReconciliationAlertRow => ({
  id: 7, state: "pending", priority: "P1", category: "payment_without_correlation", kind: "PAYMENT_WITHOUT_CORRELATION",
  reasonText: "Pagamento recebido sem vínculo com a tentativa (cobrança não correlacionada).", orderId: 41, attemptRef: "att-abcd…wxyz", paymentRef: "pay_1234…9876",
  detectedAt: "2026-11-15T10:00:00.000Z", ageSeconds: 7300, reviewer: null, ...over,
});
const base = { rows: [row()], summary: { pending: 1, inReview: 0, resolved: 2, openByPriority: { P1: 1, P2: 0, P3: 0 }, oldestOpenAgeSeconds: 7300 }, isLoading: false, isError: false,
  filters: { state: "all", priority: "all", category: "all" }, onFiltersChange: vi.fn(), page: 1, hasPrevious: false, hasNext: true, onPrevious: vi.fn(), onNext: vi.fn(), onRefresh: vi.fn() };
const html = (p: Partial<typeof base> = {}) => renderToStaticMarkup(<AdminReconciliationPanel {...base} {...p} />);

describe("AdminReconciliationPanel (read-only)", () => {
  it("shows status, priority, reason, age, order/attempt/charge references and the counters", () => {
    const out = html();
    for (const text of ["P1", "Pendente", "Pagamento sem vínculo", "#41", "att-abcd…wxyz", "pay_1234…9876", "há 2 h", "Pendentes", "Em análise", "Resolvidos", "P1 em aberto", "Mais antigo em aberto"]) expect(out).toContain(text);
  });
  it("declares itself read-only and offers NO financial/case action", () => {
    const out = html();
    expect(out).toMatch(/Somente leitura/);
    expect(out).toMatch(/não confirma pagamentos/);
    const buttons = [...out.matchAll(/<button([^>]*)>(.*?)<\/button>/g)].filter(m => !/role="combobox"/.test(m[1])).map(m => m[2].replace(/<[^>]*>/g, "").trim()); // Select triggers are filters, not actions
    expect(buttons).toEqual(["Atualizar", "Anterior", "Próxima"]); // no case/financial action is rendered
    expect(out).not.toMatch(/<form|type="submit"/);
  });
  it("renders loading, error and empty states accessibly", () => {
    expect(html({ isLoading: true, rows: [] })).toMatch(/role="status"[^>]*>Carregando/);
    expect(html({ isError: true, rows: [] })).toMatch(/role="alert"/);
    expect(html({ rows: [] })).toMatch(/Nenhuma divergência/);
  });
  it("never renders unexpected sensitive fields even if a row carries them", () => {
    const out = html({ rows: [{ ...row(), email: "buyer@example.com", cpf: "12345678901", payload: "{\"x\":1}" } as unknown as ReconciliationAlertRow] });
    expect(out).not.toMatch(/buyer@example\.com|12345678901|payload/);
  });
  it("helpers", () => {
    expect([formatAge(5), formatAge(120), formatAge(7200), formatAge(200000), formatAge(-1)]).toEqual(["agora", "2 min", "2 h", "2 d", "—"]);
    expect(openCount({ pending: 2, inReview: 1, resolved: 9, openByPriority: { P1: 0, P2: 0, P3: 0 }, oldestOpenAgeSeconds: null })).toBe(3);
    expect(openCount(undefined)).toBe(0);
  });
});
