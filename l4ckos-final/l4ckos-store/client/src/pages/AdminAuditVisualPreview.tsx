import { useEffect, useMemo, useRef, useState } from "react";
import { Menu, Search, ShieldAlert, X } from "lucide-react";
import { useIsMobile } from "../hooks/useIsMobile";
import { AdminSidebarProfile } from "../components/admin/AdminSidebarProfile";
import { AdminAuditPanel } from "../components/admin/system/AdminAuditPanel";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "../components/ui/select";
import "../components/admin/AdminOrdersVisualPreview.css";
import "../components/admin/AdminAuditVisualPreview.css";

type ActorType = "admin" | "user" | "system";
type AuditEntry = {
  id: number;
  actorUserId: number | null;
  actorType: ActorType;
  action: string;
  entity: string;
  entityId: string | null;
  createdAt: string;
  metadata: Record<string, unknown> | null;
};

const navigation = [
  { group: "Visão geral", items: ["Dashboard / KPIs"] },
  { group: "Operação", items: ["Pedidos", "Produtos", "Clientes", "Lotes / Pré-venda"] },
  { group: "Comercial", items: ["Promoções", "Cupons", "Avaliações"] },
  { group: "Sistema", items: ["Relatórios", "Auditoria", "Backup", "Configurações"] },
];

function minutesAgo(minutes: number) { return new Date(Date.now() - minutes * 60_000).toISOString(); }
function daysAgo(days: number, hour = 10) {
  const date = new Date(); date.setDate(date.getDate() - days); date.setHours(hour, 12, 0, 0); return date.toISOString();
}

// Fixtures fictícias limitadas aos campos retornados pelo auditList atual.
const fixtures: AuditEntry[] = [
  { id: 842, actorUserId: 14, actorType: "admin", action: "order.payment_confirmed_manual", entity: "order", entityId: "4826", createdAt: minutesAgo(18), metadata: { source: "manual", previousOrderStatus: "pending", resultingOrderStatus: "paid", paymentConfirmedAt: minutesAgo(18) } },
  { id: 841, actorUserId: 14, actorType: "admin", action: "review.moderate", entity: "productReview", entityId: "193", createdAt: minutesAgo(57), metadata: { moderationStatus: "approved", imageStatus: "pending" } },
  { id: 840, actorUserId: 14, actorType: "admin", action: "product.update", entity: "product", entityId: "71", createdAt: minutesAgo(134), metadata: { name: "Camiseta Clã 14 Bis", category: "Camisetas", price: 8990, stock: 18 } },
  { id: 839, actorUserId: null, actorType: "system", action: "payment.reconciliation_required", entity: "order", entityId: "4819", createdAt: minutesAgo(226), metadata: { reason: "payment_after_cancellation", reconciliationRequired: true, financialMutation: false } },
  { id: 838, actorUserId: 14, actorType: "admin", action: "coupon.update", entity: "coupon", entityId: "6", createdAt: daysAgo(1, 16), metadata: null },
  { id: 837, actorUserId: 14, actorType: "admin", action: "batch.transition", entity: "productionBatch", entityId: "12", createdAt: daysAgo(1, 14), metadata: null },
  { id: 836, actorUserId: 14, actorType: "admin", action: "user.setRole", entity: "user", entityId: "28", createdAt: daysAgo(2, 11), metadata: { role: "admin" } },
  { id: 835, actorUserId: 14, actorType: "admin", action: "backup.manual", entity: "backup", entityId: "backup-2026-10-20-demo.json", createdAt: daysAgo(2, 9), metadata: null },
  { id: 834, actorUserId: 14, actorType: "admin", action: "order.update", entity: "order", entityId: "4818", createdAt: daysAgo(3, 13), metadata: { status: "shipped" } },
  { id: 833, actorUserId: 14, actorType: "admin", action: "product.delete", entity: "product", entityId: "69", createdAt: daysAgo(4, 12), metadata: null },
  { id: 832, actorUserId: 14, actorType: "admin", action: "order.cancelled", entity: "order", entityId: "4817", createdAt: daysAgo(6, 10), metadata: { previousStatus: "processing", paymentConfirmed: false, refundExecuted: false, reconciliationRequired: false, stockPolicy: "release_active_only" } },
  { id: 831, actorUserId: 14, actorType: "admin", action: "promoBanner.update", entity: "promoBanner", entityId: "4", createdAt: daysAgo(9, 15), metadata: null },
  { id: 830, actorUserId: 14, actorType: "admin", action: "marketing.campaign.send", entity: "emailCampaign", entityId: "newProducts", createdAt: daysAgo(13, 10), metadata: { total: 4, sent: 3, failed: 1 } },
  { id: 829, actorUserId: 14, actorType: "admin", action: "coupon.delete", entity: "coupon", entityId: "3", createdAt: daysAgo(26, 11), metadata: null },
];

const actorTypeLabel: Record<ActorType, string> = { admin: "Administrador", user: "Usuário", system: "Sistema" };
const entityLabel: Record<string, string> = {
  order: "Pedido", product: "Produto", productReview: "Avaliação", coupon: "Cupom", productionBatch: "Lote",
  user: "Usuário", backup: "Backup", promoBanner: "Destaque da Home", emailCampaign: "Campanha de e-mail",
};
const actionLabels: Record<string, string> = {
  "order.payment_confirmed_manual": "Pagamento confirmado manualmente",
  "review.moderate": "Avaliação moderada",
  "product.update": "Produto atualizado",
  "payment.reconciliation_required": "Conciliação de pagamento necessária",
  "coupon.update": "Cupom atualizado",
  "batch.transition": "Status do lote alterado",
  "user.setRole": "Papel de acesso atualizado",
  "backup.manual": "Backup manual realizado",
  "order.update": "Pedido atualizado",
  "product.create": "Produto criado",
  "product.delete": "Produto removido",
  "order.cancelled": "Pedido cancelado",
  "promoBanner.update": "Destaque da Home atualizado",
  "marketing.campaign.send": "Campanha de e-mail enviada",
  "coupon.delete": "Cupom removido",
  "user.setFlags": "Permissões da conta atualizadas",
  "coupon.create": "Cupom criado",
  "promoBanner.create": "Destaque da Home criado",
  "promoBanner.delete": "Destaque da Home removido",
  "batch.created": "Lote criado",
  "batch.edited": "Lote atualizado",
  "batch.products_assigned": "Produtos associados ao lote",
};

function categoryFor(entry: AuditEntry) {
  if (entry.entity === "order") return "Pedidos e pagamentos";
  if (entry.entity === "product") return "Produtos e estoque";
  if (entry.entity === "productReview") return "Avaliações";
  if (entry.entity === "coupon") return "Cupons";
  if (entry.entity === "productionBatch") return "Lotes / Pré-venda";
  if (entry.entity === "user") return "Acesso administrativo";
  if (entry.entity === "backup") return "Backup";
  if (entry.entity === "promoBanner") return "Destaques da Home";
  return entry.entity === "emailCampaign" ? "E-mails" : "Outros";
}
function actorLabel(entry: AuditEntry) { return entry.actorUserId == null ? actorTypeLabel[entry.actorType] : `${actorTypeLabel[entry.actorType]} #${entry.actorUserId}`; }
function actionLabel(action: string) { return actionLabels[action] ?? action; }
function isSensitive(entry: AuditEntry) {
  return entry.action.startsWith("payment.") || entry.action.includes("payment_confirmed") || entry.action.includes("setRole") || entry.action.includes("delete") || entry.entity === "backup";
}
function contextLabel(entry: AuditEntry) {
  const metadata = entry.metadata;
  if (!metadata) return "—";
  if (metadata.reconciliationRequired === true) return "Conciliação necessária";
  if (typeof metadata.failed === "number" && typeof metadata.sent === "number") return `${metadata.sent} enviados · ${metadata.failed} falhas`;
  const status = typeof metadata.resultingOrderStatus === "string" ? metadata.resultingOrderStatus : typeof metadata.status === "string" ? metadata.status : null;
  const statusLabels: Record<string, string> = { pending: "Pendente", processing: "Em preparação", paid: "Pago", shipped: "Enviado", delivered: "Entregue", cancelled: "Cancelado" };
  if (status) return `Situação: ${statusLabels[status] ?? status}`;
  if (typeof metadata.moderationStatus === "string") {
    const moderation = metadata.moderationStatus === "approved" ? "Avaliação aprovada" : metadata.moderationStatus === "rejected" ? "Avaliação rejeitada" : "Avaliação pendente";
    return typeof metadata.imageStatus === "string" ? `${moderation} · foto ${metadata.imageStatus === "pending" ? "pendente" : metadata.imageStatus === "approved" ? "aprovada" : "rejeitada"}` : moderation;
  }
  if (typeof metadata.name === "string" && typeof metadata.stock === "number") return `${metadata.name} · estoque ${metadata.stock} un.`;
  if (typeof metadata.role === "string") return `Papel: ${metadata.role === "admin" ? "Administrador" : metadata.role}`;
  if (typeof metadata.refundExecuted === "boolean") return metadata.refundExecuted ? "Reembolso executado" : "Reembolso não executado";
  return "—";
}
function formatDate(value: string, options: Intl.DateTimeFormatOptions = { dateStyle: "short", timeStyle: "short" }) {
  return new Intl.DateTimeFormat("pt-BR", options).format(new Date(value));
}
function formatMetadataValue(key: string, value: unknown): string {
  if (typeof value === "boolean") return value ? "Sim" : "Não";
  if (key === "reason" && value === "payment_after_cancellation") return "Pagamento identificado após o cancelamento";
  if (key === "stockPolicy" && value === "release_active_only") return "Liberar somente reservas ativas";
  if (key === "source" && value === "manual") return "Manual";
  const translations: Record<string, string> = {
    pending: "Pendente", processing: "Em preparação", paid: "Pago", shipped: "Enviado", delivered: "Entregue", cancelled: "Cancelado",
    approved: "Aprovada", rejected: "Rejeitada", hidden: "Oculta", admin: "Administrador", user: "Cliente",
  };
  return typeof value === "string" ? (translations[value] ?? value) : String(value);
}

const metadataNames: Record<string, string> = {
  source: "Origem", previousOrderStatus: "Situação anterior do pedido", resultingOrderStatus: "Situação resultante do pedido", previousStatus: "Situação anterior",
  status: "Situação informada", paymentConfirmedAt: "Confirmação registrada em", moderationStatus: "Moderação da avaliação",
  imageStatus: "Moderação da foto", name: "Nome do produto", category: "Categoria",
  stock: "Estoque informado", reason: "Motivo registrado", reconciliationRequired: "Requer conciliação",
  financialMutation: "Alteração financeira executada", paymentConfirmed: "Pagamento confirmado", refundExecuted: "Reembolso executado", stockPolicy: "Política de estoque", role: "Papel definido",
  total: "Destinatários", sent: "Envios concluídos", failed: "Falhas de envio",
};
function visibleMetadata(entry: AuditEntry) {
  if (!entry.metadata) return [];
  return Object.entries(entry.metadata).filter(([key, value]) => key in metadataNames && value !== null && typeof value !== "object")
    .map(([key, value]) => [metadataNames[key], key.endsWith("At") && typeof value === "string" ? formatDate(value, { dateStyle: "short", timeStyle: "medium" }) : formatMetadataValue(key, value)] as const);
}

export default function AdminAuditVisualPreview() {
  const integratedPanel = typeof window !== "undefined" && new URLSearchParams(window.location.search).get("integration-panel") === "1";
  return integratedPanel ? <AuditIntegrationDemo /> : <AdminAuditVisualPreviewContent />;
}

function AuditIntegrationDemo() {
  return <div className="l4-audit-preview" style={{ minHeight: "100vh", padding: "24px clamp(16px, 3vw, 36px)", background: "#000" }}>
    <p style={{ margin: "0 0 14px", color: "#aaa", fontSize: 13 }}>PRÉVIA DEV-ONLY · eventos fictícios · consulta demonstrativa</p>
    <AdminAuditPanel records={fixtures} isLoading={false} isError={false} onRefresh={() => {}} />
  </div>;
}

function AdminAuditVisualPreviewContent() {
  const mobile = useIsMobile(900);
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("all");
  const [actor, setActor] = useState("all");
  const [result, setResult] = useState("all");
  const [period, setPeriod] = useState("30");
  const [selected, setSelected] = useState<AuditEntry | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuTriggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLElement>(null);
  const dialogRef = useRef<HTMLElement>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!menuOpen || !mobile) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    menuRef.current?.querySelector<HTMLElement>("button:not(.orders-menu-close)")?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") { event.preventDefault(); setMenuOpen(false); menuTriggerRef.current?.focus(); return; }
      if (event.key !== "Tab" || !menuRef.current) return;
      const focusable = [...menuRef.current.querySelectorAll<HTMLElement>('button:not([disabled])')].filter(item => item.offsetParent !== null);
      if (!focusable.length) return;
      const first = focusable[0], last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => { document.body.style.overflow = previousOverflow; document.removeEventListener("keydown", onKeyDown); };
  }, [menuOpen, mobile]);

  useEffect(() => {
    if (!selected) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    dialogRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") { event.preventDefault(); setSelected(null); return; }
      if (event.key !== "Tab" || !dialogRef.current) return;
      const focusable = [...dialogRef.current.querySelectorAll<HTMLElement>('button:not([disabled]),a[href],input:not([disabled]),[tabindex="0"]')].filter(item => item.offsetParent !== null);
      if (!focusable.length) return;
      const first = focusable[0], last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => { document.body.style.overflow = previousOverflow; document.removeEventListener("keydown", onKeyDown); returnFocusRef.current?.focus(); };
  }, [selected]);

  const categories = useMemo(() => [...new Set(fixtures.map(categoryFor))].sort((a, b) => a.localeCompare(b, "pt-BR")), []);
  const actors = useMemo(() => [...new Set(fixtures.map(actorLabel))].sort((a, b) => a.localeCompare(b, "pt-BR")), []);
  const filtered = useMemo(() => {
    const now = Date.now();
    const periodMs = period === "all" ? Infinity : Number(period) * 86_400_000;
    const query = search.trim().toLocaleLowerCase("pt-BR");
    return fixtures.filter(entry => {
      const searchable = [entry.id, entry.action, actionLabel(entry.action), entry.entity, entry.entityId ?? "", entry.actorUserId ?? "", categoryFor(entry)].join(" ").toLocaleLowerCase("pt-BR");
      if (query && !searchable.includes(query)) return false;
      if (category !== "all" && categoryFor(entry) !== category) return false;
      if (actor !== "all" && actorLabel(entry) !== actor) return false;
      if (result === "sensitive" && !isSensitive(entry)) return false;
      if (result === "context" && contextLabel(entry) === "—") return false;
      if (result === "reconciliation" && entry.metadata?.reconciliationRequired !== true) return false;
      return now - new Date(entry.createdAt).getTime() <= periodMs;
    });
  }, [search, category, actor, result, period]);

  function openDetails(entry: AuditEntry, trigger: HTMLElement) {
    returnFocusRef.current = trigger;
    setSelected(entry);
  }

  const filteredSensitive = filtered.filter(isSensitive).length;
  const filteredSystem = filtered.filter(entry => entry.actorType === "system").length;

  return <div className="l4-orders-preview l4-audit-preview">
    {menuOpen && mobile ? <button className="orders-menu-backdrop" type="button" aria-label="Fechar navegação administrativa" onClick={() => { setMenuOpen(false); menuTriggerRef.current?.focus(); }} /> : null}
    <aside className={`orders-sidebar${menuOpen ? " is-open" : ""}`} id="audit-preview-navigation" ref={menuRef} aria-label="Navegação administrativa" inert={mobile && !menuOpen}>
      <div className="l4-admin-brand"><strong>L4CKOS</strong><span>GESTÃO</span><small>PRÉVIA LOCAL</small></div>
      <button type="button" className="orders-menu-close" onClick={() => { setMenuOpen(false); menuTriggerRef.current?.focus(); }}>Fechar menu</button>
      <nav className="orders-nav-scroll" aria-label="Seções da gestão">{navigation.map(group => <section className="orders-nav-group" key={group.group} aria-label={group.group}><h2>{group.group}</h2>{group.items.map(item => <button key={item} type="button" aria-current={item === "Auditoria" ? "page" : undefined} className={item === "Auditoria" ? "" : "orders-nav-inactive"} onClick={() => { if (item === "Auditoria") setMenuOpen(false); }}>{item}</button>)}</section>)}</nav>
      <AdminSidebarProfile name="Luna Administradora" email="admin.demo@example.test" preview />
    </aside>
    <main className="orders-main-column">
      <div className="orders-preview-banner"><span><strong>AMBIENTE DE DEMONSTRAÇÃO</strong><span className="orders-preview-divider">·</span>Dados fictícios</span><span className="orders-preview-fake-label">Sem consulta administrativa</span></div>
      {mobile ? <button ref={menuTriggerRef} type="button" className="orders-mobile-menu-trigger" aria-expanded={menuOpen} aria-controls="audit-preview-navigation" onClick={() => setMenuOpen(true)}><Menu size={18} /> Menu administrativo</button> : null}
      <header className="orders-preview-heading audit-heading"><div><p className="orders-preview-eyebrow">SISTEMA · RASTREABILIDADE</p><h1>Auditoria</h1><p>Consulta demonstrativa de eventos administrativos e de sistema.</p></div></header>

      <section className="audit-summary" aria-label="Resumo dos registros filtrados">
        <div><span>Registros no recorte</span><strong>{filtered.length}</strong></div>
        <div><span>Ações classificadas como sensíveis</span><strong>{filteredSensitive}</strong></div>
        <div><span>Eventos de sistema</span><strong>{filteredSystem}</strong></div>
      </section>

      <section className="audit-list-section" aria-labelledby="audit-list-title">
        <div className="audit-section-heading"><div><h2 id="audit-list-title">Registros</h2><p>{filtered.length} de {fixtures.length} registros fictícios</p></div></div>
        <div className="audit-filters">
          <label className="audit-search"><Search size={18} aria-hidden="true" /><input value={search} onChange={event => setSearch(event.target.value)} placeholder="Buscar ação, entidade ou ID" aria-label="Buscar ação, entidade ou ID" /><button type="button" aria-label="Limpar busca" onClick={() => setSearch("")} disabled={!search}><X size={16} /></button></label>
          <label className="audit-filter"><span>Tipo de evento</span><Select value={category} onValueChange={setCategory}><SelectTrigger className="audit-select-trigger" aria-label="Filtrar por tipo de evento"><SelectValue placeholder="Todos os tipos" /></SelectTrigger><SelectContent className="audit-select-content"><SelectItem value="all">Todos os tipos</SelectItem>{categories.map(value => <SelectItem key={value} value={value}>{value}</SelectItem>)}</SelectContent></Select></label>
          <label className="audit-filter"><span>Responsável</span><Select value={actor} onValueChange={setActor}><SelectTrigger className="audit-select-trigger" aria-label="Filtrar por responsável"><SelectValue placeholder="Todos os responsáveis" /></SelectTrigger><SelectContent className="audit-select-content"><SelectItem value="all">Todos</SelectItem>{actors.map(value => <SelectItem key={value} value={value}>{value}</SelectItem>)}</SelectContent></Select></label>
          <label className="audit-filter"><span>Contexto</span><Select value={result} onValueChange={setResult}><SelectTrigger className="audit-select-trigger" aria-label="Filtrar por contexto registrado"><SelectValue /></SelectTrigger><SelectContent className="audit-select-content"><SelectItem value="all">Todos</SelectItem><SelectItem value="sensitive">Ações sensíveis</SelectItem><SelectItem value="context">Com contexto registrado</SelectItem><SelectItem value="reconciliation">Conciliação necessária</SelectItem></SelectContent></Select></label>
        </div>
        <div className="audit-period" role="group" aria-label="Período da demonstração"><span>Período local</span>{[["1", "24 horas"], ["7", "7 dias"], ["30", "30 dias"], ["all", "Todo o histórico"]].map(([value, label]) => <button type="button" key={value} aria-pressed={period === value} onClick={() => setPeriod(value)}>{label}</button>)}</div>
        <p className="audit-contract-note">Busca, filtros e período atuam somente sobre dados fictícios. “Sensível” é uma classificação visual demonstrativa, não necessariamente um atributo gravado no registro.</p>

        <div className="audit-table-wrap">
          <table className="audit-table"><thead><tr><th>Data e horário</th><th>Ação</th><th>Responsável</th><th>Recurso</th><th>Contexto</th><th><span className="sr-only">Detalhes</span></th></tr></thead><tbody>
            {filtered.map(entry => <tr key={entry.id}>
              <td><span className="audit-date"><strong>{formatDate(entry.createdAt)}</strong><small>Log #{entry.id}</small></span></td>
              <td><span className="audit-action-cell"><strong>{actionLabel(entry.action)}</strong>{isSensitive(entry) ? <small className="audit-sensitive-mark">Sensível</small> : null}</span></td>
              <td><span className={`audit-actor is-${entry.actorType}`}>{actorLabel(entry)}</span></td>
              <td><span className="audit-entity-cell"><strong>{entityLabel[entry.entity] ?? entry.entity}</strong><small>{entry.entityId ? `ID ${entry.entityId}` : "Sem ID associado"}</small></span></td>
              <td><span className="audit-context">{contextLabel(entry)}</span></td>
              <td><button type="button" className="audit-details-button" onClick={event => openDetails(entry, event.currentTarget)}>Detalhes</button></td>
            </tr>)}
            {!filtered.length ? <tr><td colSpan={6} className="audit-empty">Nenhum registro fictício corresponde aos filtros.</td></tr> : null}
          </tbody></table>
        </div>
        <div className="audit-mobile-list">
          {filtered.map(entry => <article className="audit-mobile-row" key={entry.id}>
            <div className="audit-mobile-row-top"><strong>{formatDate(entry.createdAt)}</strong><small>Log #{entry.id}</small></div>
            <div className="audit-mobile-action"><strong>{actionLabel(entry.action)}</strong>{isSensitive(entry) ? <small className="audit-sensitive-mark">Sensível</small> : null}</div>
            <div className="audit-mobile-facts"><span>{actorLabel(entry)}</span><span>{entityLabel[entry.entity] ?? entry.entity}{entry.entityId ? ` · ID ${entry.entityId}` : ""}</span></div>
            <div className="audit-mobile-row-bottom"><span className="audit-context">{contextLabel(entry)}</span><button type="button" className="audit-details-button" onClick={event => openDetails(entry, event.currentTarget)}>Ver detalhes</button></div>
          </article>)}
          {!filtered.length ? <p className="audit-empty">Nenhum registro fictício corresponde aos filtros.</p> : null}
        </div>
      </section>
      <p className="audit-preview-footnote">Registros de auditoria são somente para consulta. Nenhum dado real é carregado ou alterado nesta prévia.</p>
    </main>

    {selected ? <><button className="audit-detail-backdrop" type="button" aria-label="Fechar detalhes" onClick={() => setSelected(null)} /><aside className="audit-detail-panel" role="dialog" aria-modal="true" aria-labelledby="audit-detail-title" tabIndex={-1} ref={dialogRef}>
      <div className="audit-detail-topbar"><span>Registro de auditoria</span><button type="button" aria-label="Fechar detalhes" onClick={() => setSelected(null)}><X size={19} /><span>Fechar</span></button></div>
      <div className="audit-detail-scroll">
        <div className="audit-detail-title-row"><div><small>IDENTIFICADOR DO EVENTO</small><h2 id="audit-detail-title">Log #{selected.id}</h2></div>{isSensitive(selected) ? <span className="audit-sensitive-mark"><ShieldAlert size={14} /> Sensível</span> : <span className="audit-ordinary-mark">Operação</span>}</div>
        <dl className="audit-detail-facts">
          <div><dt>Data e horário</dt><dd><time dateTime={selected.createdAt}>{formatDate(selected.createdAt, { dateStyle: "long", timeStyle: "medium" })}</time><small>Horário local do navegador</small></dd></div>
          <div><dt>Ação</dt><dd>{actionLabel(selected.action)}</dd></div>
          <div><dt>Identificador original</dt><dd><code>{selected.action}</code></dd></div>
          <div><dt>Responsável</dt><dd>{actorLabel(selected)}{selected.actorUserId !== null ? <small>Identificador de usuário #{selected.actorUserId}</small> : null}</dd></div>
          <div><dt>Recurso afetado</dt><dd>{entityLabel[selected.entity] ?? selected.entity}<small>{selected.entityId ? `Identificador ${selected.entityId}` : "Sem identificador associado"}</small></dd></div>
          <div><dt>Contexto</dt><dd>{contextLabel(selected)}{contextLabel(selected) === "—" ? <small>Sem contexto adicional registrado.</small> : null}</dd></div>
        </dl>
        <section className="audit-detail-section"><h3>Detalhes registrados</h3>
          {visibleMetadata(selected).length ? <dl className="audit-metadata-list">{visibleMetadata(selected).map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl> : <p>Nenhum detalhe adicional registrado para este evento.</p>}
        </section>
        <section className="audit-detail-section"><h3>Consulta somente leitura</h3><p>Os registros não podem ser editados ou removidos por esta área.</p></section>
      </div>
    </aside></> : null}
  </div>;
}
