import { useMemo, useState } from "react";
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

type CustomerFilter = "all" | "customers" | "admins" | "vip" | "active" | "blocked" | "recent";

type AdminCustomersPanelProps = {
  customers?: AdminCustomerRecord[];
  isLoading?: boolean;
  isError?: boolean;
  onRetry?: () => void;
  pendingCustomerId?: number;
  initialSelectedCustomerId?: number | null;
  onToggleBlocked?: (userId: number, isBlocked: boolean) => Promise<void>;
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

export function AdminCustomersPanel({
  customers: customerData,
  isLoading = false,
  isError = false,
  onRetry,
  pendingCustomerId,
  initialSelectedCustomerId = null,
  onToggleBlocked,
}: AdminCustomersPanelProps) {
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<CustomerFilter>("all");
  const [selectedId, setSelectedId] = useState<number | null>(initialSelectedCustomerId);
  const [confirmOpen, setConfirmOpen] = useState(false);
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

  async function confirmBlockChange() {
    if (!selectedCustomer || !onToggleBlocked || mutationPending) return;
    setConfirmError("");
    try {
      await onToggleBlocked(selectedCustomer.id, !selectedCustomer.isBlocked);
      setConfirmOpen(false);
    } catch {
      setConfirmError("Não foi possível atualizar a conta. Revise a mensagem de erro e tente novamente.");
    }
  }

  return (
    <div className="admin-customers">
      <header className="admin-customers__heading">
        <div>
          <p className="admin-customers__eyebrow">Operação · Acessos</p>
          <h1>Clientes e Usuários</h1>
          <p>Consulte perfis, atividade e histórico resumido.</p>
        </div>
      </header>

      <section className="admin-customers__summary" aria-label="Resumo de usuários">
        {[
          ["Total de usuários", summary.total],
          ["Clientes", summary.customers],
          ["Administradores", summary.admins],
          ["Contas bloqueadas", summary.blocked],
        ].map(([label, value]) => <div key={label}>
          <span>{label}</span><strong>{isLoading || (!hasData && isError) ? "—" : value}</strong>
        </div>)}
      </section>

      <section className="admin-customers__list" aria-labelledby="admin-customers-list-title">
        <div className="admin-customers__list-heading">
          <div>
            <h2 id="admin-customers-list-title">Usuários cadastrados</h2>
            <span aria-live="polite">{visibleCustomers.length} de {searchedCustomers.length} encontrados</span>
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
        <p className="admin-customers__filter-note">“Recentes” considera contas criadas nos últimos 30 dias. Busca e filtros atuam sobre a lista carregada.</p>

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
                  <td data-label="Perfil"><div className="admin-customers__profile"><span className={customer.role === "admin" ? "is-admin" : ""}>{customer.role === "admin" ? "Administrador" : customer.role === "user" ? "Cliente" : `Perfil: ${customer.role}`}</span>{customer.isVip ? <small>VIP · consulta</small> : null}</div></td>
                  <td data-label="Conta"><span className={`admin-customers__account${customer.isBlocked ? " is-blocked" : ""}`}><i aria-hidden="true" />{customer.isBlocked ? "Bloqueada" : "Ativa"}</span></td>
                  <td data-label="Pedidos"><span className="admin-customers__orders">{customer.ordersCount}<small>{customer.ordersCount === 1 ? "pedido" : "pedidos"}</small></span></td>
                  <td data-label="Último acesso"><span className="admin-customers__last-access">{formatDate(customer.lastSignedIn, true)}</span></td>
                  <td><button className="admin-customers__view" type="button" aria-expanded={selectedId === customer.id} aria-controls="admin-customer-details" onClick={() => setSelectedId(customer.id)}>Ver detalhes</button></td>
                </tr>)}
                {!visibleCustomers.length ? <tr><td className="admin-customers__empty" colSpan={6}>Nenhum usuário corresponde à busca e ao filtro selecionados.</td></tr> : null}
              </tbody>
            </table>
          </div>
        ) : null}
        <p className="admin-customers__note">A API atual entrega a lista completa, sem paginação; os filtros são aplicados localmente ao conjunto carregado.</p>
      </section>

      <Dialog open={Boolean(selectedCustomer)} onOpenChange={open => { if (!open) { setSelectedId(null); setConfirmOpen(false); } }}>
        {selectedCustomer ? <DialogContent id="admin-customer-details" className="admin-customers__dialog" showCloseButton={false} aria-describedby="admin-customer-details-description" onOpenAutoFocus={event => {
          event.preventDefault();
          (event.currentTarget as HTMLElement | null)?.querySelector<HTMLButtonElement>("button[aria-label='Fechar detalhes']")?.focus();
        }}>
          <DialogHeader className="admin-customers__dialog-header">
            <div><span>DETALHES DO USUÁRIO</span><DialogTitle>{selectedCustomer.name || `Usuário #${selectedCustomer.id}`}</DialogTitle><DialogDescription id="admin-customer-details-description">Informações disponíveis na listagem administrativa.</DialogDescription></div>
            <button type="button" aria-label="Fechar detalhes" onClick={() => setSelectedId(null)}><X size={18} /></button>
          </DialogHeader>
          <div className="admin-customers__dialog-scroll">
            <section className="admin-customers__detail-block"><h3>Identificação</h3><dl><div><dt>E-mail</dt><dd>{selectedCustomer.email || "Não informado"}</dd></div><div><dt>ID do usuário</dt><dd>#{selectedCustomer.id}</dd></div></dl></section>
            <section className="admin-customers__detail-block"><h3>Perfil e conta</h3><dl><div><dt>Perfil</dt><dd className={selectedCustomer.role === "admin" ? "is-admin" : ""}>{selectedCustomer.role === "admin" ? "Administrador" : selectedCustomer.role === "user" ? "Cliente" : selectedCustomer.role}</dd></div><div><dt>Situação</dt><dd><span className={`admin-customers__account${selectedCustomer.isBlocked ? " is-blocked" : ""}`}><i aria-hidden="true" />{selectedCustomer.isBlocked ? "Bloqueada" : "Ativa"}</span></dd></div><div><dt>Programa VIP</dt><dd>{selectedCustomer.isVip ? "Identificado como VIP" : "Sem identificação VIP"}</dd></div></dl></section>
            <section className="admin-customers__detail-block"><h3>Histórico de pedidos</h3><div className="admin-customers__order-total"><strong>{selectedCustomer.ordersCount}</strong><span>{selectedCustomer.ordersCount === 1 ? "pedido registrado" : "pedidos registrados"}</span></div><p>A listagem informa somente a quantidade total; os pedidos individuais não são consultados nesta área.</p></section>
            <section className="admin-customers__detail-block"><h3>Atividade</h3><dl><div><dt>Conta criada</dt><dd>{formatDate(selectedCustomer.createdAt)}</dd></div><div><dt>Último acesso</dt><dd>{formatDate(selectedCustomer.lastSignedIn, true)}</dd></div></dl></section>
            <section className="admin-customers__detail-block admin-customers__account-action"><h3>Conta</h3><p>Bloqueio impede o acesso da conta conforme as regras existentes no servidor.</p><button type="button" disabled={!onToggleBlocked || Boolean(mutationPending)} onClick={() => { setConfirmError(""); setConfirmOpen(true); }}>
              {mutationPending ? "Atualizando…" : selectedCustomer.isBlocked ? "Desbloquear conta" : "Bloquear conta"}
            </button></section>
          </div>
        </DialogContent> : null}
      </Dialog>

      <AlertDialog open={confirmOpen} onOpenChange={open => { if (!mutationPending) setConfirmOpen(open); }}>
        {selectedCustomer ? <AlertDialogContent className="admin-confirm-dialog" onEscapeKeyDown={event => { if (mutationPending) event.preventDefault(); }}>
          <AlertDialogHeader><AlertDialogTitle>{selectedCustomer.isBlocked ? "Desbloquear esta conta?" : "Bloquear esta conta?"}</AlertDialogTitle>
            <AlertDialogDescription>{selectedCustomer.isBlocked
              ? `A conta #${selectedCustomer.id} voltará a poder acessar os recursos permitidos pelo sistema.`
              : `A conta #${selectedCustomer.id} ficará bloqueada conforme a política existente. Esta ação não altera pedidos.`}</AlertDialogDescription>
          </AlertDialogHeader>
          {confirmError ? <p className="admin-confirm-dialog__error" role="alert">{confirmError}</p> : null}
          <AlertDialogFooter className="admin-confirm-dialog__footer">
            <button type="button" disabled={Boolean(mutationPending)} onClick={() => setConfirmOpen(false)}>Cancelar</button>
            <button type="button" className={selectedCustomer.isBlocked ? "" : "is-danger"} disabled={Boolean(mutationPending)} onClick={() => void confirmBlockChange()}>
              {mutationPending ? "Processando…" : selectedCustomer.isBlocked ? "Confirmar desbloqueio" : "Confirmar bloqueio"}
            </button>
          </AlertDialogFooter>
        </AlertDialogContent> : null}
      </AlertDialog>
    </div>
  );
}
