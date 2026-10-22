import { useEffect, useMemo, useRef, useState } from "react";
import { addMonths, format, startOfDay, subMonths } from "date-fns";
import { ptBR } from "date-fns/locale";
import { CalendarDays, ChevronLeft, ChevronRight, Download, FileText, Menu } from "lucide-react";
import { useIsMobile } from "../hooks/useIsMobile";
import { AdminSidebarProfile } from "../components/admin/AdminSidebarProfile";
import { Calendar } from "../components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "../components/ui/popover";
import "../components/admin/AdminOrdersVisualPreview.css";
import "../components/admin/AdminReportsVisualPreview.css";

type OrderStatus = "pending" | "processing" | "paid" | "shipped" | "delivered" | "cancelled";
type Period = "today" | "7days" | "30days" | "custom";
type ReportOrder = {
  id: number;
  createdAt: string;
  status: OrderStatus;
  totalPriceCents: number;
  customerName: string;
  customerEmail: string;
  trackingCode: string | null;
  items: Array<{ productName: string; quantity: number }>;
};

const navigation = [
  { group: "Visão geral", items: ["Dashboard / KPIs"] },
  { group: "Operação", items: ["Pedidos", "Produtos", "Clientes", "Lotes / Pré-venda"] },
  { group: "Comercial", items: ["Promoções", "Cupons", "Avaliações"] },
  { group: "Sistema", items: ["Relatórios", "Auditoria", "Backup", "Configurações"] },
];

const statusLabels: Record<OrderStatus, string> = {
  pending: "Pendente", processing: "Em preparação", paid: "Pago", shipped: "Enviado", delivered: "Entregue", cancelled: "Cancelado",
};
const statusOrder: OrderStatus[] = ["pending", "processing", "paid", "shipped", "delivered", "cancelled"];
const priceFormat = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
const dateTimeFormat = new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short" });

function localIso(date: Date) { return new Date(date).toISOString(); }
function presetRange(period: Exclude<Period, "custom">) {
  const to = new Date();
  const from = startOfDay(new Date(to));
  if (period === "7days") from.setDate(from.getDate() - 6);
  if (period === "30days") from.setDate(from.getDate() - 29);
  return { from: localIso(from), to: localIso(to) };
}
function daysAgo(days: number, hour: number) {
  const date = new Date();
  date.setDate(date.getDate() - days);
  date.setHours(hour, (days * 13) % 60, 0, 0);
  return date.toISOString();
}

// Fixtures fictícias. Os nomes e quantidades dos itens correspondem ao formato do CSV; totalPrice é o total do pedido.
const fixtures: ReportOrder[] = [
  { id: 4826, createdAt: daysAgo(0, 10), status: "paid", totalPriceCents: 15990, customerName: "Marina Costa", customerEmail: "marina.costa@example.test", trackingCode: null, items: [{ productName: "Camiseta Clã 14 Bis", quantity: 1 }, { productName: "Camiseta Horizonte", quantity: 1 }] },
  { id: 4825, createdAt: daysAgo(0, 8), status: "pending", totalPriceCents: 8990, customerName: "Rafael Nogueira", customerEmail: "rafael.nogueira@example.test", trackingCode: null, items: [{ productName: "Camiseta Ritmo Noturno", quantity: 1 }] },
  { id: 4824, createdAt: daysAgo(1, 16), status: "delivered", totalPriceCents: 21980, customerName: "Camila Freire", customerEmail: "camila.freire@example.test", trackingCode: "BR123456789LX", items: [{ productName: "Camiseta Clã 14 Bis", quantity: 2 }] },
  { id: 4823, createdAt: daysAgo(1, 13), status: "cancelled", totalPriceCents: 10990, customerName: "Bruno Almeida", customerEmail: "bruno.almeida@example.test", trackingCode: null, items: [{ productName: "Camiseta Horizonte", quantity: 1 }] },
  { id: 4822, createdAt: daysAgo(2, 11), status: "processing", totalPriceCents: 17980, customerName: "Joana Martins", customerEmail: "joana.martins@example.test", trackingCode: null, items: [{ productName: "Camiseta Linha de Frente", quantity: 1 }, { productName: "Camiseta Ritmo Noturno", quantity: 1 }] },
  { id: 4821, createdAt: daysAgo(3, 14), status: "shipped", totalPriceCents: 12990, customerName: "Pedro Ribeiro", customerEmail: "pedro.ribeiro@example.test", trackingCode: "BR987654321LX", items: [{ productName: "Camiseta Clã 14 Bis", quantity: 1 }] },
  { id: 4820, createdAt: daysAgo(4, 9), status: "paid", totalPriceCents: 26970, customerName: "Lívia Santos", customerEmail: "livia.santos@example.test", trackingCode: null, items: [{ productName: "Camiseta Clã 14 Bis", quantity: 2 }, { productName: "Camiseta Horizonte", quantity: 1 }] },
  { id: 4819, createdAt: daysAgo(5, 18), status: "pending", totalPriceCents: 9990, customerName: "Diego Rocha", customerEmail: "diego.rocha@example.test", trackingCode: null, items: [{ productName: "Camiseta Ritmo Noturno", quantity: 1 }] },
  { id: 4818, createdAt: daysAgo(6, 12), status: "delivered", totalPriceCents: 32970, customerName: "Ana Martins", customerEmail: "ana.martins@example.test", trackingCode: "BR111222333LX", items: [{ productName: "Camiseta Linha de Frente", quantity: 2 }, { productName: "Camiseta Clã 14 Bis", quantity: 1 }] },
  { id: 4817, createdAt: daysAgo(8, 15), status: "cancelled", totalPriceCents: 8990, customerName: "Igor Lima", customerEmail: "igor.lima@example.test", trackingCode: null, items: [{ productName: "Camiseta Ritmo Noturno", quantity: 1 }] },
  { id: 4816, createdAt: daysAgo(10, 17), status: "processing", totalPriceCents: 21980, customerName: "Bia Carvalho", customerEmail: "bia.carvalho@example.test", trackingCode: null, items: [{ productName: "Camiseta Horizonte", quantity: 2 }] },
  { id: 4815, createdAt: daysAgo(12, 11), status: "shipped", totalPriceCents: 14990, customerName: "Caio Mendes", customerEmail: "caio.mendes@example.test", trackingCode: "BR444555666LX", items: [{ productName: "Camiseta Clã 14 Bis", quantity: 1 }] },
  { id: 4814, createdAt: daysAgo(16, 9), status: "paid", totalPriceCents: 29980, customerName: "Nina Oliveira", customerEmail: "nina.oliveira@example.test", trackingCode: null, items: [{ productName: "Camiseta Linha de Frente", quantity: 2 }] },
  { id: 4813, createdAt: daysAgo(22, 13), status: "delivered", totalPriceCents: 18980, customerName: "Theo Souza", customerEmail: "theo.souza@example.test", trackingCode: "BR777888999LX", items: [{ productName: "Camiseta Ritmo Noturno", quantity: 2 }] },
  { id: 4812, createdAt: daysAgo(28, 16), status: "cancelled", totalPriceCents: 11990, customerName: "Lara Dias", customerEmail: "lara.dias@example.test", trackingCode: null, items: [{ productName: "Camiseta Horizonte", quantity: 1 }] },
];

function ReportDateField({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  const current = new Date(value);
  const [open, setOpen] = useState(false);
  const [month, setMonth] = useState(() => current);
  const [time, setTime] = useState(() => format(current, "HH:mm"));
  useEffect(() => {
    const parsed = new Date(value);
    if (Number.isFinite(parsed.getTime())) { setMonth(parsed); setTime(format(parsed, "HH:mm")); }
  }, [value]);
  const parsedTime = /^([01]\d|2[0-3]):([0-5]\d)$/.test(time);
  const updateTime = (next: string) => {
    setTime(next);
    if (!parsedTime || !Number.isFinite(current.getTime()) || !/^([01]\d|2[0-3]):([0-5]\d)$/.test(next)) return;
    const [hour, minute] = next.split(":").map(Number);
    const nextDate = new Date(current); nextDate.setHours(hour, minute, 0, 0); onChange(nextDate.toISOString());
  };
  return <div className="reports-date-field">
    <span className="reports-date-label">{label} <small>horário local</small></span>
    <div className="reports-date-control">
      <span aria-live="polite">{Number.isFinite(current.getTime()) ? format(current, "dd/MM/yyyy") : "Data inválida"}</span>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild><button type="button" className="reports-calendar-trigger" aria-label={`Abrir calendário: ${label}`} aria-haspopup="dialog"><CalendarDays size={17} /></button></PopoverTrigger>
        <PopoverContent className="reports-calendar-popover" align="start" side="bottom" sideOffset={6} collisionPadding={12} aria-label={`Calendário de ${label}`}>
          <div className="reports-calendar-heading"><button type="button" aria-label="Mês anterior" onClick={() => setMonth(value => subMonths(value, 1))}><ChevronLeft size={17} /></button><strong>{format(month, "LLLL yyyy", { locale: ptBR })}</strong><button type="button" aria-label="Próximo mês" onClick={() => setMonth(value => addMonths(value, 1))}><ChevronRight size={17} /></button></div>
          <Calendar mode="single" locale={ptBR} selected={current} month={month} onMonthChange={setMonth} onSelect={day => {
            if (!day) return;
            const [hour, minute] = time.split(":").map(Number);
            const nextDate = new Date(day); nextDate.setHours(hour || 0, minute || 0, 0, 0); onChange(nextDate.toISOString()); setOpen(false);
          }} className="reports-calendar" aria-label={`Dias do mês para ${label}`} />
          <p className="reports-calendar-hint">A data selecionada usa o horário local do navegador; o envio real converte para ISO.</p>
        </PopoverContent>
      </Popover>
    </div>
    <label className="reports-time-field"><span>Horário</span><input type="text" inputMode="numeric" value={time} aria-label={`${label}, horário local`} aria-invalid={!parsedTime} placeholder="HH:mm" onChange={event => updateTime(event.target.value)} onBlur={() => { if (!/^([01]\d|2[0-3]):([0-5]\d)$/.test(time)) setTime(format(current, "HH:mm")); }} /></label>
  </div>;
}

function MoneyChart({ rows, metric }: { rows: Array<{ day: string; ordersCount: number; totalSales: number }>; metric: "sales" | "orders" }) {
  const values = rows.map(row => metric === "sales" ? row.totalSales : row.ordersCount);
  const max = Math.max(1, ...values);
  const mid = max / 2;
  const axis = metric === "sales" ? [max, mid, 0].map(value => priceFormat.format(value / 100)) : [max, mid, 0].map(value => String(Math.round(value)));
  const labelEvery = Math.max(1, Math.ceil(rows.length / 7));
  return <div className="reports-chart" aria-label={metric === "sales" ? "Evolução diária do valor total dos pedidos" : "Evolução diária da quantidade de pedidos"}>
    <div className="reports-chart-y-axis" aria-hidden="true">{axis.map((label, index) => <span key={`${label}-${index}`}>{label}</span>)}</div>
    <div className="reports-chart-body">
      {rows.length ? <>
        <div className="reports-chart-grid" aria-hidden="true"><i /><i /><i /></div>
        <div className="reports-chart-bars">
          {rows.map((row, index) => {
            const value = values[index];
            const height = Math.max(value ? 4 : 0, value / max * 100);
            const dayLabel = format(new Date(`${row.day}T12:00:00`), "dd/MM");
            const detail = metric === "sales" ? priceFormat.format(value / 100) : `${value} ${value === 1 ? "pedido" : "pedidos"}`;
            return <button key={row.day} type="button" className="reports-chart-bar" style={{ "--bar-height": `${height}%` } as React.CSSProperties} aria-label={`${dayLabel}: ${detail}`}>
              <span className="reports-chart-fill" /><span className="reports-chart-tooltip" aria-hidden="true"><strong>{dayLabel}</strong>{detail}</span>
            </button>;
          })}
        </div>
        <div className="reports-chart-x-axis" aria-hidden="true">{rows.map((row, index) => <span key={row.day}>{index % labelEvery === 0 || index === rows.length - 1 ? format(new Date(`${row.day}T12:00:00`), "dd/MM") : ""}</span>)}</div>
      </> : <p className="reports-chart-empty">Sem pedidos fictícios neste período.</p>}
    </div>
  </div>;
}

export default function AdminReportsVisualPreview() {
  const initial = useMemo(() => presetRange("7days"), []);
  const [period, setPeriod] = useState<Period>("7days");
  const [from, setFrom] = useState(initial.from);
  const [to, setTo] = useState(initial.to);
  const [metric, setMetric] = useState<"sales" | "orders">("sales");
  const [detailTab, setDetailTab] = useState<"orders" | "products">("orders");
  const [menuOpen, setMenuOpen] = useState(false);
  const mobile = useIsMobile(900);
  const menuRef = useRef<HTMLElement>(null);
  const menuTriggerRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!menuOpen || !mobile) return;
    const oldOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    menuRef.current?.querySelector<HTMLElement>("[aria-current=page]")?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") { setMenuOpen(false); menuTriggerRef.current?.focus(); }
      if (event.key === "Tab" && menuRef.current) {
        const items = Array.from(menuRef.current.querySelectorAll<HTMLElement>("button:not(:disabled)"));
        if (event.shiftKey && document.activeElement === items[0]) { event.preventDefault(); items.at(-1)?.focus(); }
        else if (!event.shiftKey && document.activeElement === items.at(-1)) { event.preventDefault(); items[0]?.focus(); }
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => { document.body.style.overflow = oldOverflow; document.removeEventListener("keydown", onKeyDown); };
  }, [menuOpen, mobile]);

  const parsedFrom = new Date(from).getTime();
  const parsedTo = new Date(to).getTime();
  const invalidRange = !Number.isFinite(parsedFrom) || !Number.isFinite(parsedTo) || parsedFrom > parsedTo;
  const filteredOrders = useMemo(() => invalidRange ? [] : fixtures.filter(order => {
    const createdAt = new Date(order.createdAt).getTime();
    return createdAt >= parsedFrom && createdAt <= parsedTo;
  }), [invalidRange, parsedFrom, parsedTo]);
  const totals = useMemo(() => ({
    count: filteredOrders.length,
    totalCents: filteredOrders.reduce((sum, order) => sum + order.totalPriceCents, 0),
  }), [filteredOrders]);
  const dailyRows = useMemo(() => {
    const grouped = new Map<string, { day: string; ordersCount: number; totalSales: number }>();
    filteredOrders.forEach(order => {
      const day = format(new Date(order.createdAt), "yyyy-MM-dd");
      const row = grouped.get(day) ?? { day, ordersCount: 0, totalSales: 0 };
      row.ordersCount += 1;
      row.totalSales += order.totalPriceCents;
      grouped.set(day, row);
    });
    return [...grouped.values()].sort((a, b) => a.day.localeCompare(b.day));
  }, [filteredOrders]);
  const statusRows = statusOrder.map(status => ({ status, count: filteredOrders.filter(order => order.status === status).length }));
  const productRows = useMemo(() => {
    const grouped = new Map<string, { name: string; ordered: number; cancelled: number }>();
    filteredOrders.forEach(order => order.items.forEach(item => {
      const row = grouped.get(item.productName) ?? { name: item.productName, ordered: 0, cancelled: 0 };
      row.ordered += item.quantity;
      if (order.status === "cancelled") row.cancelled += item.quantity;
      grouped.set(item.productName, row);
    }));
    return [...grouped.values()].sort((a, b) => b.ordered - a.ordered || a.name.localeCompare(b.name));
  }, [filteredOrders]);

  const choosePeriod = (next: Exclude<Period, "custom">) => {
    const range = presetRange(next);
    setFrom(range.from); setTo(range.to); setPeriod(next);
  };
  const periodLabel = period === "today" ? "Hoje" : period === "7days" ? "Últimos 7 dias" : period === "30days" ? "Últimos 30 dias" : "Personalizado";
  const rangeLabel = invalidRange ? "Confira as datas selecionadas" : `${dateTimeFormat.format(new Date(from))} — ${dateTimeFormat.format(new Date(to))}`;

  return <div className="l4-orders-preview l4-reports-preview">
    {menuOpen && mobile ? <button className="orders-menu-backdrop" type="button" aria-label="Fechar navegação administrativa" onClick={() => { setMenuOpen(false); menuTriggerRef.current?.focus(); }} /> : null}
    <aside className={`orders-sidebar${menuOpen ? " is-open" : ""}`} id="reports-preview-navigation" ref={menuRef} aria-label="Navegação administrativa" inert={mobile && !menuOpen}>
      <div className="l4-admin-brand"><strong>L4CKOS</strong><span>GESTÃO</span><small>PRÉVIA LOCAL</small></div>
      <button type="button" className="orders-menu-close" onClick={() => { setMenuOpen(false); menuTriggerRef.current?.focus(); }}>Fechar menu</button>
      <nav className="orders-nav-scroll" aria-label="Seções da gestão">{navigation.map(group => <section className="orders-nav-group" key={group.group} aria-label={group.group}><h2>{group.group}</h2>{group.items.map(item => <button key={item} type="button" aria-current={item === "Relatórios" ? "page" : undefined} className={item === "Relatórios" ? "" : "orders-nav-inactive"} onClick={() => { if (item === "Relatórios") setMenuOpen(false); }}>{item}</button>)}</section>)}</nav>
      <AdminSidebarProfile name="Luna Administradora" email="admin.demo@example.test" preview />
    </aside>
    <main className="orders-main-column">
      <div className="orders-preview-banner"><span><strong>AMBIENTE DE DEMONSTRAÇÃO</strong><span className="orders-preview-divider">·</span>Dados fictícios</span><span className="orders-preview-fake-label">Sem consulta administrativa</span></div>
      {mobile ? <button ref={menuTriggerRef} type="button" className="orders-mobile-menu-trigger" aria-expanded={menuOpen} aria-controls="reports-preview-navigation" onClick={() => setMenuOpen(true)}><Menu size={18} /> Menu administrativo</button> : null}
      <header className="orders-preview-heading reports-heading"><div><p className="orders-preview-eyebrow">SISTEMA · EXPORTAÇÃO DE DADOS</p><h1>Relatórios</h1><p>Resumo de pedidos criados no período selecionado.</p></div></header>

      <section className="reports-period-section" aria-label="Selecionar período">
        <div className="reports-period-heading"><div><h2>Resumo do período</h2><p>{rangeLabel}</p></div><div className="reports-period-presets" role="group" aria-label="Período do relatório">
          {([ ["today", "Hoje"], ["7days", "7 dias"], ["30days", "30 dias"] ] as const).map(([key, label]) => <button key={key} type="button" aria-pressed={period === key} onClick={() => choosePeriod(key)}>{label}</button>)}
          <button type="button" aria-pressed={period === "custom"} onClick={() => setPeriod("custom")}>Personalizado</button>
        </div></div>
        {period === "custom" ? <div className="reports-custom-range"><ReportDateField label="De" value={from} onChange={setFrom} /><span className="reports-range-separator" aria-hidden="true">até</span><ReportDateField label="Até" value={to} onChange={setTo} /></div> : null}
        {invalidRange ? <p className="reports-range-error" role="alert">A data inicial precisa ser anterior à data final.</p> : null}
      </section>

      <section className="reports-summary" aria-label="Indicadores do período">
        <div><span>Pedidos criados</span><strong>{totals.count}</strong></div>
        <div><span>Valor total dos pedidos</span><strong>{priceFormat.format(totals.totalCents / 100)}</strong><small>Soma de totalPrice em todos os estados.</small></div>
        <div><span>Dias com pedidos</span><strong>{dailyRows.length}</strong></div>
      </section>

      <div className="reports-main-grid">
        <section className="reports-panel reports-evolution" aria-labelledby="reports-evolution-title">
          <div className="reports-panel-heading"><div><h2 id="reports-evolution-title">Evolução diária</h2><p>Valores agrupados pela data de criação do pedido.</p></div><div className="reports-chart-switch" role="group" aria-label="Indicador do gráfico"><button type="button" aria-pressed={metric === "sales"} onClick={() => setMetric("sales")}>Valor em pedidos</button><button type="button" aria-pressed={metric === "orders"} onClick={() => setMetric("orders")}>Quantidade</button></div></div>
          <MoneyChart rows={dailyRows} metric={metric} />
          <p className="reports-chart-note">O valor representa o total dos pedidos, sem distinção de situação de pagamento.</p>
        </section>
        <section className="reports-panel reports-status" aria-labelledby="reports-status-title">
          <div className="reports-panel-heading"><div><h2 id="reports-status-title">Situação dos pedidos</h2><p>Contagem por status do pedido.</p></div></div>
          <ul>{statusRows.map(({ status, count }) => <li key={status}><span className={`reports-status-dot is-${status}`} aria-hidden="true" /><span>{statusLabels[status]}</span><strong>{count}</strong></li>)}</ul>
        </section>
      </div>

      <section className="reports-panel reports-breakdown" aria-labelledby="reports-breakdown-title">
        <div className="reports-panel-heading"><div><h2 id="reports-breakdown-title">Detalhamento</h2><p>{detailTab === "orders" ? `${filteredOrders.length} pedidos dentro do período.` : "Unidades registradas nas linhas de itens, incluindo cancelamentos."}</p></div><div className="reports-detail-tabs" role="group" aria-label="Tipo de detalhamento">
          <button type="button" aria-pressed={detailTab === "orders"} onClick={() => setDetailTab("orders")}>Pedidos</button><button type="button" aria-pressed={detailTab === "products"} onClick={() => setDetailTab("products")}>Produtos</button>
        </div></div>
        {detailTab === "orders" ? <div className="reports-table-wrap"><table><thead><tr><th>Pedido</th><th>Data</th><th>Situação</th><th>Valor do pedido</th></tr></thead><tbody>
          {[...filteredOrders].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 8).map(order => <tr key={order.id}><td>#{order.id}</td><td>{dateTimeFormat.format(new Date(order.createdAt))}</td><td><span className={`reports-order-status is-${order.status}`}>{statusLabels[order.status]}</span></td><td>{priceFormat.format(order.totalPriceCents / 100)}</td></tr>)}
          {!filteredOrders.length ? <tr><td colSpan={4}>Nenhum pedido neste período fictício.</td></tr> : null}
        </tbody></table></div> : <div className="reports-table-wrap"><table><thead><tr><th>Produto</th><th>Unidades em pedidos</th><th>Em pedidos cancelados</th></tr></thead><tbody>
          {productRows.map(product => <tr key={product.name}><td>{product.name}</td><td>{product.ordered}</td><td>{product.cancelled}</td></tr>)}
          {!productRows.length ? <tr><td colSpan={3}>Nenhum item neste período fictício.</td></tr> : null}
        </tbody></table></div>}
      </section>

      <section className="reports-export" aria-labelledby="reports-export-title">
        <header className="reports-export-heading">
          <div><p className="orders-preview-eyebrow">EXPORTAÇÃO</p><h2 id="reports-export-title">Exportações de relatório</h2></div>
          <div className="reports-export-period"><span>Período aplicado</span><strong>{invalidRange ? "Datas inválidas" : periodLabel}</strong></div>
        </header>
        <div className="reports-export-formats">
          <article className="reports-export-format">
            <div className="reports-export-format-heading"><div><span className="reports-export-format-label">CSV</span><span className="reports-export-status is-supported">Suportado pelo backend</span></div><Download size={18} aria-hidden="true" /></div>
            <p>Resumo diário e linhas de pedidos para o mesmo período aplicado ao relatório.</p>
            <small>A exportação real inclui nome, e-mail e dados dos pedidos; requer acesso administrativo e compartilhamento restrito.</small>
            <button type="button" disabled aria-disabled="true" title="Exportação desativada nesta prévia"><Download size={16} /> Desativado nesta prévia</button>
          </article>
          <article className="reports-export-format">
            <div className="reports-export-format-heading"><div><span className="reports-export-format-label">PDF</span><span className="reports-export-status is-planned">Planejado para integração</span></div><FileText size={18} aria-hidden="true" /></div>
            <p>Documento A4 para leitura, impressão e arquivo, com logotipo L4CKOS, nome do relatório e o mesmo período e critérios aplicados na tela. Inclui pedidos criados, valor total dos pedidos em todos os estados, evolução diária, distribuição por situação e tabela resumida.</p>
            <small>Resumo sem dados pessoais por padrão. Exportações detalhadas exigem autorização, finalidade definida e tratamento seguro.</small>
            <button type="button" disabled aria-disabled="true" title="PDF planejado; geração não implementada"><FileText size={16} /> Planejado — não gera arquivo</button>
          </article>
        </div>
      </section>
      <p className="reports-preview-note">A prévia usa somente registros fictícios. Nenhum arquivo é gerado e nenhuma consulta administrativa é executada.</p>
    </main>
  </div>;
}
