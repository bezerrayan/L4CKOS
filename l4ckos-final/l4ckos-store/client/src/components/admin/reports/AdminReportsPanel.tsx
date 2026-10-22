import { useMemo, useState } from "react";
import { addDays, addMonths, format, startOfMonth, subMonths } from "date-fns";
import { ptBR } from "date-fns/locale";
import { CalendarDays, ChevronLeft, ChevronRight, Download, FileText, RefreshCw } from "lucide-react";
import { Calendar } from "../../ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "../../ui/popover";
import { trpc } from "../../../lib/trpc";
import type { AdminSalesReportData } from "../../../../../shared/reports";
import "./AdminReportsPanel.css";

type Props = { enabled: boolean; onMessage: (message: string, isError?: boolean) => void; mockData?: AdminSalesReportData };
type Period = "today" | "7days" | "30days" | "custom";
const money = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
const dateTime = new Intl.DateTimeFormat("pt-BR", { timeZone: "UTC", dateStyle: "short", timeStyle: "short" });
const statusNames: Record<string, string> = {
  pending: "Pendente", processing: "Em preparação", paid: "Pago", shipped: "Enviado", delivered: "Entregue", cancelled: "Cancelado",
};
const paymentStatusName: Record<string, string> = { confirmed: "Confirmado", unconfirmed: "Não confirmado" };
const dateValue = (date: Date) => date.toISOString().slice(0, 10);
const startIso = (date: string) => `${date}T00:00:00.000Z`;
const endIso = (date: string) => `${date}T23:59:59.999Z`;
function initialRange() {
  const today = new Date();
  const start = addDays(new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate())), -6);
  return { from: dateValue(start), to: dateValue(today) };
}
function downloadBlob(name: string, type: string, value: BlobPart) {
  const blob = new Blob([value], { type });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = name;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function DatePicker({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  const selected = new Date(`${value}T12:00:00.000Z`);
  const [open, setOpen] = useState(false);
  const [month, setMonth] = useState(() => startOfMonth(selected));
  return <div className="admin-report-date">
    <span>{label}</span>
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild><button type="button" className="admin-report-date-trigger" aria-haspopup="dialog" aria-expanded={open}><span>{format(selected, "dd/MM/yyyy")}</span><CalendarDays size={17} aria-hidden="true" /></button></PopoverTrigger>
      <PopoverContent className="admin-report-calendar" align="start" side="bottom" sideOffset={6} collisionPadding={12} aria-label={`Calendário: ${label}`}>
        <div className="admin-report-calendar-heading">
          <button type="button" aria-label="Mês anterior" onClick={() => setMonth(value => subMonths(value, 1))}><ChevronLeft size={17} /></button>
          <strong>{format(month, "LLLL yyyy", { locale: ptBR })}</strong>
          <button type="button" aria-label="Próximo mês" onClick={() => setMonth(value => addMonths(value, 1))}><ChevronRight size={17} /></button>
        </div>
        <Calendar mode="single" locale={ptBR} selected={selected} month={month} onMonthChange={setMonth} onSelect={day => {
          if (!day) return;
          onChange(dateValue(day));
          setOpen(false);
        }} className="admin-report-calendar-days" aria-label={`Dias do mês para ${label}`} />
        <small>Datas interpretadas em UTC.</small>
      </PopoverContent>
    </Popover>
  </div>;
}

export function AdminReportsPanel({ enabled, onMessage, mockData }: Props) {
  const [range, setRange] = useState(initialRange);
  const [period, setPeriod] = useState<Period>("7days");
  const [detailMode, setDetailMode] = useState<"orders" | "products">("orders");
  const [exporting, setExporting] = useState<"csv" | "pdf" | null>(null);
  const utils = trpc.useUtils();
  const pdfMutation = trpc.admin.reportsSalesPdf.useMutation();
  const validRange = Boolean(range.from && range.to && range.from <= range.to);
  const queryInput = useMemo(() => validRange ? ({ from: startIso(range.from), to: endIso(range.to) }) : undefined, [range, validRange]);
  const reportQuery = trpc.admin.reportsSummary.useQuery(queryInput ?? { from: startIso(range.from), to: endIso(range.to) }, {
    enabled: enabled && validRange,
    refetchOnWindowFocus: false,
  });

  const choosePeriod = (next: Exclude<Period, "custom">) => {
    const today = new Date();
    const end = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()));
    const offset = next === "today" ? 0 : next === "7days" ? 6 : 29;
    setRange({ from: dateValue(addDays(end, -offset)), to: dateValue(end) });
    setPeriod(next);
  };
  const data = validRange ? mockData ?? reportQuery.data : undefined;
  const maxDaily = Math.max(1, ...(data?.daily.map(row => row.totalCents) ?? []));

  async function exportReport(format: "csv" | "pdf") {
    if (!queryInput || exporting) return;
    setExporting(format);
    try {
      if (format === "csv") {
        const result = await utils.admin.reportsSalesCsv.fetch(queryInput);
        downloadBlob(result.fileName, "text/csv;charset=utf-8", `\uFEFF${result.csv}`);
      } else {
        const result = await pdfMutation.mutateAsync(queryInput);
        const binary = atob(result.pdfBase64);
        const bytes = Uint8Array.from(binary, character => character.charCodeAt(0));
        downloadBlob(result.fileName, "application/pdf", bytes);
      }
      onMessage(`${format.toUpperCase()} exportado.`);
    } catch (error) {
      onMessage(error instanceof Error ? error.message : `Falha ao exportar ${format.toUpperCase()}.`, true);
    } finally {
      setExporting(null);
    }
  }

  return <div className="admin-reports">
    <header className="admin-reports-heading"><div><span>SISTEMA · ANÁLISE OPERACIONAL</span><h2>Relatórios</h2><p>Pedidos agrupados pela data de criação. Todos os valores estão em UTC.</p></div><button type="button" onClick={() => void reportQuery.refetch()} disabled={Boolean(mockData) || !enabled || !validRange || reportQuery.isFetching}><RefreshCw size={16} /> Atualizar</button></header>
    <section className="admin-reports-period" aria-label="Período do relatório">
      <div className="admin-reports-period-top"><div><h3>Resumo do período</h3><p>{range.from && range.to ? `${range.from.split("-").reverse().join("/")} — ${range.to.split("-").reverse().join("/")} (UTC)` : "Selecione o período"}</p></div>
        <div className="admin-reports-presets" role="group" aria-label="Períodos rápidos">
          {([ ["today", "Hoje"], ["7days", "7 dias"], ["30days", "30 dias"] ] as const).map(([value, label]) => <button type="button" key={value} aria-pressed={period === value} onClick={() => choosePeriod(value)}>{label}</button>)}
          <button type="button" aria-pressed={period === "custom"} onClick={() => setPeriod("custom")}>Personalizado</button>
        </div>
      </div>
      {period === "custom" ? <div className="admin-reports-date-range"><DatePicker label="De" value={range.from} onChange={from => setRange(current => ({ ...current, from }))} /><span>até</span><DatePicker label="Até" value={range.to} onChange={to => setRange(current => ({ ...current, to }))} /></div> : null}
      {!validRange ? <p className="admin-reports-error" role="alert">A data inicial deve ser anterior ou igual à data final.</p> : null}
    </section>

    {!mockData && reportQuery.isLoading ? <div className="admin-reports-state" role="status">Carregando dados do período…</div> : null}
    {!mockData && reportQuery.isError ? <div className="admin-reports-state is-error" role="alert"><span>{reportQuery.error.message}</span><button type="button" onClick={() => void reportQuery.refetch()}>Tentar novamente</button></div> : null}
    {data && (mockData || !reportQuery.isLoading) ? <>
      <section className="admin-reports-kpis" aria-label="Indicadores do período">
        <div><span>Pedidos criados</span><strong>{data.ordersCount}</strong></div>
        <div><span>Valor total dos pedidos</span><strong>{money.format(data.ordersTotalCents / 100)}</strong><small>Todos os estados; inclui valores pendentes e cancelados.</small></div>
        <div><span>Pedidos com pagamento confirmado</span><strong>{data.confirmedPaymentsCount}</strong><small>{money.format(data.confirmedPaymentsCents / 100)} · pedidos criados neste período</small></div>
        <div><span>Pedidos cancelados</span><strong>{data.statuses.find(row => row.status === "cancelled")?.count ?? 0}</strong></div>
      </section>

      <div className="admin-reports-columns">
        <section className="admin-reports-section" aria-labelledby="admin-report-evolution"><div className="admin-reports-section-title"><div><h3 id="admin-report-evolution">Evolução diária</h3><p>Valor total dos pedidos pela data de criação (UTC).</p></div></div>
          {data.daily.length >= 2 ? <div className="admin-reports-chart" role="img" aria-label={`Gráfico de ${data.daily.length} dias. Total dos pedidos criados no período.`}>{data.daily.map(row => <div className="admin-reports-chart-day" key={row.day} title={`${row.day}: ${money.format(row.totalCents / 100)} · ${row.ordersCount} pedidos`}><div><i style={{ height: `${Math.max(row.totalCents > 0 ? 3 : 0, (row.totalCents / maxDaily) * 100)}%` }} /></div><span>{row.day.slice(5).replace("-", "/")}</span></div>)}</div> : <p className="admin-reports-empty">São necessários pedidos em pelo menos dois dias para exibir a evolução.</p>}
        </section>
        <section className="admin-reports-section" aria-labelledby="admin-report-status"><div className="admin-reports-section-title"><div><h3 id="admin-report-status">Situação dos pedidos</h3><p>Contagem e total por status operacional.</p></div></div>
          <ul className="admin-reports-status">{data.statuses.map(row => <li key={row.status}><span>{statusNames[row.status] ?? row.status}</span><strong>{row.count}</strong><small>{money.format(row.totalCents / 100)}</small></li>)}{!data.statuses.length ? <li className="is-empty">Nenhum pedido neste período.</li> : null}</ul>
        </section>
      </div>

      <section className="admin-reports-section admin-reports-orders" aria-labelledby="admin-report-orders"><div className="admin-reports-section-title"><div><h3 id="admin-report-orders">Detalhamento</h3><p>{detailMode === "orders" ? "Pedidos mais recentes do período, sem dados pessoais." : "Unidades registradas nas linhas de pedidos, incluindo cancelamentos."}</p></div><div className="admin-reports-detail-switch" role="group" aria-label="Detalhamento por pedidos ou produtos"><button type="button" aria-pressed={detailMode === "orders"} onClick={() => setDetailMode("orders")}>Pedidos</button><button type="button" aria-pressed={detailMode === "products"} onClick={() => setDetailMode("products")}>Produtos</button></div></div>
        {detailMode === "orders" ? <><p className="admin-reports-table-note">Tabela limitada aos 100 mais recentes; os indicadores abrangem todos os {data.ordersCount} pedidos do período.</p><div className="admin-reports-table-scroll"><table><thead><tr><th>Pedido</th><th>Criado (UTC)</th><th>Situação</th><th>Pagamento</th><th>Valor</th></tr></thead><tbody>{data.orders.map(order => <tr key={order.id}><td>#{order.id}</td><td>{dateTime.format(new Date(order.createdAt))}</td><td>{statusNames[order.status] ?? order.status}</td><td>{paymentStatusName[order.paymentStatus] ?? "Não disponível"}</td><td>{money.format(order.totalPriceCents / 100)}</td></tr>)}{!data.ordersCount ? <tr><td colSpan={5}>Nenhum pedido no período selecionado.</td></tr> : null}</tbody></table></div></> : <div className="admin-reports-table-scroll"><table><thead><tr><th>Produto</th><th>Unidades em pedidos</th><th>Em pedidos cancelados</th></tr></thead><tbody>{data.products.map(product => <tr key={product.productId}><td>{product.productName}</td><td>{product.unitsInOrders}</td><td>{product.unitsInCancelledOrders}</td></tr>)}{!data.products.length ? <tr><td colSpan={3}>Nenhum item registrado no período.</td></tr> : null}</tbody></table></div>}
      </section>

      <section className="admin-reports-exports" aria-labelledby="admin-report-exports"><div className="admin-reports-section-title"><div><h3 id="admin-report-exports">Exportação disponível</h3><p>Mesmo período e critérios do resumo. CSV detalha pedidos; PDF é agregado e não inclui dados pessoais.</p></div></div>
        <div className="admin-reports-export-row"><div><strong>CSV</strong><span>Exportação detalhada existente, incluindo nome, e-mail e rastreio. Compartilhe somente em canais autorizados.</span></div><button type="button" disabled={Boolean(mockData) || Boolean(exporting) || !validRange} onClick={() => void exportReport("csv")}><Download size={16} />{mockData ? "Desativado na prévia" : exporting === "csv" ? "Gerando CSV…" : "Exportar CSV"}</button></div>
        <div className="admin-reports-export-row"><div><strong>PDF A4</strong><span>Resumo para leitura e arquivamento; inclui totais, situação, evolução e tabela sem nome, e-mail, telefone ou endereço.</span></div><button type="button" disabled={Boolean(mockData) || Boolean(exporting) || !validRange} onClick={() => void exportReport("pdf")}><FileText size={16} />{mockData ? "Desativado na prévia" : exporting === "pdf" ? "Gerando PDF…" : "Exportar PDF"}</button></div>
        <p>O total dos pedidos inclui todos os estados. O indicador financeiro considera pedidos criados no período com paymentStatus=confirmed; não representa receita líquida ou recebimentos menos reembolsos.</p>
      </section>
    </> : null}
  </div>;
}
