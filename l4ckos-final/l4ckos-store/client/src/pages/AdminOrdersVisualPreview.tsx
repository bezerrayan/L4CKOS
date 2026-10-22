import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import "../components/admin/AdminOrdersVisualPreview.css";
import { useIsMobile } from "../hooks/useIsMobile";
import { AdminSidebarProfile } from "../components/admin/AdminSidebarProfile";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../components/ui/select";
import { CANCELLATION_NOTICE } from "../../../shared/paymentExceptions";

type Status = "pending" | "paid" | "processing" | "shipped" | "delivered" | "cancelled";
type Order = {
  id: number;
  userId: number;
  customerName: string;
  customerEmail: string;
  status: Status;
  paymentStatus: "confirmed" | "pending";
  paymentConfirmationSource?: "manual" | "asaas_webhook";
  paymentConfirmedAt?: string;
  paymentConfirmedBy?: number;
  totalPrice: number;
  trackingCode?: string;
  createdAt: string;
  shippingAddress?: {
    recipient: string;
    source: "order" | "profile";
    street: string;
    number: string;
    complement?: string;
    neighborhood: string;
    city: string;
    state: string;
    zipCode: string;
  };
  items: Array<{
    productId: number;
    productName: string;
    quantity: number;
    imageUrl?: string;
    variant?: string;
    unitPriceCents?: number;
    subtotalCents?: number;
  }>;
};

const orders: Order[] = [
  {
    id: 1048, userId: 41, customerName: "Marina Costa", customerEmail: "marina.exemplo@email.test", status: "paid", paymentStatus: "confirmed", paymentConfirmationSource: "asaas_webhook", paymentConfirmedAt: "2026-10-20T10:42:00-03:00", totalPrice: 18990, createdAt: "2026-10-20T10:40:00-03:00",
    shippingAddress: { recipient: "Marina Costa", source: "order", street: "Rua das Palmeiras", number: "184", complement: "Apto 32", neighborhood: "Centro", city: "Campinas", state: "SP", zipCode: "13010-110" },
    items: [{ productId: 71, productName: "Camiseta L4CKOS — No Signal", quantity: 1 }],
  },
  {
    id: 1047, userId: 42, customerName: "Rafael Mendes", customerEmail: "rafael.exemplo@email.test", status: "pending", paymentStatus: "pending", totalPrice: 25990, createdAt: "2026-10-17T09:15:00-03:00",
    shippingAddress: { recipient: "Rafael Mendes", source: "profile", street: "Av. Independência", number: "920", neighborhood: "Jardim América", city: "São Paulo", state: "SP", zipCode: "01420-002" },
    items: [
      { productId: 74, productName: "Camiseta L4CKOS — Clã 14 Bis", quantity: 1, imageUrl: "/images/hero/camiseta-cla-14-bis-recorte.png", variant: "Azul-marinho · M", unitPriceCents: 22990, subtotalCents: 22990 },
      { productId: 76, productName: "Meia L4CKOS", quantity: 1, variant: "Tamanho único", unitPriceCents: 3000, subtotalCents: 3000 },
    ],
  },
  { id: 1046, userId: 43, customerName: "Lucas Almeida", customerEmail: "lucas.exemplo@email.test", status: "paid", paymentStatus: "confirmed", paymentConfirmationSource: "manual", paymentConfirmedAt: "2026-10-20T09:18:00-03:00", paymentConfirmedBy: 1, totalPrice: 12990, createdAt: "2026-10-20T09:12:00-03:00", items: [{ productId: 73, productName: "Boné L4CKOS", quantity: 1 }] },
  { id: 1045, userId: 44, customerName: "Ana Ribeiro", customerEmail: "ana.exemplo@email.test", status: "shipped", paymentStatus: "confirmed", paymentConfirmationSource: "asaas_webhook", paymentConfirmedAt: "2026-10-19T15:10:00-03:00", totalPrice: 34990, createdAt: "2026-10-19T15:05:00-03:00", items: [{ productId: 79, productName: "Jaqueta L4CKOS — Concrete", quantity: 1 }] },
  { id: 1044, userId: 45, customerName: "João Ferreira", customerEmail: "joao.exemplo@email.test", status: "processing", paymentStatus: "confirmed", paymentConfirmationSource: "asaas_webhook", paymentConfirmedAt: "2026-10-18T14:40:00-03:00", trackingCode: "BR123456789XX", totalPrice: 21990, createdAt: "2026-10-18T14:35:00-03:00", items: [{ productId: 72, productName: "Camiseta L4CKOS — Essential", quantity: 1 }] },
  { id: 1043, userId: 46, customerName: "Beatriz Nunes", customerEmail: "beatriz.exemplo@email.test", status: "delivered", paymentStatus: "confirmed", paymentConfirmationSource: "asaas_webhook", paymentConfirmedAt: "2026-10-16T11:30:00-03:00", trackingCode: "BR987654321XX", totalPrice: 15990, createdAt: "2026-10-15T11:24:00-03:00", items: [{ productId: 77, productName: "Shoulder bag L4CKOS", quantity: 1 }] },
  { id: 1042, userId: 47, customerName: "Pedro Santos", customerEmail: "pedro.exemplo@email.test", status: "cancelled", paymentStatus: "pending", totalPrice: 28990, createdAt: "2026-10-19T08:10:00-03:00", items: [{ productId: 78, productName: "Moletom L4CKOS — Static", quantity: 1 }] },
];

const statusLabels: Record<Status, string> = {
  pending: "Aguardando pagamento", paid: "Pagamento confirmado", processing: "Em separação", shipped: "Enviado", delivered: "Entregue", cancelled: "Cancelado",
};

const deliveryLabels: Record<Status, string> = {
  pending: "Não iniciada",
  paid: "Aguardando preparação",
  processing: "Em separação",
  shipped: "Enviado",
  delivered: "Entregue",
  cancelled: "Sem entrega ativa",
};
const filterLabels = [
  ["all", "Todos"], ["pending", "Pendentes"], ["paid", "Pagos"], ["processing", "Separação"], ["shipped", "Enviados"], ["delivered", "Entregues"], ["cancelled", "Cancelados"], ["withoutTracking", "Sem rastreio"],
] as const;
type Filter = (typeof filterLabels)[number][0];
const navGroups = [
  { heading: "Visão geral", items: [{ label: "Dashboard / KPIs" }] },
  { heading: "Operação", items: [{ label: "Pedidos", active: true }, { label: "Produtos" }, { label: "Clientes" }, { label: "Lotes / Pré-venda" }] },
  { heading: "Comercial", items: [{ label: "Promoções" }, { label: "Cupons" }, { label: "Avaliações" }] },
  { heading: "Sistema", items: [{ label: "Relatórios" }, { label: "Auditoria" }, { label: "Backup" }, { label: "Configurações" }] },
];

function money(cents: number) {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(cents / 100);
}
function dateTime(value: string) {
  return new Date(value).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });
}
function addressLines(address: NonNullable<Order["shippingAddress"]>) {
  const lineOne = [[address.street, address.number].filter(Boolean).join(", "), address.complement].filter(Boolean).join(" • ");
  const lineTwo = [address.neighborhood, [address.city, address.state].filter(Boolean).join(" - ")].filter(Boolean).join(" • ");
  return [lineOne, lineTwo, `CEP ${address.zipCode}`];
}

export default function AdminOrdersVisualPreview() {
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<Status | "">("");
  const [quickFilter, setQuickFilter] = useState<Filter>("all");
  const [selected, setSelected] = useState<Order | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const listRef = useRef<HTMLElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLElement | null>(null);
  const dialogRef = useRef<HTMLElement | null>(null);
  const rowRefs = useRef<Record<number, HTMLButtonElement | null>>({});
  const statusIndicatorRefs = useRef<Partial<Record<Status, HTMLButtonElement | null>>>({});
  const mobile = useIsMobile(900);

  const loadedOrders = useMemo(() => orders.filter(order => !statusFilter || order.status === statusFilter), [statusFilter]);
  const searched = useMemo(() => loadedOrders.filter(order => {
    const needle = search.trim().toLocaleLowerCase("pt-BR");
    if (!needle) return true;
    return [String(order.id), order.customerName, order.customerEmail, order.trackingCode, String(order.userId)]
      .some(value => String(value ?? "").toLocaleLowerCase("pt-BR").includes(needle));
  }), [loadedOrders, search]);
  const visibleOrders = useMemo(() => searched.filter(order => {
    if (quickFilter === "all") return true;
    if (quickFilter === "withoutTracking") return ["paid", "processing", "shipped"].includes(order.status) && !order.trackingCode;
    return order.status === quickFilter;
  }), [quickFilter, searched]);
  const summary = useMemo(() => ({
    total: loadedOrders.length,
    pending: loadedOrders.filter(order => order.status === "pending").length,
    paid: loadedOrders.filter(order => order.status === "paid").length,
    processing: loadedOrders.filter(order => order.status === "processing").length,
    shipped: loadedOrders.filter(order => order.status === "shipped").length,
    delivered: loadedOrders.filter(order => order.status === "delivered").length,
    cancelled: loadedOrders.filter(order => order.status === "cancelled").length,
    withoutTracking: loadedOrders.filter(order => ["paid", "processing", "shipped"].includes(order.status) && !order.trackingCode).length,
    revenueCents: loadedOrders.reduce((sum, order) => sum + order.totalPrice, 0),
  }), [loadedOrders]);

  useEffect(() => {
    if (!selected) return;
    const oldOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    dialogRef.current?.querySelector<HTMLButtonElement>("[data-dialog-close]")?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setSelected(null);
        (rowRefs.current[selected.id] ?? statusIndicatorRefs.current[selected.status])?.focus();
      }
      if (event.key === "Tab" && dialogRef.current) {
        const focusables = Array.from(dialogRef.current.querySelectorAll<HTMLElement>("button:not(:disabled), input:not(:disabled), select:not(:disabled), a[href]"));
        if (event.shiftKey && document.activeElement === focusables[0]) { event.preventDefault(); focusables.at(-1)?.focus(); }
        else if (!event.shiftKey && document.activeElement === focusables.at(-1)) { event.preventDefault(); focusables[0]?.focus(); }
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => { document.body.style.overflow = oldOverflow; document.removeEventListener("keydown", onKeyDown); };
  }, [selected]);

  useEffect(() => {
    if (!menuOpen || !mobile) return;
    const oldOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    menuRef.current?.querySelector<HTMLButtonElement>("button[aria-current=page]")?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") { setMenuOpen(false); triggerRef.current?.focus(); }
      if (event.key === "Tab" && menuRef.current) {
        const focusables = Array.from(menuRef.current.querySelectorAll<HTMLElement>("button:not(:disabled)"));
        if (event.shiftKey && document.activeElement === focusables[0]) { event.preventDefault(); focusables.at(-1)?.focus(); }
        else if (!event.shiftKey && document.activeElement === focusables.at(-1)) { event.preventDefault(); focusables[0]?.focus(); }
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => { document.body.style.overflow = oldOverflow; document.removeEventListener("keydown", onKeyDown); };
  }, [menuOpen, mobile]);

  const openOrder = (order: Order) => setSelected(order);
  const activateStatusIndicator = (status: Status) => {
    const matchingOrders = loadedOrders.filter(order => order.status === status);
    if (matchingOrders.length === 0) return;
    if (matchingOrders.length === 1) {
      openOrder(matchingOrders[0]);
      return;
    }

    setQuickFilter(status);
    window.requestAnimationFrame(() => window.requestAnimationFrame(() => {
      document.getElementById("orders-list-title")?.focus({ preventScroll: true });
      listRef.current?.scrollIntoView({
        behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth",
        block: "start",
      });
    }));
  };

  return (
    <div className="l4-admin-preview l4-orders-preview">
      {menuOpen && mobile ? <button type="button" className="orders-menu-backdrop" aria-label="Fechar navegação" onClick={() => { setMenuOpen(false); triggerRef.current?.focus(); }} /> : null}
      <aside className={`orders-sidebar${menuOpen ? " is-open" : ""}`} id="orders-preview-navigation" ref={menuRef} aria-label="Navegação administrativa" inert={mobile && !menuOpen}>
        <div className="l4-admin-brand"><strong>L4CKOS</strong><span>GESTÃO</span><small>PRÉVIA VISUAL</small></div>
        <button type="button" className="orders-menu-close" onClick={() => { setMenuOpen(false); triggerRef.current?.focus(); }}>Fechar menu</button>
        <nav className="orders-nav-scroll" aria-label="Seções da gestão">{navGroups.map(group => <div className="orders-nav-group" key={group.heading}><h2>{group.heading}</h2>{group.items.map(item => item.active ? <button type="button" key={item.label} aria-current="page">{item.label}</button> : <span className="orders-nav-inactive" key={item.label}>{item.label}</span>)}</div>)}</nav>
        <AdminSidebarProfile name="Luna Administradora" email="admin.demo@example.test" preview />
      </aside>
      <main className="orders-main-column">
      <button ref={triggerRef} type="button" className="orders-mobile-menu-trigger" aria-expanded={menuOpen} aria-controls="orders-preview-navigation" onClick={() => setMenuOpen(true)}>☰ <span>Menu administrativo</span></button>
      <div className="orders-preview-banner">
        <span><strong>L4CKOS / GESTÃO</strong><span className="orders-preview-divider">/</span> Prévia de Pedidos</span>
        <span className="orders-preview-fake-label">AMBIENTE LOCAL · DADOS FICTÍCIOS</span>
      </div>
      <div className="orders-preview-heading">
        <div>
          <p className="orders-preview-eyebrow">Operação</p>
          <h1>Pedidos</h1>
        </div>
        <a href="/__admin-visual-preview" className="orders-preview-back">Voltar ao Dashboard da prévia</a>
      </div>

      <section className="orders-summary" aria-label="Indicadores prioritários">
        <Summary label="Pedidos carregados" value={summary.total} />
        <Summary label="Aguardando pagamento" value={summary.pending} tone="warning" />
        <Summary label="Sem rastreio" value={summary.withoutTracking} tone="warning" />
      </section>
      <div className="orders-summary-secondary" role="group" aria-label="Indicadores por status e faturamento">
        <button ref={node => { statusIndicatorRefs.current.paid = node; }} type="button" className="orders-mini-status orders-mini-status--paid" aria-label={`Pagos: ${summary.paid} ${summary.paid === 1 ? "pedido" : "pedidos"}`} aria-controls="orders-list-section" disabled={summary.paid === 0} onClick={() => activateStatusIndicator("paid")}><strong>{summary.paid}</strong><span>Pagos</span></button>
        <button ref={node => { statusIndicatorRefs.current.processing = node; }} type="button" className="orders-mini-status orders-mini-status--processing" aria-label={`Em separação: ${summary.processing} ${summary.processing === 1 ? "pedido" : "pedidos"}`} aria-controls="orders-list-section" disabled={summary.processing === 0} onClick={() => activateStatusIndicator("processing")}><strong>{summary.processing}</strong><span>Em separação</span></button>
        <button ref={node => { statusIndicatorRefs.current.shipped = node; }} type="button" className="orders-mini-status orders-mini-status--shipped" aria-label={`Enviados: ${summary.shipped} ${summary.shipped === 1 ? "pedido" : "pedidos"}`} aria-controls="orders-list-section" disabled={summary.shipped === 0} onClick={() => activateStatusIndicator("shipped")}><strong>{summary.shipped}</strong><span>Enviados</span></button>
        <button ref={node => { statusIndicatorRefs.current.delivered = node; }} type="button" className="orders-mini-status orders-mini-status--delivered" aria-label={`Entregues: ${summary.delivered} ${summary.delivered === 1 ? "pedido" : "pedidos"}`} aria-controls="orders-list-section" disabled={summary.delivered === 0} onClick={() => activateStatusIndicator("delivered")}><strong>{summary.delivered}</strong><span>Entregues</span></button>
        <button ref={node => { statusIndicatorRefs.current.cancelled = node; }} type="button" className="orders-mini-status orders-mini-status--cancelled" aria-label={`Cancelados: ${summary.cancelled} ${summary.cancelled === 1 ? "pedido" : "pedidos"}`} aria-controls="orders-list-section" disabled={summary.cancelled === 0} onClick={() => activateStatusIndicator("cancelled")}><strong>{summary.cancelled}</strong><span>Cancelados</span></button>
        <div className="orders-mini-status orders-mini-status--revenue"><strong>{money(summary.revenueCents)}</strong><span>Faturamento carregado</span></div>
      </div>

      <section ref={listRef} id="orders-list-section" className="orders-list-section" aria-labelledby="orders-list-title">
        <div className="orders-section-heading orders-list-heading"><div><h2 id="orders-list-title" tabIndex={-1}>Lista de pedidos</h2><p>Selecione uma linha para abrir os detalhes do pedido.</p></div><span aria-live="polite">{visibleOrders.length} de {orders.length} pedidos</span></div>
        <div className="orders-controls">
          <label className="orders-search"><span className="sr-only">Buscar pedido, cliente ou rastreio</span><span aria-hidden="true">⌕</span><input id="orders-search-input" value={search} onChange={event => setSearch(event.target.value)} placeholder="Buscar pedido, cliente ou rastreio" /></label>
          <div className="orders-status-filter"><span id="orders-status-filter-label">Status</span><Select value={statusFilter || "all"} onValueChange={value => setStatusFilter(value === "all" ? "" : value as Status)}><SelectTrigger className="orders-select-trigger" aria-labelledby="orders-status-filter-label"><SelectValue placeholder="Todos os status" /></SelectTrigger><SelectContent className="orders-select-content" position="popper" align="start" sideOffset={6} collisionPadding={12}><SelectItem className="orders-select-item" value="all">Todos os status</SelectItem>{filterLabels.slice(1, 7).map(([key, label]) => <SelectItem className="orders-select-item" key={key} value={key}>{label}</SelectItem>)}</SelectContent></Select></div>
          <button type="button" className="orders-refresh" disabled title="Atualização desativada nesta prévia">Atualizar lista</button>
        </div>
        <div className="orders-filters" role="group" aria-label="Filtros rápidos de pedidos">
          {filterLabels.map(([key, label]) => <button type="button" key={key} data-filter={key} aria-pressed={quickFilter === key} onClick={() => setQuickFilter(key)}>{label}<span>{key === "all" ? searched.length : key === "withoutTracking" ? searched.filter(order => ["paid", "processing", "shipped"].includes(order.status) && !order.trackingCode).length : searched.filter(order => order.status === key).length}</span></button>)}
        </div>
        <div className="orders-table-wrap">
          <div className="orders-table-head" aria-hidden="true"><span>Pedido</span><span>Cliente</span><span>Total</span><span>Situação</span><span>Rastreio</span><span>Itens</span><span>Ação</span></div>
          {visibleOrders.length ? <div className="orders-rows" role="list" aria-label="Pedidos fictícios">
            {visibleOrders.map(order => <button ref={node => { rowRefs.current[order.id] = node; }} type="button" role="listitem" className="orders-row" key={order.id} onClick={() => openOrder(order)} aria-label={`Abrir pedido ${order.id}, ${order.customerName}, ${statusLabels[order.status]}`}>
              <span className="orders-order-number"><strong>#{order.id}</strong><small>{dateTime(order.createdAt)}</small></span>
              <span className="orders-customer"><strong>{order.customerName}</strong><small>{order.customerEmail}</small></span>
              <strong className="orders-total">{money(order.totalPrice)}</strong>
              <span className={`orders-status orders-status--${order.status}`}><i aria-hidden="true" />{statusLabels[order.status]}</span>
              <span className="orders-tracking">{order.trackingCode || ( ["paid", "processing", "shipped"].includes(order.status) ? <span className="orders-tracking-missing">Sem rastreio</span> : <span className="orders-muted">—</span>)}</span>
              <span className="orders-items"><strong>{order.items.reduce((sum, item) => sum + item.quantity, 0)} item(ns)</strong><small>{order.items[0]?.productName}</small></span>
              <span className="orders-open-affordance" aria-hidden="true">Ver detalhes</span>
            </button>)}
          </div> : <div className="orders-empty">Nenhum pedido encontrado. Ajuste a busca ou o filtro.</div>}
        </div>
      </section>

      {selected ? <>
        <button type="button" className="orders-detail-backdrop" aria-label="Fechar detalhes do pedido" onClick={() => { setSelected(null); (rowRefs.current[selected.id] ?? statusIndicatorRefs.current[selected.status])?.focus(); }} />
        <aside className="orders-detail-panel" role="dialog" aria-modal="true" aria-labelledby="orders-detail-title" ref={dialogRef} tabIndex={-1}>
          <div className="orders-detail-topbar"><span>Detalhes do pedido</span><button type="button" data-dialog-close onClick={() => { setSelected(null); (rowRefs.current[selected.id] ?? statusIndicatorRefs.current[selected.status])?.focus(); }} aria-label="Fechar detalhes">Fechar <span aria-hidden="true">×</span></button></div>
          <div className="orders-detail-scroll">
            <div className="orders-detail-heading">
              <div><span>Pedido</span><h2 id="orders-detail-title">#{selected.id}</h2></div>
              <span className={`orders-status orders-status--${selected.status}`}><i aria-hidden="true" />{statusLabels[selected.status]}</span>
            </div>
            <dl className="orders-detail-facts">
              <Fact label="Cliente" value={selected.customerName} />
              <Fact label="E-mail" value={selected.customerEmail} />
              <Fact label="Data e hora" value={dateTime(selected.createdAt)} />
              <Fact label="Valor total" value={money(selected.totalPrice)} />
              <Fact label="Quantidade de itens" value={`${selected.items.reduce((sum, item) => sum + item.quantity, 0)} item(ns)`} />
              <Fact label="ID do cliente" value={`#${selected.userId}`} />
            </dl>

            <DetailSection title="Pagamento">
              <div className={`orders-payment-state${selected.paymentStatus === "confirmed" ? " orders-payment-state--confirmed" : " orders-payment-state--pending"}`}>
                <span className={`orders-status orders-payment-badge orders-payment-badge--${selected.paymentStatus}`}><i aria-hidden="true" />{selected.paymentStatus === "confirmed" ? "Pagamento confirmado" : "Aguardando confirmação"}</span>
                {selected.paymentConfirmationSource ? <span className="orders-payment-meta">Origem: {selected.paymentConfirmationSource === "manual" ? `Confirmação manual · admin #${selected.paymentConfirmedBy ?? "não informado"}` : "Webhook validado do Asaas"}</span> : null}
                {selected.paymentConfirmedAt ? <time className="orders-payment-meta">Confirmado em {dateTime(selected.paymentConfirmedAt)}</time> : null}
                {selected.paymentStatus === "pending" ? <span className="orders-payment-meta">Use a confirmação manual somente após conferir o recebimento.</span> : null}
                {selected.paymentStatus === "pending" ? <button type="button" className="orders-detail-action" disabled>Confirmar pagamento manualmente</button> : null}
              </div>
              <p className="orders-detail-note">A situação de entrega não confirma pagamento.</p>
              <p className="orders-cancellation-notice">{CANCELLATION_NOTICE} A decisão de cancelamento também requer conferência das peças já produzidas.</p>
            </DetailSection>

            <DetailSection title="Produtos">
              <div className="orders-detail-items">
                {selected.items.length ? selected.items.map((item, index) => <article className="orders-detail-item" key={`${item.productId}-${index}`}>
                  <div className="orders-detail-thumb">
                    {item.imageUrl ? <img src={item.imageUrl} alt={item.productName} /> : <span>Imagem não disponível</span>}
                  </div>
                  <div className="orders-detail-item-info">
                    <strong>{item.productName}</strong>
                    <span>Produto #{item.productId}</span>
                    {item.variant ? <span>{item.variant}</span> : null}
                    <span>Quantidade: {item.quantity}</span>
                  </div>
                  <dl className="orders-detail-item-prices">
                    {item.unitPriceCents !== undefined ? <div><dt>Unitário</dt><dd>{money(item.unitPriceCents)}</dd></div> : null}
                    {item.subtotalCents !== undefined ? <div><dt>Subtotal</dt><dd>{money(item.subtotalCents)}</dd></div> : null}
                    {item.unitPriceCents === undefined && item.subtotalCents === undefined ? <div><dt>Valores</dt><dd>Não disponíveis</dd></div> : null}
                  </dl>
                </article>) : <p className="orders-detail-note">Este pedido ainda não possui itens detalhados na reserva.</p>}
              </div>
            </DetailSection>

            <DetailSection title="Entrega">
              <div className="orders-delivery-summary"><span>Andamento da entrega</span><span className={`orders-status orders-status--${selected.status}`}><i aria-hidden="true" />{deliveryLabels[selected.status]}</span></div>
              {selected.shippingAddress ? <div className="orders-address"><div><strong>{selected.shippingAddress.recipient}</strong><span>{selected.shippingAddress.source === "profile" ? "Endereço padrão atual do cliente" : "Endereço salvo no pedido"}</span></div>{addressLines(selected.shippingAddress).map(line => <span key={line}>{line}</span>)}</div> : <p className="orders-detail-note">Nenhum endereço de entrega disponível para este pedido.</p>}
            </DetailSection>

            <DetailSection title="Rastreamento">
              {selected.trackingCode ? <p className="orders-tracking-code">{selected.trackingCode}</p> : <p className="orders-detail-note">Não há código de rastreio informado para este pedido.</p>}
              {!selected.trackingCode && ["paid", "processing", "shipped"].includes(selected.status) ? <span className="orders-tracking-missing">Sem rastreio · requer conferência</span> : null}
              <div className="orders-disabled-action"><input aria-label="Código de rastreio" placeholder="Código de rastreio" disabled value={selected.trackingCode ?? ""} /><button type="button" className="orders-detail-action" disabled>Salvar rastreio</button></div>
            </DetailSection>

            <DetailSection title="Ações">
              <label className="orders-action-label" htmlFor="orders-status-action">Atualização de status</label>
              <Select value={selected.status} disabled onValueChange={() => undefined}>
                <SelectTrigger id="orders-status-action" className="orders-select-trigger" aria-label="Status do pedido"><SelectValue /></SelectTrigger>
                <SelectContent className="orders-select-content" position="popper" align="start" sideOffset={6} collisionPadding={12}>
                  {filterLabels.slice(1, 7).map(([key, label]) => <SelectItem className="orders-select-item" key={key} value={key}>{label}</SelectItem>)}
                </SelectContent>
              </Select>
              <button type="button" className="orders-detail-action" disabled>Atualizar status</button>
              <p className="orders-preview-disabled-note">Ações operacionais estão desativadas nesta prévia de dados fictícios.</p>
            </DetailSection>
          </div>
        </aside>
      </> : null}
      </main>
    </div>
  );
}

function Summary({ label, value, tone = "" }: { label: string; value: string | number; tone?: string }) {
  return <div className={`orders-summary-item ${tone ? `orders-summary-item--${tone}` : ""}`}><span>{label}</span><strong>{value}</strong></div>;
}
function Fact({ label, value }: { label: string; value: string }) {
  return <div><dt>{label}</dt><dd>{value}</dd></div>;
}
function DetailSection({ title, children }: { title: string; children: ReactNode }) {
  return <section className="orders-detail-section"><h3>{title}</h3>{children}</section>;
}
