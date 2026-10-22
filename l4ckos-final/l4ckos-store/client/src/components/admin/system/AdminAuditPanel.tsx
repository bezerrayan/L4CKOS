import { useMemo, useState } from "react";
import { RefreshCw, Search, X } from "lucide-react";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "../../ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../../ui/select";
import "../AdminAuditVisualPreview.css";
import "./AdminAuditPanel.css";

export type AuditRecord = {
  id: number;
  actorUserId: number | null;
  actorType: "admin" | "user" | "system";
  action: string;
  entity: string;
  entityId: string | null;
  metadata: unknown;
  createdAt: Date | string;
};

const actionNames: Record<string, string> = {
  "order.payment_confirmed_manual": "Pagamento confirmado manualmente",
  "review.moderate": "Avaliação moderada",
  "product.update": "Produto atualizado",
  "payment.reconciliation_required": "Conciliação de pagamento necessária",
  "coupon.update": "Cupom atualizado",
  "batch.transition": "Status do lote alterado",
  "user.setRole": "Papel de acesso atualizado",
  "user.setFlags": "Permissões da conta atualizadas",
  "backup.manual": "Backup manual realizado",
  "order.update": "Pedido atualizado",
  "order.cancelled": "Pedido cancelado",
  "product.create": "Produto criado",
  "product.delete": "Produto removido",
  "coupon.create": "Cupom criado",
  "coupon.delete": "Cupom removido",
  "promoBanner.create": "Destaque da Home criado",
  "promoBanner.update": "Destaque da Home atualizado",
  "promoBanner.delete": "Destaque da Home removido",
  "batch.created": "Lote criado",
  "batch.edited": "Lote atualizado",
  "batch.products_assigned": "Produtos associados ao lote",
  "marketing.campaign.send": "Campanha de e-mail enviada",
};
const entities: Record<string, string> = { order: "Pedido", product: "Produto", productReview: "Avaliação", coupon: "Cupom", productionBatch: "Lote", user: "Usuário", backup: "Backup", promoBanner: "Destaque da Home", emailCampaign: "Campanha de e-mail" };
const metaLabels: Record<string, string> = {
  source: "Origem", previousOrderStatus: "Situação anterior do pedido", resultingOrderStatus: "Situação resultante do pedido",
  previousStatus: "Situação anterior", status: "Situação informada", moderationStatus: "Moderação da avaliação",
  imageStatus: "Moderação da foto", name: "Nome do produto", category: "Categoria", stock: "Estoque informado",
  reconciliationRequired: "Requer conciliação", financialMutation: "Alteração financeira executada",
  paymentConfirmed: "Pagamento confirmado", refundExecuted: "Reembolso executado", stockPolicy: "Política de estoque", role: "Papel definido",
  total: "Destinatários", sent: "Envios concluídos", failed: "Falhas de envio",
};
const safeStatus: Record<string, string> = { pending: "Pendente", processing: "Em preparação", paid: "Pago", shipped: "Enviado", delivered: "Entregue", cancelled: "Cancelado", approved: "Aprovada", rejected: "Rejeitada", hidden: "Oculta", admin: "Administrador", user: "Cliente", manual: "Manual", payment_after_cancellation: "Pagamento identificado após cancelamento", release_active_only: "Liberar somente reservas ativas" };
const contextKeys = ["reconciliationRequired", "resultingOrderStatus", "status", "moderationStatus", "imageStatus", "name", "stock"];
function metadataObject(value: unknown): Record<string, unknown> | null { return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null; }
function metadataRows(value: unknown): Array<[string, string]> {
  const data = metadataObject(value); if (!data) return [];
  return Object.entries(data).filter(([key, item]) => key in metaLabels && item !== null && ["string", "number", "boolean"].includes(typeof item)).map(([key, item]) => {
    const rendered = typeof item === "boolean" ? (item ? "Sim" : "Não") : typeof item === "string" ? (safeStatus[item] ?? item.slice(0, 240)) : String(item);
    return [metaLabels[key], rendered];
  });
}
function context(record: AuditRecord) {
  const meta = metadataObject(record.metadata); if (!meta) return "—";
  if (meta.reconciliationRequired === true) return "Conciliação necessária";
  if (typeof meta.moderationStatus === "string") return `Avaliação ${safeStatus[meta.moderationStatus] ?? meta.moderationStatus}${typeof meta.imageStatus === "string" ? ` · foto ${safeStatus[meta.imageStatus] ?? meta.imageStatus}` : ""}`;
  if (typeof meta.resultingOrderStatus === "string" || typeof meta.status === "string") return `Situação: ${safeStatus[String(meta.resultingOrderStatus ?? meta.status)] ?? String(meta.resultingOrderStatus ?? meta.status)}`;
  if (typeof meta.name === "string" && typeof meta.stock === "number") return `${meta.name.slice(0, 100)} · estoque ${meta.stock} un.`;
  return "—";
}
function dateTime(value: Date | string) { const date = new Date(value); return Number.isFinite(date.getTime()) ? date : null; }
function dateLabel(value: Date | string, options: Intl.DateTimeFormatOptions = { dateStyle: "short", timeStyle: "short" }) { const date = dateTime(value); return date ? new Intl.DateTimeFormat("pt-BR", options).format(date) : "Data inválida"; }
function actor(record: AuditRecord) { const type = record.actorType === "admin" ? "Administrador" : record.actorType === "user" ? "Usuário" : "Sistema"; return record.actorUserId == null ? type : `${type} #${record.actorUserId}`; }

export function AdminAuditPanel({ records, isLoading, isError, onRefresh }: { records: AuditRecord[]; isLoading: boolean; isError: boolean; onRefresh: () => void }) {
  const [search, setSearch] = useState("");
  const [actionFilter, setActionFilter] = useState("all");
  const [actorFilter, setActorFilter] = useState("all");
  const [period, setPeriod] = useState("30");
  const [selected, setSelected] = useState<AuditRecord | null>(null);
  const normalized = search.trim().toLocaleLowerCase("pt-BR");
  const choices = useMemo(() => ({ actions: [...new Set(records.map(r => r.action))].sort(), actors: [...new Set(records.map(actor))].sort() }), [records]);
  const filtered = useMemo(() => records.filter(record => {
    if (actionFilter !== "all" && record.action !== actionFilter) return false;
    if (actorFilter !== "all" && actor(record) !== actorFilter) return false;
    const date = dateTime(record.createdAt);
    if (period !== "all" && date && Date.now() - date.getTime() > Number(period) * 86_400_000) return false;
    if (!normalized) return true;
    return [record.action, actionNames[record.action] ?? "", record.entity, record.entityId ?? "", String(record.id), actor(record)].some(v => v.toLocaleLowerCase("pt-BR").includes(normalized));
  }), [records, actionFilter, actorFilter, period, normalized]);

  return <div className="l4-audit-preview l4-audit-live">
    <section className="audit-list-section" aria-labelledby="admin-audit-list-heading">
      <div className="audit-section-heading"><div><div id="admin-audit-list-heading" className="audit-section-title" role="heading" aria-level={2}>Registros recentes</div><p>{isLoading ? "Carregando…" : `${filtered.length} de ${records.length} registros carregados`}</p></div><button className="audit-refresh-button" type="button" onClick={onRefresh} disabled={isLoading} aria-label="Atualizar registros de auditoria"><RefreshCw size={15} aria-hidden="true" /><span>Atualizar</span></button></div>
      <div className="audit-filters"><label className="audit-search"><Search size={17} aria-hidden="true" /><span className="sr-only">Buscar ação, recurso ou identificador</span><input type="search" value={search} onChange={e => setSearch(e.target.value)} placeholder="Buscar ação ou identificador" />{search ? <button type="button" aria-label="Limpar pesquisa" onClick={() => setSearch("")}><X size={15} /></button> : null}</label>
        <label className="audit-filter"><span>Ação</span><Select value={actionFilter} onValueChange={setActionFilter}><SelectTrigger className="audit-select-trigger" aria-label="Filtrar por ação"><SelectValue /></SelectTrigger><SelectContent className="audit-select-content"><SelectItem value="all">Todas</SelectItem>{choices.actions.map(value => <SelectItem key={value} value={value}>{actionNames[value] ?? value}</SelectItem>)}</SelectContent></Select></label>
        <label className="audit-filter"><span>Responsável</span><Select value={actorFilter} onValueChange={setActorFilter}><SelectTrigger className="audit-select-trigger" aria-label="Filtrar por responsável"><SelectValue /></SelectTrigger><SelectContent className="audit-select-content"><SelectItem value="all">Todos</SelectItem>{choices.actors.map(value => <SelectItem key={value} value={value}>{value}</SelectItem>)}</SelectContent></Select></label>
        <label className="audit-filter"><span>Período local</span><Select value={period} onValueChange={setPeriod}><SelectTrigger className="audit-select-trigger" aria-label="Filtrar período dos registros carregados"><SelectValue /></SelectTrigger><SelectContent className="audit-select-content"><SelectItem value="1">24 horas</SelectItem><SelectItem value="7">7 dias</SelectItem><SelectItem value="30">30 dias</SelectItem><SelectItem value="all">Todo o período carregado</SelectItem></SelectContent></Select></label>
      </div>
      <p className="audit-contract-note">Pesquisa e filtros abrangem somente os {records.length} registros carregados nesta consulta.</p>
      {isLoading ? <p className="audit-empty" role="status">Carregando registros de auditoria…</p> : isError ? <div className="audit-empty" role="alert">Não foi possível consultar a auditoria. Verifique seu acesso e tente atualizar.</div> : records.length === 0 ? <div className="audit-empty">Nenhum registro disponível nesta consulta.</div> : <>
        <div className="audit-table-wrap"><table className="audit-table"><thead><tr><th>Data e horário</th><th>Ação</th><th>Responsável</th><th>Recurso</th><th>Contexto</th><th><span className="sr-only">Detalhes</span></th></tr></thead><tbody>{filtered.map(record => <tr key={record.id}><td><div className="audit-date"><div className="audit-date-value">{dateLabel(record.createdAt)}</div><small>Log #{record.id}</small></div></td><td><div className="audit-action-cell"><div className="audit-action-value">{actionNames[record.action] ?? record.action}</div></div></td><td><span className={`audit-actor is-${record.actorType}`}>{actor(record)}</span></td><td><div className="audit-entity-cell"><div className="audit-entity-value">{entities[record.entity] ?? record.entity}</div><small>{record.entityId ? `ID ${record.entityId}` : "Sem ID associado"}</small></div></td><td><span className="audit-context">{context(record)}</span></td><td><button className="audit-details-button" type="button" onClick={() => setSelected(record)}>Detalhes</button></td></tr>)}{!filtered.length ? <tr><td colSpan={6} className="audit-empty">Nenhum registro carregado corresponde aos filtros.</td></tr> : null}</tbody></table></div>
        <div className="audit-mobile-list">{filtered.map(record => <article className="audit-mobile-row" key={record.id}><div className="audit-mobile-row-top"><span className="audit-date-value">{dateLabel(record.createdAt)}</span><small>Log #{record.id}</small></div><div className="audit-mobile-action"><span className="audit-action-value">{actionNames[record.action] ?? record.action}</span></div><div className="audit-mobile-facts"><span>{actor(record)}</span><span>{entities[record.entity] ?? record.entity}{record.entityId ? ` · ID ${record.entityId}` : ""}</span></div><div className="audit-mobile-row-bottom"><span className="audit-context">{context(record)}</span><button className="audit-details-button" type="button" onClick={() => setSelected(record)}>Ver detalhes</button></div></article>)}{!filtered.length ? <p className="audit-empty">Nenhum registro carregado corresponde aos filtros.</p> : null}</div>
      </>}
    </section>
    <Dialog open={Boolean(selected)} onOpenChange={open => { if (!open) setSelected(null); }}><DialogContent className="audit-detail-dialog" showCloseButton={false}><DialogHeader className="audit-detail-dialog-header"><div><small>REGISTRO DE AUDITORIA</small><DialogTitle asChild><div className="audit-dialog-title" role="heading" aria-level={2}>Log #{selected?.id}</div></DialogTitle></div><DialogClose asChild><button type="button" className="audit-dialog-close" aria-label="Fechar detalhes"><X size={18} /></button></DialogClose><DialogDescription>Consulta somente leitura dos dados retornados pela API.</DialogDescription></DialogHeader>{selected ? <div className="audit-dialog-scroll"><dl className="audit-detail-facts"><div><dt>Data e horário</dt><dd><time dateTime={new Date(selected.createdAt).toISOString()}>{dateLabel(selected.createdAt, { dateStyle: "long", timeStyle: "medium" })}</time><small>Horário local do navegador</small></dd></div><div><dt>Ação</dt><dd>{actionNames[selected.action] ?? selected.action}</dd></div><div><dt>Identificador original</dt><dd><code>{selected.action}</code></dd></div><div><dt>Responsável</dt><dd>{actor(selected)}{selected.actorUserId !== null ? <small>Identificador de usuário #{selected.actorUserId}</small> : null}</dd></div><div><dt>Recurso afetado</dt><dd>{entities[selected.entity] ?? selected.entity}<small>{selected.entityId ? `Identificador ${selected.entityId}` : "Sem identificador associado"}</small></dd></div><div><dt>Contexto</dt><dd>{context(selected)}{context(selected) === "—" ? <small>Sem contexto resumido disponível.</small> : null}</dd></div></dl><section className="audit-detail-section"><div className="audit-detail-title" role="heading" aria-level={3}>Detalhes registrados</div>{metadataRows(selected.metadata).length ? <dl className="audit-metadata-list">{metadataRows(selected.metadata).map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl> : <p>Nenhum campo adicional permitido para exibição nesta visão.</p>}</section></div> : null}</DialogContent></Dialog>
  </div>;
}
