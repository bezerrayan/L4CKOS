import { useMemo, useState, type CSSProperties } from "react";
import { Search, X } from "lucide-react";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { formatPrice } from "@/lib/utils";
import { OrderStatusBadge, PaymentStatusBadge } from "../orders/AdminOrdersUI";
import "./AdminCustomersPanel.css";

export type AdminCustomerRecord = {
  id: number;
  name?: string | null;
  email?: string | null;
  role: string;
  isVip: boolean;
  isBlocked: boolean;
  ordersCount: number;
  createdAt?: Date | string | null;
  lastSignedIn?: Date | string | null;
};

export type AdminCustomerOrderRecord = {
  id: number;
  createdAt: Date | string;
  totalPrice: number | string;
  paymentStatus: string;
  status: string;
};

type CustomerFilter = "all" | "customers" | "admins" | "vip" | "active" | "blocked" | "recent";
type CustomerAction = "block" | "unblock" | "vipOn" | "vipOff" | "adminOn" | "adminOff";
type CustomerHistoryRange = { from?: string; to?: string } | null;

type AdminCustomersPanelProps = {
  customers?: AdminCustomerRecord[];
  isLoading?: boolean;
  isError?: boolean;
  onRetry?: () => void;
  pendingCustomerId?: number;
  initialSelectedCustomerId?: number | null;
  orderHistory?: AdminCustomerOrderRecord[];
  orderHistoryLoading?: boolean;
  orderHistoryError?: boolean;
  onRetryOrderHistory?: () => void;
  historyRange: CustomerHistoryRange;
  onHistoryRangeChange: (range: CustomerHistoryRange) => void;
  getOrderStatusLabel: (status: string) => string;
  getOrderStatusTone: (status: string) => CSSProperties;
  onSelectCustomer: (customerId: number | null) => void;
  onOpenOrder: (orderId: number) => void;
  onToggleBlocked?: (userId: number, isBlocked: boolean) => Promise<void>;
  onToggleVip?: (userId: number, isVip: boolean) => Promise<void>;
  onSetRole?: (userId: number, role: "user" | "admin") => Promise<void>;
};

const filterDefinitions: Array<{ key: CustomerFilter; label: string }> = [
  { key: "all", label: "Todos" },
  { key: "customers", label: "Clientes" },
  { key: "admins", label: "Administradores" },
  { key: "vip", label: "VIP" },
  { key: "active", label: "Ativos" },
  { key: "blocked", label: "Bloqueados" },
  { key: "recent", label: "Recentes" },
];

const recentWindowMs = 30 * 24 * 60 * 60 * 1000;

function dateValue(value?: Date | string | null) {
  if (!value) return null;
  const result = value instanceof Date ? value : new Date(value);
  return Number.isNaN(result.getTime()) ? null : result;
}

function formatDate(value?: Date | string | null, includeTime = false) {
  const date = dateValue(value);
  if (!date) return "Não informado";
  return new Intl.DateTimeFormat("pt-BR", includeTime
    ? { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }
    : { day: "2-digit", month: "2-digit", year: "numeric" }).format(date);
}

function initials(customer: AdminCustomerRecord) {
  const source = String(customer.name || customer.email || `#${customer.id}`).trim();
  const parts = source.split(/\s+/).filter(Boolean);
  return (parts.length > 1 ? `${parts[0][0]}${parts[1][0]}` : source.slice(0, 2)).toLocaleUpperCase("pt-BR");
}

function filterCustomer(customer: AdminCustomerRecord, filter: CustomerFilter, cutoff: number) {
  if (filter === "customers") return customer.role === "user";
  if (filter === "admins") return customer.role === "admin";
  if (filter === "vip") return customer.isVip;
  if (filter === "active") return !customer.isBlocked;
  if (filter === "blocked") return customer.isBlocked;
  if (filter === "recent") return (dateValue(customer.createdAt)?.getTime() ?? 0) >= cutoff;
  return true;
}

function localDateInputValue(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function getActionCopy(action: CustomerAction) {
  switch (action) {
    case "block": return { title: "Bloquear conta?", button: "Confirmar bloqueio", description: "A conta ficará bloqueada conforme as regras atuais do sistema. Esta ação não altera pedidos ou pagamentos." };
    case "unblock": return { title: "Desbloquear conta?", button: "Confirmar desbloqueio", description: "A conta voltará a poder acessar os recursos permitidos pelo sistema." };
    case "vipOn": return { title: "Identificar como VIP?", button: "Confirmar identificação VIP", description: "A identificação VIP será atualizada e registrada na auditoria administrativa." };
    case "vipOff": return { title: "Remover identificação VIP?", button: "Confirmar remoção", description: "A identificação VIP será removida e registrada na auditoria administrativa." };
    case "adminOn": return { title: "Promover a administrador?", button: "Confirmar promoção", description: "A conta receberá acesso administrativo somente se o servidor autorizar o e-mail na allowlist. A API permanece como autoridade." };
    case "adminOff": return { title: "Remover acesso de administrador?", button: "Confirmar remoção", description: "A conta perderá o papel de administrador. Verifique se esta alteração não interrompe o acesso operacional necessário." };
  }
}

export function AdminCustomersPanel({
  customers: customerData,
  isLoading = false,
  isError = false,
  onRetry,
  pendingCustomerId,
  initialSelectedCustomerId = null,
  orderHistory,
  orderHistoryLoading = false,
  orderHistoryError = false,
  onRetryOrderHistory,
  historyRange,
  onHistoryRangeChange,
  getOrderStatusLabel,
  getOrderStatusTone,
  onSelectCustomer,
  onOpenOrder,
  onToggleBlocked,
  onToggleVip,
  onSetRole,
}: AdminCustomersPanelProps) {
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<CustomerFilter>("all");
  const [selectedId, setSelectedId] = useState<number | null>(initialSelectedCustomerId);
  const [historyMode, setHistoryMode] = useState<"all" | "month" | "custom">("all");
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");
  const [confirmAction, setConfirmAction] = useState<CustomerAction | null>(null);
  const [confirmError, setConfirmError] = useState("");
  const customers = customerData ?? [];
  const hasData = customerData !== undefined;
  const cutoff = Date.now() - recentWindowMs;

  const searchedCustomers = useMemo(() => {
    const query = search.trim().toLocaleLowerCase("pt-BR");
    return [...customers]
      .filter(customer => !query || [customer.name, customer.email, String(customer.id)]
        .some(value => String(value ?? "").toLocaleLowerCase("pt-BR").includes(query)))
      .sort((a, b) => b.id - a.id);
  }, [customers, search]);

  const filterCounts = useMemo(() => Object.fromEntries(filterDefinitions.map(option => [
    option.key,
    searchedCustomers.filter(customer => filterCustomer(customer, option.key, cutoff)).length,
  ])) as Record<CustomerFilter, number>, [cutoff, searchedCustomers]);

  const visibleCustomers = useMemo(
    () => searchedCustomers.filter(customer => filterCustomer(customer, filter, cutoff)),
    [cutoff, filter, searchedCustomers],
  );
  const selectedCustomer = customers.find(customer => customer.id === selectedId) ?? null;
  const summary = {
    total: customers.length,
    customers: customers.filter(customer => customer.role === "user").length,
    admins: customers.filter(customer => customer.role === "admin").length,
    blocked: customers.filter(customer => customer.isBlocked).length,
  };
  const mutationPending = selectedCustomer && pendingCustomerId === selectedCustomer.id;
  const periodInvalid = historyMode === "custom"
    ? Boolean(customFrom && customTo && customFrom > customTo)
    : Boolean(historyRange?.from && historyRange?.to && historyRange.from > historyRange.to);
  const history = orderHistory ?? [];
  const orderValueCents = history.reduce((sum, order) => sum + Number(order.totalPrice || 0), 0);
  const confirmedOrders = history.filter(order => order.paymentStatus === "confirmed");
  const confirmedValueCents = confirmedOrders.reduce((sum, order) => sum + Number(order.totalPrice || 0), 0);
  const cancelledCount = history.filter(order => order.status === "cancelled").length;
  const historyDates = history.map(order => dateValue(order.createdAt)?.getTime()).filter((value): value is number => typeof value === "number").sort((a, b) => a - b);
  const averageIntervalDays = historyDates.length > 1
    ? Math.round((historyDates[historyDates.length - 1] - historyDates[0]) / (historyDates.length - 1) / (24 * 60 * 60 * 1000))
    : null;
  const latestPurchase = history[0]?.createdAt;
  const actionCopy = selectedCustomer && confirmAction ? getActionCopy(confirmAction) : null;

  function closeProfile() {
    setSelectedId(null);
    setConfirmAction(null);
    onSelectCustomer(null);
    onHistoryRangeChange(null);
    setHistoryMode("all");
    setCustomFrom("");
    setCustomTo("");
  }

  function openProfile(customerId: number) {
    setSelectedId(customerId);
    setConfirmAction(null);
    setConfirmError("");
    setHistoryMode("all");
    setCustomFrom("");
    setCustomTo("");
    onSelectCustomer(customerId);
  }

  function applyCustomRange(from: string, to: string) {
    setCustomFrom(from);
    setCustomTo(to);
    if (from && to && from > to) return;
    onHistoryRangeChange(from || to ? { from: from || undefined, to: to || undefined } : null);
  }

  function showCurrentMonth() {
    const now = new Date();
    const from = localDateInputValue(new Date(now.getFullYear(), now.getMonth(), 1));
    const to = localDateInputValue(now);
    setHistoryMode("month");
    setCustomFrom(from);
    setCustomTo(to);
    onHistoryRangeChange({ from, to });
  }

  async function confirmSelectedAction() {
    if (!selectedCustomer || !confirmAction || mutationPending) return;
    setConfirmError("");
    try {
      if (confirmAction === "block" || confirmAction === "unblock") {
        if (!onToggleBlocked) return;
        await onToggleBlocked(selectedCustomer.id, confirmAction === "block");
      } else if (confirmAction === "vipOn" || confirmAction === "vipOff") {
        if (!onToggleVip) return;
        await onToggleVip(selectedCustomer.id, confirmAction === "vipOn");
      } else {
        if (!onSetRole) return;
        await onSetRole(selectedCustomer.id, confirmAction === "adminOn" ? "admin" : "user");
      }
      setConfirmAction(null);
    } catch (error) {
      setConfirmError(error instanceof Error ? error.message : "Não foi possível concluir a alteração. Tente novamente.");
    }
  }

  return (
    <div className="admin-customers">
      <header className="admin-customers__heading">
        <p className="admin-customers__eyebrow">Operação · Relacionamento</p>
      </header>

      <section className="admin-customers__summary" aria-label="Resumo de usuários">
        {[
          { key: "total", label: "Total de usuários", value: summary.total },
          { key: "customers", label: "Clientes", value: summary.customers },
          { key: "admins", label: "Administradores", value: summary.admins },
          { key: "blocked", label: "Contas bloqueadas", value: summary.blocked },
        ].map(card => <article key={card.key} className={`admin-customers__summary-card is-${card.key}`}>
          <span>{card.label}</span><strong>{isLoading || (!hasData && isError) ? "—" : card.value}</strong>
        </article>)}
      </section>

      <section className="admin-customers__list" aria-labelledby="admin-customers-list-title">
        <div className="admin-customers__list-heading">
          <div>
            <h2 id="admin-customers-list-title">Usuários cadastrados</h2>
            <span aria-live="polite">{visibleCustomers.length} visíveis · {searchedCustomers.length} correspondem à busca</span>
          </div>
          <label className="admin-customers__search">
            <Search size={17} aria-hidden="true" />
            <input aria-label="Buscar por nome, e-mail ou ID" value={search} onChange={event => setSearch(event.target.value)} placeholder="Buscar por nome, e-mail ou ID" />
            {search ? <button type="button" aria-label="Limpar busca" onClick={() => setSearch("")}><X size={16} /></button> : null}
          </label>
          <button className="admin-customers__clear" type="button" disabled={!search && filter === "all"} onClick={() => { setSearch(""); setFilter("all"); }}>Limpar</button>
        </div>

        <div className="admin-customers__filters" role="group" aria-label="Filtrar usuários">
          {filterDefinitions.map(option => <button key={option.key} type="button" aria-pressed={filter === option.key} onClick={() => setFilter(option.key)}>
            {option.label}<span>{hasData ? filterCounts[option.key] : "—"}</span>
          </button>)}
        </div>
        <p className="admin-customers__filter-note">“Recentes” considera contas criadas nos últimos 30 dias. Busca e filtros atuam sobre a lista completa carregada pela API.</p>

        {isLoading ? <div className="admin-customers__state" role="status">Carregando usuários…</div> : null}
        {isError ? <div className="admin-customers__state admin-customers__state--error" role="alert">
          <div><strong>Não foi possível carregar os usuários.</strong><span>{hasData ? "A lista exibida pode estar desatualizada." : "Tente consultar novamente."}</span></div>
          {onRetry ? <button type="button" onClick={onRetry}>Tentar novamente</button> : null}
        </div> : null}
        {!isLoading && !isError && hasData && customers.length === 0 ? <div className="admin-customers__state">Nenhum usuário cadastrado.</div> : null}

        {!isLoading && (hasData || isError) && customers.length > 0 ? (
          <div className="admin-customers__table-scroll">
            <table className="admin-customers__table">
              <thead><tr><th scope="col">Usuário</th><th scope="col">Perfil</th><th scope="col">Conta</th><th scope="col">Pedidos</th><th scope="col">Último acesso</th><th scope="col"><span className="admin-customers__visually-hidden">Ação</span></th></tr></thead>
              <tbody>
                {visibleCustomers.map(customer => <tr key={customer.id}>
                  <td><div className="admin-customers__identity"><span className="admin-customers__avatar" aria-hidden="true">{initials(customer)}</span><span className="admin-customers__identity-copy"><strong>{customer.name || "Nome não informado"}</strong><span>{customer.email || "E-mail não informado"}</span><small>ID #{customer.id}</small></span></div></td>
                  <td data-label="Perfil"><div className="admin-customers__profile"><span className={customer.role === "admin" ? "is-admin" : ""}>{customer.role === "admin" ? "Administrador" : customer.role === "user" ? "Cliente" : `Perfil: ${customer.role}`}</span>{customer.isVip ? <small>VIP</small> : null}</div></td>
                  <td data-label="Conta"><span className={`admin-customers__account${customer.isBlocked ? " is-blocked" : ""}`}><i aria-hidden="true" />{customer.isBlocked ? "Bloqueada" : "Ativa"}</span></td>
                  <td data-label="Pedidos"><span className="admin-customers__orders">{customer.ordersCount}<small>{customer.ordersCount === 1 ? "pedido" : "pedidos"}</small></span></td>
                  <td data-label="Último acesso"><span className="admin-customers__last-access">{formatDate(customer.lastSignedIn, true)}</span></td>
                  <td><button className="admin-customers__view" type="button" aria-expanded={selectedId === customer.id} aria-controls="admin-customer-details" onClick={() => openProfile(customer.id)}>Ver detalhes</button></td>
                </tr>)}
                {!visibleCustomers.length ? <tr><td className="admin-customers__empty" colSpan={6}>Nenhum usuário corresponde à busca e ao filtro selecionados.</td></tr> : null}
              </tbody>
            </table>
          </div>
        ) : null}
        <p className="admin-customers__note">A API entrega a lista completa e os filtros são locais. Com o crescimento da base, a listagem deverá evoluir para paginação no servidor.</p>
      </section>

      <Dialog open={Boolean(selectedCustomer)} onOpenChange={open => { if (!open) closeProfile(); }}>
        {selectedCustomer ? <DialogContent id="admin-customer-details" className="admin-customers__dialog" showCloseButton={false} aria-describedby="admin-customer-details-description" onOpenAutoFocus={event => {
          event.preventDefault();
          (event.currentTarget as HTMLElement | null)?.querySelector<HTMLButtonElement>("button[aria-label='Fechar detalhes']")?.focus();
        }}>
          <DialogHeader className="admin-customers__dialog-header">
            <div className="admin-customers__dialog-identity">
              <span className="admin-customers__dialog-kicker">PERFIL DO CLIENTE</span>
              <DialogTitle>{selectedCustomer.name || `Usuário #${selectedCustomer.id}`}</DialogTitle>
              <div className="admin-customers__dialog-contact">
                <DialogDescription id="admin-customer-details-description">{selectedCustomer.email || "E-mail não informado"}</DialogDescription>
                <span>ID #{selectedCustomer.id}</span>
                <span>Dados cadastrais e movimentações históricas</span>
              </div>
              <div className="admin-customers__identity-chips" aria-label="Estado e perfil da conta">
                <span className={selectedCustomer.isBlocked ? "is-blocked" : "is-active"}>{selectedCustomer.isBlocked ? "Conta bloqueada" : "Conta ativa"}</span>
                <span className={selectedCustomer.role === "admin" ? "is-admin" : ""}>{selectedCustomer.role === "admin" ? "Administrador" : selectedCustomer.role === "user" ? "Cliente" : selectedCustomer.role}</span>
                <span className={selectedCustomer.isVip ? "is-vip" : ""}>{selectedCustomer.isVip ? "VIP" : "Sem identificação VIP"}</span>
              </div>
            </div>
            <button type="button" aria-label="Fechar detalhes" onClick={closeProfile}><X size={18} /></button>
          </DialogHeader>
          <div className="admin-customers__dialog-scroll">
            <div className="admin-customers__profile-grid">
              <div className="admin-customers__profile-column admin-customers__profile-column--identity">
              <section className="admin-customers__detail-block"><div className="admin-customers__section-heading"><div><span>CADASTRO</span><h3>Identificação</h3></div></div><dl>
                <div><dt>Nome</dt><dd>{selectedCustomer.name || "Não informado"}</dd></div>
                <div><dt>E-mail</dt><dd>{selectedCustomer.email || "Não informado"}</dd></div>
                <div><dt>ID interno</dt><dd>#{selectedCustomer.id}</dd></div>
                <div><dt>Cadastro</dt><dd>{formatDate(selectedCustomer.createdAt, true)}</dd></div>
                <div><dt>Último acesso</dt><dd>{formatDate(selectedCustomer.lastSignedIn, true)}</dd></div>
                <div><dt>Conta</dt><dd><span className={`admin-customers__account${selectedCustomer.isBlocked ? " is-blocked" : ""}`}><i aria-hidden="true" />{selectedCustomer.isBlocked ? "Bloqueada" : "Ativa"}</span></dd></div>
                <div><dt>Papel</dt><dd className={selectedCustomer.role === "admin" ? "is-admin" : ""}>{selectedCustomer.role === "admin" ? "Administrador" : selectedCustomer.role === "user" ? "Cliente" : selectedCustomer.role}</dd></div>
                <div><dt>VIP</dt><dd>{selectedCustomer.isVip ? "Identificado como VIP" : "Sem identificação VIP"}</dd></div>
              </dl></section>

              <section className="admin-customers__detail-block admin-customers__account-action">
                <div className="admin-customers__section-heading"><div><span>CONTROLES DE CONTA</span><h3>Ações administrativas</h3></div></div>
                <p>As alterações são auditadas e continuam sujeitas às permissões do servidor.</p>
                <div className="admin-customers__action-grid">
                  <button type="button" disabled={!onToggleVip || Boolean(mutationPending)} onClick={() => { setConfirmError(""); setConfirmAction(selectedCustomer.isVip ? "vipOff" : "vipOn"); }}>{selectedCustomer.isVip ? "Remover identificação VIP" : "Identificar como VIP"}</button>
                  <button type="button" disabled={!onSetRole || Boolean(mutationPending)} onClick={() => { setConfirmError(""); setConfirmAction(selectedCustomer.role === "admin" ? "adminOff" : "adminOn"); }}>{selectedCustomer.role === "admin" ? "Remover acesso admin" : "Promover a administrador"}</button>
                </div>
                <div className="admin-customers__critical-action">
                  <div><strong>Acesso à conta</strong><span>{selectedCustomer.isBlocked ? "A conta está bloqueada." : "Bloquear impede o acesso conforme as regras do sistema."}</span></div>
                  <button type="button" className={selectedCustomer.isBlocked ? "" : "is-danger"} disabled={!onToggleBlocked || Boolean(mutationPending)} onClick={() => { setConfirmError(""); setConfirmAction(selectedCustomer.isBlocked ? "unblock" : "block"); }}>{selectedCustomer.isBlocked ? "Desbloquear conta" : "Bloquear conta"}</button>
                </div>
                {selectedCustomer.role !== "admin" ? <p className="admin-customers__permission-note">A promoção depende da allowlist validada pelo servidor; este painel não concede permissões fora dela.</p> : null}
              </section>
              </div>

              <div className="admin-customers__profile-column admin-customers__profile-column--activity">
              <section className="admin-customers__detail-block admin-customers__movement">
                <div className="admin-customers__movement-heading"><div><span className="admin-customers__section-kicker">ATIVIDADE DO CLIENTE</span><h3>Resumo de movimentação</h3><span>{historyRange?.from || historyRange?.to ? "No período selecionado" : "Todo o histórico carregado"}</span></div></div>
                <div className="admin-customers__period-controls" role="group" aria-label="Período do histórico">
                  <button type="button" aria-pressed={historyMode === "all"} onClick={() => { setHistoryMode("all"); setCustomFrom(""); setCustomTo(""); onHistoryRangeChange(null); }}>Todo histórico</button>
                  <button type="button" aria-pressed={historyMode === "month"} onClick={showCurrentMonth}>Este mês</button>
                  <button type="button" aria-pressed={historyMode === "custom"} onClick={() => { setHistoryMode("custom"); if (customFrom || customTo) applyCustomRange(customFrom, customTo); }}>Personalizado</button>
                </div>
                {historyMode === "custom" ? <div className="admin-customers__date-range">
                  <label>De<input type="date" value={customFrom} max={customTo || undefined} onChange={event => applyCustomRange(event.target.value, customTo)} /></label>
                  <label>Até<input type="date" value={customTo} min={customFrom || undefined} onChange={event => applyCustomRange(customFrom, event.target.value)} /></label>
                </div> : null}
                {periodInvalid ? <p className="admin-customers__period-error" role="alert">A data inicial precisa ser anterior à data final.</p> : null}
                {!periodInvalid && (orderHistoryLoading || orderHistoryError) ? <div className="admin-customers__state admin-customers__history-state" role={orderHistoryError ? "alert" : "status"}>
                  {orderHistoryLoading ? "Carregando movimentações…" : <><span>Não foi possível consultar os pedidos deste cliente.</span>{onRetryOrderHistory ? <button type="button" onClick={onRetryOrderHistory}>Tentar novamente</button> : null}</>}
                </div> : null}
                {!periodInvalid && !orderHistoryLoading && !orderHistoryError ? <>
                  <div className="admin-customers__movement-grid">
                    <Metric label="Pedidos no período" value={String(history.length)} />
                    <Metric label="Valor registrado" value={formatPrice(orderValueCents / 100)} />
                    <Metric label="Pagamentos confirmados" value={formatPrice(confirmedValueCents / 100)} tone="confirmed" />
                    <Metric label="Pedidos cancelados" value={String(cancelledCount)} tone="cancelled" />
                  </div>
                  <div className="admin-customers__purchase-meta"><span>Última compra identificada<strong>{latestPurchase ? formatDate(latestPurchase, true) : "Sem pedidos"}</strong></span><span>Intervalo médio<strong>{averageIntervalDays === null ? "Dados insuficientes" : `${averageIntervalDays} dias entre pedidos`}</strong></span></div>
                  <p className="admin-customers__financial-note">Valor confirmado soma o total histórico dos pedidos com paymentStatus canônico “confirmed”; não desconta reembolsos nem representa receita líquida.</p>
                </> : null}
              </section>
            </div>

              <section className="admin-customers__detail-block admin-customers__history-block">
              <div className="admin-customers__history-heading"><div><span className="admin-customers__section-kicker">REGISTROS DA CONTA</span><h3>Histórico de pedidos</h3><p>Valores e estados vêm do registro histórico do pedido.</p></div><span>{!orderHistoryLoading && !orderHistoryError && !periodInvalid ? `${history.length} registro(s)` : ""}</span></div>
              {periodInvalid ? <p className="admin-customers__history-empty">Ajuste o período para consultar o histórico.</p> : null}
              {!periodInvalid && !orderHistoryLoading && !orderHistoryError && history.length === 0 ? <p className="admin-customers__history-empty">Nenhum pedido no período selecionado.</p> : null}
              {!periodInvalid && !orderHistoryLoading && !orderHistoryError && history.length > 0 ? <div className="admin-customers__history-table-wrap">
                <table className="admin-customers__history-table">
                  <thead><tr><th scope="col">Pedido</th><th scope="col">Data</th><th scope="col">Valor histórico</th><th scope="col">Pagamento</th><th scope="col">Logística</th><th scope="col"><span className="admin-customers__visually-hidden">Ação</span></th></tr></thead>
                  <tbody>{history.map(order => <tr key={order.id}>
                    <td data-label="Pedido"><strong>#{order.id}</strong></td>
                    <td data-label="Data">{formatDate(order.createdAt, true)}</td>
                    <td data-label="Valor histórico"><strong>{formatPrice(Number(order.totalPrice) / 100)}</strong></td>
                    <td data-label="Pagamento"><PaymentStatusBadge confirmed={order.paymentStatus === "confirmed"} /></td>
                    <td data-label="Logística"><OrderStatusBadge status={order.status} label={getOrderStatusLabel(order.status)} tone={getOrderStatusTone(order.status)} /></td>
                    <td><button type="button" className="admin-customers__order-link" onClick={() => onOpenOrder(order.id)}>Ver pedido</button></td>
                  </tr>)}</tbody>
                </table>
              </div> : null}
              </section>
              </div>
          </div>
        </DialogContent> : null}
      </Dialog>

      <AlertDialog open={Boolean(confirmAction)} onOpenChange={open => { if (!open && !mutationPending) { setConfirmAction(null); setConfirmError(""); } }}>
        {selectedCustomer && actionCopy ? <AlertDialogContent className="admin-confirm-dialog" onEscapeKeyDown={event => { if (mutationPending) event.preventDefault(); }}>
          <AlertDialogHeader><AlertDialogTitle>{actionCopy.title}</AlertDialogTitle>
            <AlertDialogDescription><strong>{selectedCustomer.name || "Nome não informado"}</strong>{selectedCustomer.email ? ` · ${selectedCustomer.email}` : ""} · ID #{selectedCustomer.id}. {actionCopy.description}</AlertDialogDescription>
          </AlertDialogHeader>
          {confirmError ? <p className="admin-confirm-dialog__error" role="alert">{confirmError}</p> : null}
          <AlertDialogFooter className="admin-confirm-dialog__footer">
            <button type="button" disabled={Boolean(mutationPending)} onClick={() => setConfirmAction(null)}>Cancelar</button>
            <button type="button" className={confirmAction === "block" ? "is-danger" : ""} disabled={Boolean(mutationPending)} onClick={() => void confirmSelectedAction()}>
              {mutationPending ? "Processando…" : actionCopy.button}
            </button>
          </AlertDialogFooter>
        </AlertDialogContent> : null}
      </AlertDialog>
    </div>
  );
}

function Metric({ label, value, tone = "neutral" }: { label: string; value: string; tone?: "neutral" | "confirmed" | "cancelled" }) {
  return <article className={`admin-customers__movement-card is-${tone}`}><span>{label}</span><strong>{value}</strong></article>;
}
