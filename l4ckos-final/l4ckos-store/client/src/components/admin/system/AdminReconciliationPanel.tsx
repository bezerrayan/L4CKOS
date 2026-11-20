import { RefreshCw } from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../../ui/select";
import "../AdminAuditVisualPreview.css";
import "./AdminAuditPanel.css";
import "./AdminReconciliationPanel.css";

/** Mirrors the SANITIZED server projection (server/payments/reconciliationAlerts.ts). Nothing here can carry payer data. */
export type ReconciliationAlertRow = {
  id: number; state: "pending" | "in_review" | "resolved"; priority: "P1" | "P2" | "P3";
  category: string; kind: string | null; reasonText: string; orderId: number | null;
  attemptRef: string | null; paymentRef: string | null; detectedAt: string; ageSeconds: number; reviewer: string | null;
};
export type ReconciliationSummaryData = {
  pending: number; inReview: number; resolved: number; openByPriority: { P1: number; P2: number; P3: number }; oldestOpenAgeSeconds: number | null;
};
export type ReconciliationFilters = { state: string; priority: string; category: string };

const stateText: Record<ReconciliationAlertRow["state"], string> = { pending: "Pendente", in_review: "Em análise", resolved: "Resolvido" };
const categoryText: Record<string, string> = {
  payment_without_correlation: "Pagamento sem vínculo", payment_after_release: "Pagamento após liberação", order_attempt_payment_inconsistent: "Inconsistência pedido/tentativa/cobrança",
  reference_conflict: "Conflito de referência", payment_deleted_unconfirmed: "Remoção não confirmada", provider_state_unavailable: "Provedor indisponível", observation_requires_review: "Observação para revisão",
};

export function formatAge(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "—";
  if (seconds < 60) return "agora";
  if (seconds < 3600) return `${Math.floor(seconds / 60)} min`;
  if (seconds < 86_400) return `${Math.floor(seconds / 3600)} h`;
  return `${Math.floor(seconds / 86_400)} d`;
}
export const openCount = (s?: ReconciliationSummaryData | null) => (s ? s.pending + s.inReview : 0);

export function AdminReconciliationPanel(props: {
  rows: ReconciliationAlertRow[]; summary: ReconciliationSummaryData | null | undefined; isLoading: boolean; isError: boolean;
  filters: ReconciliationFilters; onFiltersChange: (next: ReconciliationFilters) => void;
  page: number; hasPrevious: boolean; hasNext: boolean; onPrevious: () => void; onNext: () => void; onRefresh: () => void;
}) {
  const { rows, summary, isLoading, isError, filters, onFiltersChange } = props;
  const set = (patch: Partial<ReconciliationFilters>) => onFiltersChange({ ...filters, ...patch });
  return <div className="l4-audit-preview l4-audit-live l4-reconciliation">
    <section className="audit-list-section" aria-labelledby="admin-reconciliation-heading">
      <div className="audit-section-heading">
        <div><div id="admin-reconciliation-heading" className="audit-section-title" role="heading" aria-level={2}>Divergências financeiras</div>
          <p>{isLoading ? "Carregando…" : `${rows.length} caso(s) nesta página`}</p></div>
        <button type="button" className="audit-refresh-button" onClick={props.onRefresh} disabled={isLoading}><RefreshCw size={16} aria-hidden="true" />Atualizar</button>
      </div>
      <p className="audit-contract-note" role="note">Somente leitura. Esta tela não confirma pagamentos, não altera pedidos nem estoque, não cancela e não reembolsa. A análise e o encerramento dos casos ainda não estão habilitados.</p>
      <dl className="l4-reconciliation-summary" aria-label="Resumo dos casos">
        <div><dt>Pendentes</dt><dd>{summary ? summary.pending : "—"}</dd></div>
        <div><dt>Em análise</dt><dd>{summary ? summary.inReview : "—"}</dd></div>
        <div><dt>Resolvidos</dt><dd>{summary ? summary.resolved : "—"}</dd></div>
        <div><dt>P1 em aberto</dt><dd>{summary ? summary.openByPriority.P1 : "—"}</dd></div>
        <div><dt>Mais antigo em aberto</dt><dd>{summary ? (summary.oldestOpenAgeSeconds === null ? "—" : formatAge(summary.oldestOpenAgeSeconds)) : "—"}</dd></div>
      </dl>
      <div className="audit-filters">
        <label className="audit-filter"><span>Situação</span><Select value={filters.state} onValueChange={v => set({ state: v })}><SelectTrigger className="audit-select-trigger" aria-label="Filtrar por situação"><SelectValue /></SelectTrigger>
          <SelectContent><SelectItem value="all">Todas</SelectItem><SelectItem value="pending">Pendente</SelectItem><SelectItem value="in_review">Em análise</SelectItem><SelectItem value="resolved">Resolvido</SelectItem></SelectContent></Select></label>
        <label className="audit-filter"><span>Prioridade</span><Select value={filters.priority} onValueChange={v => set({ priority: v })}><SelectTrigger className="audit-select-trigger" aria-label="Filtrar por prioridade"><SelectValue /></SelectTrigger>
          <SelectContent><SelectItem value="all">Todas</SelectItem><SelectItem value="P1">P1</SelectItem><SelectItem value="P2">P2</SelectItem><SelectItem value="P3">P3</SelectItem></SelectContent></Select></label>
        <label className="audit-filter"><span>Categoria</span><Select value={filters.category} onValueChange={v => set({ category: v })}><SelectTrigger className="audit-select-trigger" aria-label="Filtrar por categoria"><SelectValue /></SelectTrigger>
          <SelectContent><SelectItem value="all">Todas</SelectItem>{Object.entries(categoryText).map(([k, label]) => <SelectItem key={k} value={k}>{label}</SelectItem>)}</SelectContent></Select></label>
      </div>
      {isLoading ? <p className="audit-empty" role="status">Carregando divergências…</p>
        : isError ? <div className="audit-empty" role="alert">Não foi possível consultar as divergências. Verifique seu acesso e tente atualizar.</div>
        : rows.length === 0 ? <p className="audit-empty" role="status">Nenhuma divergência para os filtros selecionados.</p>
        : <div className="audit-table-wrap"><table className="audit-table">
            <thead><tr><th>Prioridade</th><th>Situação</th><th>Motivo</th><th>Pedido</th><th>Tentativa</th><th>Cobrança</th><th>Detectado</th><th>Responsável</th></tr></thead>
            <tbody>{rows.map(row => <tr key={row.id}>
              <td><span className={`l4-reconciliation-badge l4-reconciliation-${row.priority.toLowerCase()}`}>{row.priority}</span></td>
              <td>{stateText[row.state]}</td>
              <td><strong>{categoryText[row.category] ?? "Observação"}</strong><small>{row.reasonText}</small></td>
              <td>{row.orderId === null ? "—" : `#${row.orderId}`}</td>
              <td><code>{row.attemptRef ?? "—"}</code></td>
              <td><code>{row.paymentRef ?? "—"}</code></td>
              <td>{new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short" }).format(new Date(row.detectedAt))}<small>há {formatAge(row.ageSeconds)}</small></td>
              <td>{row.reviewer ?? "—"}</td>
            </tr>)}</tbody></table></div>}
      <div className="l4-reconciliation-pager" role="navigation" aria-label="Paginação">
        <button type="button" className="audit-refresh-button" onClick={props.onPrevious} disabled={!props.hasPrevious || isLoading}>Anterior</button>
        <span>Página {props.page}</span>
        <button type="button" className="audit-refresh-button" onClick={props.onNext} disabled={!props.hasNext || isLoading}>Próxima</button>
      </div>
    </section>
  </div>;
}
