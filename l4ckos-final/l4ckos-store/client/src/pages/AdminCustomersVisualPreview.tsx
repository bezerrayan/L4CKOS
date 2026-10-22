import { useEffect, useMemo, useRef, useState } from "react";
import { useIsMobile } from "../hooks/useIsMobile";
import { AdminSidebarProfile } from "../components/admin/AdminSidebarProfile";
import { AdminCustomersPanel, type AdminCustomerRecord } from "../components/admin/customers/AdminCustomersPanel";
import "../components/admin/AdminOrdersVisualPreview.css";
import "../components/admin/AdminCustomersVisualPreview.css";

type CustomerFilter = "all" | "customers" | "admins" | "vip" | "active" | "blocked" | "recent";
type PreviewCustomer = {
  id: number;
  name: string;
  email: string;
  role: "user" | "admin";
  isVip: boolean;
  isBlocked: boolean;
  ordersCount: number;
  createdAt: Date;
  lastSignedIn: Date;
};

const now = Date.now();
const daysAgo = (days: number) => new Date(now - days * 24 * 60 * 60 * 1000);
const hoursAgo = (hours: number) => new Date(now - hours * 60 * 60 * 1000);
const customerFixtures: PreviewCustomer[] = [
  { id: 9408, name: "Marina Costa", email: "marina.costa@example.test", role: "user", isVip: true, isBlocked: false, ordersCount: 8, createdAt: daysAgo(4), lastSignedIn: hoursAgo(3) },
  { id: 9407, name: "Rafael Nogueira", email: "rafael.nogueira@example.test", role: "user", isVip: false, isBlocked: false, ordersCount: 3, createdAt: daysAgo(12), lastSignedIn: daysAgo(1) },
  { id: 9406, name: "Equipe L4CKOS", email: "equipe@example.test", role: "admin", isVip: false, isBlocked: false, ordersCount: 0, createdAt: daysAgo(280), lastSignedIn: hoursAgo(5) },
  { id: 9405, name: "Camila Freire", email: "camila.freire@example.test", role: "user", isVip: true, isBlocked: false, ordersCount: 12, createdAt: daysAgo(45), lastSignedIn: daysAgo(3) },
  { id: 9404, name: "Bruno Almeida", email: "bruno.almeida@example.test", role: "user", isVip: false, isBlocked: true, ordersCount: 1, createdAt: daysAgo(90), lastSignedIn: daysAgo(60) },
  { id: 9403, name: "Joana Martins", email: "joana.martins@example.test", role: "user", isVip: false, isBlocked: false, ordersCount: 0, createdAt: daysAgo(2), lastSignedIn: hoursAgo(20) },
  { id: 9402, name: "Operação L4CKOS", email: "operacao@example.test", role: "admin", isVip: false, isBlocked: false, ordersCount: 0, createdAt: daysAgo(430), lastSignedIn: daysAgo(2) },
  { id: 9401, name: "Pedro Ribeiro", email: "pedro.ribeiro@example.test", role: "user", isVip: false, isBlocked: false, ordersCount: 2, createdAt: daysAgo(160), lastSignedIn: daysAgo(18) },
];

const filterDefinitions: Array<{ key: CustomerFilter; label: string }> = [
  { key: "all", label: "Todos" },
  { key: "customers", label: "Clientes" },
  { key: "admins", label: "Administradores" },
  { key: "vip", label: "VIP" },
  { key: "active", label: "Ativos" },
  { key: "blocked", label: "Bloqueados" },
  { key: "recent", label: "Recentes" },
];

const navGroups = [
  { heading: "Visão geral", items: ["Dashboard / KPIs"] },
  { heading: "Operação", items: ["Pedidos", "Produtos", "Clientes", "Lotes / Pré-venda"] },
  { heading: "Comercial", items: ["Promoções", "Cupons", "Avaliações"] },
  { heading: "Sistema", items: ["Relatórios", "Auditoria", "Backup", "Configurações"] },
];

const formatDate = (date: Date) => new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "short", year: "numeric" }).format(date);
const formatDateTime = (date: Date) => new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }).format(date);
const initials = (name: string) => name.split(/\s+/).filter(Boolean).slice(0, 2).map(part => part[0]).join("").toLocaleUpperCase("pt-BR");

export default function AdminCustomersVisualPreview() {
  const [mockCustomers, setMockCustomers] = useState<PreviewCustomer[]>(customerFixtures);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<CustomerFilter>("all");
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const mobile = useIsMobile(900);
  const menuRef = useRef<HTMLElement>(null);
  const menuTriggerRef = useRef<HTMLButtonElement>(null);
  const detailRef = useRef<HTMLElement>(null);
  const detailTriggerRef = useRef<HTMLButtonElement>(null);

  const searchedCustomers = useMemo(() => {
    const query = search.trim().toLocaleLowerCase("pt-BR");
    return customerFixtures.filter(customer => !query || [customer.name, customer.email, String(customer.id)].some(value => value.toLocaleLowerCase("pt-BR").includes(query)));
  }, [search]);

  const counts = useMemo(() => {
    const recentCutoff = now - 30 * 24 * 60 * 60 * 1000;
    return {
      all: searchedCustomers.length,
      customers: searchedCustomers.filter(customer => customer.role === "user").length,
      admins: searchedCustomers.filter(customer => customer.role === "admin").length,
      vip: searchedCustomers.filter(customer => customer.isVip).length,
      active: searchedCustomers.filter(customer => !customer.isBlocked).length,
      blocked: searchedCustomers.filter(customer => customer.isBlocked).length,
      recent: searchedCustomers.filter(customer => customer.createdAt.getTime() >= recentCutoff).length,
    } satisfies Record<CustomerFilter, number>;
  }, [searchedCustomers]);

  const visibleCustomers = useMemo(() => {
    const recentCutoff = now - 30 * 24 * 60 * 60 * 1000;
    return searchedCustomers.filter(customer => {
      if (filter === "customers") return customer.role === "user";
      if (filter === "admins") return customer.role === "admin";
      if (filter === "vip") return customer.isVip;
      if (filter === "active") return !customer.isBlocked;
      if (filter === "blocked") return customer.isBlocked;
      if (filter === "recent") return customer.createdAt.getTime() >= recentCutoff;
      return true;
    });
  }, [filter, searchedCustomers]);

  const selectedCustomer = customerFixtures.find(customer => customer.id === selectedId) ?? null;

  useEffect(() => {
    if (!menuOpen || !mobile) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    menuRef.current?.querySelector<HTMLButtonElement>("button[aria-current=page]")?.focus();
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setMenuOpen(false);
        menuTriggerRef.current?.focus();
      }
      if (event.key === "Tab" && menuRef.current) {
        const focusable = Array.from(menuRef.current.querySelectorAll<HTMLElement>("button:not(:disabled)"));
        if (event.shiftKey && document.activeElement === focusable[0]) { event.preventDefault(); focusable.at(-1)?.focus(); }
        else if (!event.shiftKey && document.activeElement === focusable.at(-1)) { event.preventDefault(); focusable[0]?.focus(); }
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [menuOpen, mobile]);

  useEffect(() => {
    if (!selectedCustomer) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    detailRef.current?.focus();
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setSelectedId(null);
        window.requestAnimationFrame(() => detailTriggerRef.current?.focus());
      }
      if (event.key === "Tab" && detailRef.current) {
        const focusable = Array.from(detailRef.current.querySelectorAll<HTMLElement>("button:not(:disabled)"));
        if (event.shiftKey && document.activeElement === focusable[0]) { event.preventDefault(); focusable.at(-1)?.focus(); }
        else if (!event.shiftKey && document.activeElement === focusable.at(-1)) { event.preventDefault(); focusable[0]?.focus(); }
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [selectedCustomer]);

  const openDetails = (customer: PreviewCustomer, trigger: HTMLButtonElement) => {
    detailTriggerRef.current = trigger;
    setSelectedId(customer.id);
  };
  const closeDetails = () => {
    setSelectedId(null);
    window.requestAnimationFrame(() => detailTriggerRef.current?.focus());
  };

  if (new URLSearchParams(window.location.search).get("integration-panel") === "1") {
    const mockState = new URLSearchParams(window.location.search).get("state");
    const mockError = mockState === "error";
    const mockLoading = mockState === "loading";
    return <div className="l4-orders-preview l4-customers-preview">
      {menuOpen && mobile ? <button className="orders-menu-backdrop" type="button" aria-label="Fechar navegação" onClick={() => { setMenuOpen(false); menuTriggerRef.current?.focus(); }} /> : null}
      <aside className={`orders-sidebar${menuOpen ? " is-open" : ""}`} id="customers-preview-navigation" ref={menuRef} aria-label="Navegação administrativa">
        <div className="l4-admin-brand"><strong>L4CKOS</strong><span>GESTÃO</span><small>PRÉVIA DE INTEGRAÇÃO</small></div>
        <button type="button" className="orders-menu-close" onClick={() => { setMenuOpen(false); menuTriggerRef.current?.focus(); }}>Fechar menu</button>
        <nav className="orders-nav-scroll" aria-label="Seções da gestão">{navGroups.map(group => <div className="orders-nav-group" key={group.heading}><h2>{group.heading}</h2>{group.items.map(item => item === "Clientes" ? <button key={item} type="button" aria-current="page">{item}</button> : <span className="orders-nav-inactive" key={item}>{item}</span>)}</div>)}</nav>
        <AdminSidebarProfile name="Administradora de demonstração" email="admin.demo@example.test" preview />
      </aside>
      <main className="orders-main-column">
        <button ref={menuTriggerRef} type="button" className="orders-mobile-menu-trigger" aria-expanded={menuOpen} aria-controls="customers-preview-navigation" onClick={() => setMenuOpen(true)}>☰ <span>Menu administrativo</span></button>
        <div className="orders-preview-banner"><span><strong>L4CKOS / GESTÃO</strong><span className="orders-preview-divider">/</span> Componente Clientes integrado</span><span className="orders-preview-fake-label">MOCK LOCAL · SEM API</span></div>
        <AdminCustomersPanel
          customers={mockState === "empty" ? [] : mockCustomers as AdminCustomerRecord[]}
          isLoading={mockLoading}
          isError={mockError}
          initialSelectedCustomerId={Number(new URLSearchParams(window.location.search).get("details")) || null}
          onRetry={() => window.location.reload()}
          onToggleBlocked={async (userId, isBlocked) => {
            setMockCustomers(current => current.map(customer => customer.id === userId ? { ...customer, isBlocked } : customer));
          }}
          pendingCustomerId={undefined}
        />
      </main>
    </div>;
  }

  return <div className="l4-orders-preview l4-customers-preview">
    {menuOpen && mobile ? <button className="orders-menu-backdrop" type="button" aria-label="Fechar navegação" onClick={() => { setMenuOpen(false); menuTriggerRef.current?.focus(); }} /> : null}
    <aside className={`orders-sidebar${menuOpen ? " is-open" : ""}`} id="customers-preview-navigation" ref={menuRef} aria-label="Navegação administrativa" inert={Boolean(selectedCustomer) || (mobile && !menuOpen)}>
      <div className="l4-admin-brand"><strong>L4CKOS</strong><span>GESTÃO</span><small>PRÉVIA VISUAL</small></div>
      <button type="button" className="orders-menu-close" onClick={() => { setMenuOpen(false); menuTriggerRef.current?.focus(); }}>Fechar menu</button>
      <nav className="orders-nav-scroll" aria-label="Seções da gestão">{navGroups.map(group => <div className="orders-nav-group" key={group.heading}><h2>{group.heading}</h2>{group.items.map(item => item === "Clientes" ? <button key={item} type="button" aria-current="page">{item}</button> : <span className="orders-nav-inactive" key={item}>{item}</span>)}</div>)}</nav>
      <AdminSidebarProfile name="Luna Administradora" email="admin.demo@example.test" preview />
    </aside>

    <main className="orders-main-column" inert={Boolean(selectedCustomer)}>
      <button ref={menuTriggerRef} type="button" className="orders-mobile-menu-trigger" aria-expanded={menuOpen} aria-controls="customers-preview-navigation" onClick={() => setMenuOpen(true)}>☰ <span>Menu administrativo</span></button>
      <div className="orders-preview-banner"><span><strong>L4CKOS / GESTÃO</strong><span className="orders-preview-divider">/</span> Prévia de Clientes e Usuários</span><span className="orders-preview-fake-label">AMBIENTE LOCAL · DADOS FICTÍCIOS</span></div>
      <header className="orders-preview-heading customers-heading"><div><p className="orders-preview-eyebrow">Operação · Acessos</p><h1>Clientes e Usuários</h1><p>Consulte perfis, atividade e histórico resumido.</p></div></header>

      <section className="customers-summary" aria-label="Resumo de usuários">
        <div><span>Total de usuários</span><strong>{customerFixtures.length}</strong></div>
        <div><span>Clientes</span><strong>{customerFixtures.filter(customer => customer.role === "user").length}</strong></div>
        <div><span>Administradores</span><strong>{customerFixtures.filter(customer => customer.role === "admin").length}</strong></div>
        <div><span>Contas bloqueadas</span><strong>{customerFixtures.filter(customer => customer.isBlocked).length}</strong></div>
      </section>

      <section className="customers-list-section" aria-label="Lista de clientes e usuários">
        <div className="customers-list-heading"><div><h2>Usuários cadastrados</h2><span aria-live="polite">{visibleCustomers.length} de {searchedCustomers.length} encontrados</span></div>
          <label className="customers-search"><span aria-hidden="true">⌕</span><input aria-label="Buscar por nome, e-mail ou ID" value={search} onChange={event => setSearch(event.target.value)} placeholder="Buscar por nome, e-mail ou ID" />{search ? <button type="button" aria-label="Limpar busca" onClick={() => setSearch("")}>×</button> : null}</label>
          <button type="button" className="customers-clear" disabled={!search && filter === "all"} onClick={() => { setSearch(""); setFilter("all"); }}>Limpar</button>
        </div>
        <div className="customers-filters" role="group" aria-label="Filtrar usuários">
          {filterDefinitions.map(option => <button type="button" key={option.key} aria-pressed={filter === option.key} onClick={() => setFilter(option.key)}>{option.label}<span>{counts[option.key]}</span></button>)}
        </div>
        <p className="customers-filter-note">“Recentes” considera contas cadastradas nos últimos 30 dias.</p>

        <div className="customers-table-scroll"><table className="customers-table">
          <thead><tr><th scope="col">Cliente</th><th scope="col">Perfil</th><th scope="col">Conta</th><th scope="col">Pedidos</th><th scope="col">Último acesso</th><th scope="col"><span className="customers-visually-hidden">Detalhes</span></th></tr></thead>
          <tbody>
            {visibleCustomers.map(customer => <tr key={customer.id}>
              <td><div className="customers-identity"><span className="customers-avatar" aria-hidden="true">{initials(customer.name)}</span><span className="customers-identity-copy"><strong>{customer.name}</strong><span>{customer.email}</span><small>ID #{customer.id}</small></span></div></td>
              <td data-label="Perfil"><div className="customers-profile"><span className={customer.role === "admin" ? "is-admin" : ""}>{customer.role === "admin" ? "Administrador" : "Cliente"}</span>{customer.isVip ? <small>VIP</small> : null}</div></td>
              <td data-label="Conta"><span className={`customers-account${customer.isBlocked ? " is-blocked" : ""}`}><i aria-hidden="true" />{customer.isBlocked ? "Bloqueada" : "Ativa"}</span></td>
              <td data-label="Pedidos"><span className="customers-order-count">{customer.ordersCount}<small>{customer.ordersCount === 1 ? "pedido" : "pedidos"}</small></span></td>
              <td data-label="Último acesso"><span className="customers-last-access">{formatDateTime(customer.lastSignedIn)}</span></td>
              <td><button ref={element => { if (selectedId === customer.id && element) detailTriggerRef.current = element; }} type="button" className="customers-view" aria-expanded={selectedId === customer.id} aria-controls="customer-detail-panel" onClick={event => openDetails(customer, event.currentTarget)}>Ver detalhes</button></td>
            </tr>)}
            {!visibleCustomers.length ? <tr><td className="customers-empty" colSpan={6}>Nenhum usuário corresponde à busca e ao filtro selecionados.</td></tr> : null}
          </tbody>
        </table></div>
        <p className="customers-preview-note">Registros fictícios para revisão visual. Busca e filtros atuam somente nesta página.</p>
      </section>
    </main>

    {selectedCustomer ? <>
      <button type="button" className="customers-detail-backdrop" aria-label="Fechar detalhes do cliente" onClick={closeDetails} />
      <aside ref={detailRef} id="customer-detail-panel" className="customers-detail-panel" role="dialog" aria-modal="true" aria-labelledby="customer-detail-title" tabIndex={-1}>
        <div className="customers-detail-header"><div><span>DETALHES DO USUÁRIO</span><h2 id="customer-detail-title">{selectedCustomer.name}</h2></div><button type="button" aria-label="Fechar detalhes" onClick={closeDetails}>×</button></div>
        <div className="customers-detail-content">
          <section className="customers-detail-block"><h3>Identificação</h3><dl><div><dt>E-mail</dt><dd>{selectedCustomer.email}</dd></div><div><dt>ID do usuário</dt><dd>#{selectedCustomer.id}</dd></div></dl></section>
          <section className="customers-detail-block"><h3>Perfil e conta</h3><dl><div><dt>Perfil</dt><dd className={selectedCustomer.role === "admin" ? "is-admin" : ""}>{selectedCustomer.role === "admin" ? "Administrador" : "Cliente"}</dd></div><div><dt>Situação</dt><dd><span className={`customers-account${selectedCustomer.isBlocked ? " is-blocked" : ""}`}><i aria-hidden="true" />{selectedCustomer.isBlocked ? "Bloqueada" : "Ativa"}</span></dd></div><div><dt>Programa VIP</dt><dd>{selectedCustomer.isVip ? "Participante" : "Não participante"}</dd></div></dl></section>
          <section className="customers-detail-block"><h3>Histórico de pedidos</h3><div className="customers-detail-order-total"><strong>{selectedCustomer.ordersCount}</strong><span>{selectedCustomer.ordersCount === 1 ? "pedido registrado" : "pedidos registrados"}</span></div><p>A listagem disponível informa a quantidade total; não inclui os pedidos individuais.</p></section>
          <section className="customers-detail-block"><h3>Atividade</h3><dl><div><dt>Conta criada</dt><dd>{formatDate(selectedCustomer.createdAt)}</dd></div><div><dt>Último acesso</dt><dd>{formatDateTime(selectedCustomer.lastSignedIn)}</dd></div></dl></section>
          <section className="customers-detail-block customers-admin-actions"><h3>Ações administrativas</h3><p>Bloqueio e desbloqueio podem ser feitos somente na gestão autenticada.</p><button type="button" disabled>{selectedCustomer.isBlocked ? "Desbloquear conta" : "Bloquear conta"}</button><small>Ação desativada nesta prévia.</small></section>
        </div>
      </aside>
    </> : null}
  </div>;
}
