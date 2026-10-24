import { useMemo, useState } from "react";
import { Download, FileText, RefreshCw } from "lucide-react";
import { trpc } from "../../../lib/trpc";
import type { AdminSalesReportData } from "../../../../../shared/reports";
import {
  addDateDays,
  addDateMonths,
  formatLocalDate,
  isValidDateKey,
  localDateKey,
  localDateRange,
  monthDateRange,
  reportComparisonDescription,
  reportComparisonRange,
  REPORT_TIME_ZONE,
} from "../../../../../shared/reportPeriods";
import "./AdminReportsPanel.css";

type Props = { enabled: boolean; onMessage: (message: string, isError?: boolean) => void; mockData?: AdminSalesReportData };
type Period = "today" | "7days" | "30days" | "thisMonth" | "previousMonth" | "custom" | "month" | "year";
const money = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
const dateTime = new Intl.DateTimeFormat("pt-BR", { timeZone: REPORT_TIME_ZONE, dateStyle: "short", timeStyle: "short" });
const statusNames: Record<string, string> = {
  pending: "Pendente", paid: "Aguardando preparação", processing: "Em separação", shipped: "Enviado", delivered: "Entregue", cancelled: "Cancelado",
};
const logisticsTone: Record<string, string> = {
  pending: "amber", paid: "violet", processing: "cyan", shipped: "indigo", delivered: "green", cancelled: "red",
};
const paymentStatusName: Record<string, string> = { confirmed: "Confirmado", unconfirmed: "Pendente" };
const todayKey = () => localDateKey(new Date());
function dateInputRange(from: string, to: string) { return localDateRange(from, to, new Date(Date.now() - 1_000)); }
function currentInitialRange() { const today = todayKey(); return { from: addDateDays(today, -6), to: today }; }
function downloadBlob(name: string, type: string, value: BlobPart) {
  const blob = new Blob([value], { type });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url; anchor.download = name; anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function comparisonDelta(current: number, previous: number, isMoney = false) {
  const delta = current - previous;
  const value = isMoney ? money.format(Math.abs(delta) / 100) : Math.abs(delta).toLocaleString("pt-BR");
  const direction = delta > 0 ? "+" : delta < 0 ? "−" : "";
  return {
    absolute: `${direction}${value}`,
    percent: previous === 0 ? "Indisponível · base anterior zero" : `${delta === 0 ? "0,0" : (delta / previous * 100).toLocaleString("pt-BR", { maximumFractionDigits: 1 })}% ${delta > 0 ? "acima" : delta < 0 ? "abaixo" : "sem variação"}`,
  };
}

export function AdminReportsPanel({ enabled, onMessage, mockData }: Props) {
  const initial = currentInitialRange();
  const [range, setRange] = useState(() => mockData ? { from: localDateKey(new Date(mockData.from)), to: localDateKey(new Date(mockData.to)) } : initial);
  const [period, setPeriod] = useState<Period>(mockData ? "custom" : "7days");
  const [selectedMonth, setSelectedMonth] = useState(() => todayKey().slice(0, 7));
  const [selectedYear, setSelectedYear] = useState(() => todayKey().slice(0, 4));
  const [exporting, setExporting] = useState<"csv" | "pdf" | null>(null);
  const utils = trpc.useUtils();
  const pdfMutation = trpc.admin.reportsSalesPdf.useMutation();
  const today = todayKey();
  const monthRange = useMemo(() => {
    const match = /^(\d{4})-(\d{2})$/.exec(selectedMonth);
    if (!match) return { from: "", to: "" };
    const [year, month] = [Number(match[1]), Number(match[2])];
    const selected = monthDateRange(year, month);
    return { from: selected.from, to: selected.to > today ? today : selected.to };
  }, [selectedMonth, today]);
  const yearRange = useMemo(() => ({ from: `${selectedYear}-01-01`, to: Number(selectedYear) === Number(today.slice(0, 4)) ? today : `${selectedYear}-12-31` }), [selectedYear, today]);
  const queryRange = period === "month" ? monthRange : period === "year" ? yearRange : range;
  const validRange = Boolean(isValidDateKey(queryRange.from) && isValidDateKey(queryRange.to) && queryRange.from <= queryRange.to && queryRange.to <= today);
  const queryInput = useMemo(() => validRange ? dateInputRange(queryRange.from, queryRange.to) : undefined, [queryRange.from, queryRange.to, validRange]);
  const comparisonDates = useMemo(() => {
    if (!validRange) return undefined;
    return reportComparisonRange({ period, from: queryRange.from, to: queryRange.to, selectedYear: Number(selectedYear), today }) ?? undefined;
  }, [period, queryRange.from, queryRange.to, selectedYear, today, validRange]);
  const comparisonInput = useMemo(() => comparisonDates ? dateInputRange(comparisonDates.from, comparisonDates.to) : undefined, [comparisonDates?.from, comparisonDates?.to]);
  const reportQuery = trpc.admin.reportsSummary.useQuery(queryInput ?? { from: new Date(0).toISOString(), to: new Date(0).toISOString() }, {
    enabled: enabled && validRange,
    refetchOnWindowFocus: false,
  });
  const comparisonQuery = trpc.admin.reportsSummary.useQuery(comparisonInput ?? { from: new Date(0).toISOString(), to: new Date(0).toISOString() }, {
    enabled: enabled && validRange && !mockData,
    refetchOnWindowFocus: false,
  });

  const choosePeriod = (next: Exclude<Period, "custom" | "month" | "year">) => {
    const end = todayKey();
    if (next === "today") setRange({ from: end, to: end });
    if (next === "7days") setRange({ from: addDateDays(end, -6), to: end });
    if (next === "30days") setRange({ from: addDateDays(end, -29), to: end });
    if (next === "thisMonth") setRange({ from: `${end.slice(0, 7)}-01`, to: end });
    if (next === "previousMonth") {
      const start = addDateMonths(`${end.slice(0, 7)}-01`, -1);
      setRange({ from: start, to: addDateDays(`${end.slice(0, 7)}-01`, -1) });
    }
    setPeriod(next);
  };

  const chooseMonthMode = () => {
    setSelectedMonth(today.slice(0, 7));
    setPeriod("month");
  };

  const chooseYearMode = () => {
    setSelectedYear(today.slice(0, 4));
    setPeriod("year");
  };

  const data = validRange ? mockData ?? reportQuery.data : undefined;
  const comparison = mockData ? undefined : comparisonQuery.data;
  const queryDayCount = Math.round((Date.parse(`${queryRange.to}T00:00:00Z`) - Date.parse(`${queryRange.from}T00:00:00Z`)) / 86_400_000) + 1;
  const chartIsMonthly = period === "year" || queryDayCount > 62;
  const chartRows = data ? (chartIsMonthly ? data.monthly : data.daily) : [];
  const chartMax = Math.max(1, ...chartRows.map(row => row.totalCents));
  const queryDateText = validRange ? `${formatLocalDate(queryRange.from)} — ${formatLocalDate(queryRange.to)} · ${REPORT_TIME_ZONE}` : "Informe datas válidas para consultar o relatório.";
  const comparisonDateText = comparisonDates ? `${formatLocalDate(comparisonDates.from)} — ${formatLocalDate(comparisonDates.to)}` : "";
  const comparisonCriteria = validRange ? reportComparisonDescription({ period, from: queryRange.from, to: queryRange.to, selectedYear: Number(selectedYear), today }) : "";
  const isOpenPeriod = queryRange.to === today;

  async function exportReport(format: "csv" | "pdf") {
    if (!queryInput || exporting) return;
    setExporting(format);
    try {
      if (format === "csv") {
        const result = await utils.admin.reportsSalesCsv.fetch({
          ...queryInput,
          ...(comparisonInput ? { comparisonFrom: comparisonInput.from, comparisonTo: comparisonInput.to } : {}),
        });
        downloadBlob(result.fileName, "text/csv;charset=utf-8", `\uFEFF${result.csv}`);
      } else {
        const result = await pdfMutation.mutateAsync({
          ...queryInput,
          ...(comparisonInput ? { comparisonFrom: comparisonInput.from, comparisonTo: comparisonInput.to } : {}),
        });
        const binary = atob(result.pdfBase64);
        const bytes = Uint8Array.from(binary, character => character.charCodeAt(0));
        downloadBlob(result.fileName, "application/pdf", bytes);
      }
      onMessage(`${format.toUpperCase()} exportado. O arquivo foi baixado localmente; não existe arquivo histórico permanente no sistema.`);
    } catch (error) {
      onMessage(error instanceof Error ? error.message : `Falha ao exportar ${format.toUpperCase()}.`, true);
    } finally {
      setExporting(null);
    }
  }

  return <div className="admin-reports">
    <header className="admin-reports-heading"><div><p>Datas no fuso de São Paulo. Valores são históricos dos pedidos; estados financeiros e logísticos são atuais. Eventos financeiros usam suas datas registradas; períodos passados são recalculados dinamicamente.</p></div><button type="button" onClick={() => { void reportQuery.refetch(); if (!mockData) void comparisonQuery.refetch(); }} disabled={Boolean(mockData) || !enabled || !validRange || reportQuery.isFetching}><RefreshCw size={16} /> Atualizar</button></header>

    <section className="admin-reports-period" aria-label="Filtros do relatório">
      <div className="admin-reports-period-top"><div><h3>Período considerado</h3><p>{queryDateText}{isOpenPeriod ? " · período em andamento" : " · período encerrado, consulta dinâmica"}</p></div>
        <div className="admin-reports-presets" role="group" aria-label="Períodos rápidos">
          {([ ["today", "Hoje"], ["7days", "7 dias"], ["30days", "30 dias"], ["thisMonth", "Este mês"], ["previousMonth", "Mês anterior"] ] as const).map(([value, label]) => <button type="button" key={value} aria-pressed={period === value} onClick={() => choosePeriod(value)}>{label}</button>)}
          <button type="button" aria-pressed={period === "custom"} onClick={() => setPeriod("custom")}>Personalizado</button>
          <button type="button" aria-pressed={period === "month"} onClick={chooseMonthMode}>Mês específico</button>
          <button type="button" aria-pressed={period === "year"} onClick={chooseYearMode}>Ano</button>
        </div>
      </div>
      {period === "month" ? <div className="admin-reports-period-selectors"><label>Mês consultado<input type="month" max={today.slice(0, 7)} value={selectedMonth} onChange={event => setSelectedMonth(event.target.value)} /></label><span className="admin-reports-period-hint">Mês completo compara com o mês completo anterior; o mês em andamento compara os dias transcorridos.</span></div> : null}
      {period === "year" ? <div className="admin-reports-period-selectors"><label>Ano consultado<select value={selectedYear} onChange={event => setSelectedYear(event.target.value)}>
        {Array.from({ length: Math.max(1, Number(today.slice(0, 4)) - 2017) }, (_, index) => Number(today.slice(0, 4)) - index).map(year => <option key={year} value={year}>{year}{year === Number(today.slice(0, 4)) ? " · em andamento" : ""}</option>)}
      </select></label><span className="admin-reports-period-hint">Evolução agrupada por mês; o ano atual vai até hoje.</span></div> : null}
      {period === "custom" ? <div className="admin-reports-date-range"><label>De<input type="date" max={today} value={range.from} onChange={event => setRange(current => ({ ...current, from: event.target.value }))} /></label><span>até</span><label>Até<input type="date" max={today} value={range.to} onChange={event => setRange(current => ({ ...current, to: event.target.value }))} /></label></div> : null}
      {!validRange ? <p className="admin-reports-error" role="alert">Selecione um intervalo válido até a data de hoje.</p> : null}
    </section>

    {!mockData && reportQuery.isLoading ? <div className="admin-reports-state" role="status">Carregando dados do período…</div> : null}
    {!mockData && reportQuery.isError ? <div className="admin-reports-state is-error" role="alert"><span>{reportQuery.error.message}</span><button type="button" onClick={() => void reportQuery.refetch()}>Tentar novamente</button></div> : null}
    {data && (mockData || !reportQuery.isLoading) ? <>
      <nav className="admin-reports-section-nav" aria-label="Seções do relatório">{[["overview", "Visão geral"], ["movement", "Movimentações"], ["finance", "Financeiro"], ["products", "Produtos"], ["clients", "Clientes"], ["exports", "Exportações"]].map(([id, label]) => <a key={id} href={`#report-${id}`}>{label}</a>)}</nav>

      <section id="report-overview" className="admin-reports-block" aria-labelledby="admin-report-overview">
        <div className="admin-reports-section-title"><div><h3 id="admin-report-overview">Visão geral</h3><p>Pedidos agrupados pela data de criação e pelo período acima.</p></div></div>
        <div className="admin-reports-kpis" aria-label="Indicadores do período">
          <article className="is-primary"><span>Pedidos criados</span><strong>{data.ordersCount.toLocaleString("pt-BR")}</strong><small>{comparison ? `${comparisonDelta(data.ordersCount, comparison.ordersCount).absolute} vs. período anterior` : "Contagem no período"}</small></article>
          <article><span>Valor histórico dos pedidos</span><strong>{money.format(data.ordersTotalCents / 100)}</strong><small>Todos os estados; inclui pendentes e cancelados.</small></article>
          <article><span>Pagamentos pendentes</span><strong>{data.pendingPaymentsCount}</strong><small>{money.format(data.pendingPaymentsCents / 100)} em pedidos criados no período.</small></article>
          <article><span>Ticket médio</span><strong>{money.format(data.averageOrderCents / 100)}</strong><small>Valor dos pedidos ÷ {data.ordersCount}; inclui todos os estados.</small></article>
        </div>
        <section className="admin-reports-comparison" aria-label="Comparação entre períodos">
          <header><div><strong>Comparativo</strong><p>{comparisonCriteria}</p></div><span>Anterior: {comparisonDateText || "—"}</span></header>
          {comparison ? <ComparisonCards current={data} previous={comparison} money={money} /> : <small>{mockData ? "Comparativo desativado na prévia." : comparisonQuery.isLoading ? "Calculando comparação…" : "Sem dados comparativos disponíveis."}</small>}
        </section>
      </section>

      <section id="report-movement" className="admin-reports-section" aria-labelledby="admin-report-movement"><div className="admin-reports-section-title"><div><h3 id="admin-report-movement">Movimentações</h3><p>Valor histórico dos pedidos pela data de criação · fuso {REPORT_TIME_ZONE}.</p></div></div>
        {chartRows.some(row => row.ordersCount > 0) ? chartIsMonthly ? <div className="admin-reports-chart" role="img" aria-label={`Gráfico de barras com ${chartRows.length} meses. Valor histórico dos pedidos.`}>{chartRows.map(row => {
          const label = "month" in row ? row.month : row.day;
          const compactLabel = "month" in row ? row.month.slice(5) : row.day.slice(5).replace("-", "/");
          return <div className="admin-reports-chart-day" key={label} title={`${label}: ${money.format(row.totalCents / 100)} · ${row.ordersCount} pedidos`}><div><i style={{ height: `${Math.max(row.totalCents > 0 ? 3 : 0, (row.totalCents / chartMax) * 100)}%` }} /></div><span>{compactLabel}</span></div>;
        })}</div> : <DailyLineChart rows={data.daily} max={chartMax} money={money} /> : <p className="admin-reports-empty compact">Sem movimentação no período selecionado.</p>}
        {data.monthly.length > 1 ? <div className="admin-reports-monthly-table"><h4>Evolução mensal</h4><div className="admin-reports-table-scroll"><table><thead><tr><th>Mês</th><th>Pedidos</th><th>Valor histórico</th></tr></thead><tbody>{data.monthly.map(row => <tr key={row.month}><td>{new Intl.DateTimeFormat("pt-BR", { timeZone: "UTC", month: "long", year: "numeric" }).format(new Date(`${row.month}-01T00:00:00Z`))}</td><td>{row.ordersCount}</td><td>{money.format(row.totalCents / 100)}</td></tr>)}</tbody></table></div></div> : null}
        <div className="admin-reports-orders-list"><h4>Pedidos recentes</h4><p>Até 100 pedidos mais recentes; os indicadores abrangem todos os {data.ordersCount} registros.</p><div className="admin-reports-table-scroll"><table><thead><tr><th>Pedido</th><th>Criado · SP</th><th>Pagamento</th><th>Logística</th><th>Valor histórico</th></tr></thead><tbody>{data.orders.slice(0, 100).map(order => <tr key={order.id}><td><a href={`/gestao/pedidos/${order.id}`}>#{order.id}</a></td><td>{dateTime.format(new Date(order.createdAt))}</td><td><span className={`admin-report-badge payment-${order.paymentStatus}`}>{paymentStatusName[order.paymentStatus] ?? "Indisponível"}</span></td><td><span className={`admin-report-badge logistics-${logisticsTone[order.status] ?? "neutral"}`}>{statusNames[order.status] ?? order.status}</span></td><td>{money.format(order.totalPriceCents / 100)}</td></tr>)}{!data.ordersCount ? <tr><td colSpan={5}>Nenhum pedido no período.</td></tr> : null}</tbody></table></div></div>
      </section>

      <div className="admin-reports-columns">
        <section id="report-finance" className="admin-reports-section" aria-labelledby="admin-report-finance"><div className="admin-reports-section-title"><div><h3 id="admin-report-finance">Financeiro</h3><p>Confirmação financeira separada da logística.</p></div></div>
          <div className="admin-reports-finance-kpis">
            <article className="admin-reports-finance-kpi"><span>Pedidos criados no período com pagamento confirmado atualmente</span><strong>{data.confirmedPaymentsCount} · {money.format(data.confirmedPaymentsCents / 100)}</strong><small>Coorte por createdAt; paymentStatus atual confirmed. Soma o valor do pedido, mesmo que a confirmação tenha ocorrido depois do período.</small></article>
            <article className="admin-reports-finance-kpi"><span>Confirmações financeiras ocorridas no período</span><strong>{data.confirmedPaymentEventsCount} · {money.format(data.confirmedPaymentEventsCents / 100)}</strong><small>paymentConfirmedAt no período e paymentStatus atual confirmed; soma o valor do pedido. Registros sem timestamp não entram.</small></article>
          </div>
          <p className="admin-reports-caveat">Nenhum dos valores é extrato de liquidação ou receita líquida. O sistema não mantém valores normalizados de reembolso, estorno ou ajustes; esses valores não são calculados.</p>
          <h4>Status financeiros atuais dos pedidos criados no período</h4><StatusList rows={data.paymentStatuses} names={paymentStatusName} tonePrefix="payment" money={money} />
          <h4>Status logísticos atuais dos pedidos criados no período</h4><StatusList rows={data.statuses} names={statusNames} tonePrefix="logistics" tones={logisticsTone} money={money} />
        </section>

        <section id="report-products" className="admin-reports-section" aria-labelledby="admin-report-products"><div className="admin-reports-section-title"><div><h3 id="admin-report-products">Produtos</h3><p>Unidades registradas em itens de pedidos; cancelamentos separados.</p></div></div>
          <div className="admin-reports-product-summary"><strong>{data.products.reduce((sum, row) => sum + row.unitsInOrders, 0)}</strong><span>unidades registradas em pedidos</span><small>Não equivale a unidades pagas. Não há histórico confiável de movimentação de estoque para este relatório.</small></div>
          <div className="admin-reports-table-scroll"><table><thead><tr><th>Produto</th><th>Unidades em pedidos</th><th>Canceladas</th></tr></thead><tbody>{data.products.slice(0, 30).map(product => <tr key={product.productId}><td>#{product.productId} · {product.productName}</td><td>{product.unitsInOrders}</td><td>{product.unitsInCancelledOrders}</td></tr>)}{!data.products.length ? <tr><td colSpan={3}>Nenhum item registrado no período.</td></tr> : null}</tbody></table></div>
          <p className="admin-reports-caveat">Estoque atual não representa histórico do período. Reservas de estoque também não são tratadas como movimentos de estoque vendidos.</p>
        </section>
      </div>

      <section id="report-clients" className="admin-reports-section" aria-labelledby="admin-report-clients"><div className="admin-reports-section-title"><div><h3 id="admin-report-clients">Clientes</h3><p>Contas identificadas e pedidos registrados no período.</p></div></div><div className="admin-reports-client-kpis"><article><span>Novos cadastros</span><strong>{data.newCustomersCount}</strong><small>Contas cuja data de cadastro caiu no período.</small></article><article><span>Clientes com pedidos</span><strong>{data.buyersCount}</strong><small>Contas distintas associadas a pedidos criados no período; não inclui compradores sem conta.</small></article></div></section>

      <section id="report-exports" className="admin-reports-exports" aria-labelledby="admin-report-exports"><div className="admin-reports-section-title"><div><h3 id="admin-report-exports">Exportações</h3><p>CSV e PDF usam o mesmo intervalo e os mesmos critérios agregados do painel.</p></div></div>
        <div className="admin-reports-export-row"><div><strong>CSV gerencial</strong><span>Indicadores, séries, status, produtos e identificadores de pedidos. Não inclui nome, e-mail, telefone, endereço ou rastreio.</span></div><button type="button" disabled={Boolean(mockData) || Boolean(exporting) || !validRange} onClick={() => void exportReport("csv")}><Download size={16} />{mockData ? "Desativado na prévia" : exporting === "csv" ? "Gerando CSV…" : "Exportar CSV"}</button></div>
        <div className="admin-reports-export-row"><div><strong>PDF gerencial A4</strong><span>Resumo executivo, comparativo, status separados, evolução, produtos e movimentação de clientes sem dados pessoais.</span></div><button type="button" disabled={Boolean(mockData) || Boolean(exporting) || !validRange} onClick={() => void exportReport("pdf")}><FileText size={16} />{mockData ? "Desativado na prévia" : exporting === "pdf" ? "Gerando PDF…" : "Exportar PDF"}</button></div>
        <p>{period === "month" && queryRange.to < today ? "Período mensal encerrado: consulta histórica recalculada com os registros disponíveis." : period === "month" || period === "year" ? "Período em andamento; exportação provisória dos dados disponíveis até agora." : "Exportação por período; a seleção de um mês encerrado gera um relatório histórico consultivo."} Os arquivos são baixados localmente e não ficam arquivados no sistema. Não existe fechamento mensal persistente nem versão imutável nesta implementação.</p>
      </section>
    </> : null}
  </div>;
}

function StatusList({ rows, names, tonePrefix, tones, money: moneyFormat }: {
  rows: Array<{ status: string; count: number; totalCents: number }>;
  names: Record<string, string>;
  tonePrefix: string;
  tones?: Record<string, string>;
  money: Intl.NumberFormat;
}) {
  return <ul className="admin-reports-status">{rows.map(row => <li key={row.status}><span><i className={`admin-report-status-dot ${tonePrefix}-${tones?.[row.status] ?? (row.status === "confirmed" ? "green" : row.status === "unconfirmed" ? "amber" : "neutral")}`} />{names[row.status] ?? row.status}</span><strong>{row.count}</strong><small>{moneyFormat.format(row.totalCents / 100)}</small></li>)}</ul>;
}

function DailyLineChart({ rows, max, money: moneyFormat }: {
  rows: Array<{ day: string; ordersCount: number; totalCents: number }>;
  max: number;
  money: Intl.NumberFormat;
}) {
  const plotLeft = 86;
  const plotRight = 750;
  const plotTop = 14;
  const plotBottom = 111;
  const axisMoney = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL", notation: "compact", maximumFractionDigits: 1 });
  const points = rows.map((row, index) => ({
    ...row,
    x: rows.length <= 1 ? (plotLeft + plotRight) / 2 : plotLeft + index * ((plotRight - plotLeft) / (rows.length - 1)),
    y: plotBottom - row.totalCents / max * (plotBottom - plotTop),
  }));
  const labelStep = Math.max(1, Math.ceil(rows.length / 8));
  return <div className="admin-reports-line-chart" role="img" aria-label={`Evolução diária do valor histórico de pedidos criados, em reais, por ${rows.length} dias.`}>
    <svg viewBox="0 0 760 145" preserveAspectRatio="none" aria-hidden="true">
      {[0, 0.5, 1].map((fraction, index) => {
        const y = plotBottom - fraction * (plotBottom - plotTop);
        const value = Math.round(max * fraction);
        return <g key={index}><line x1={plotLeft} y1={y} x2={plotRight} y2={y} /><text x="0" y={y + 3}><title>{moneyFormat.format(value / 100)}</title>{axisMoney.format(value / 100)}</text></g>;
      })}
      <polyline points={points.map(point => `${point.x},${point.y}`).join(" ")} />
      {points.map(point => <circle key={point.day} cx={point.x} cy={point.y} r="2.5"><title>{`${point.day}: ${moneyFormat.format(point.totalCents / 100)} · ${point.ordersCount} pedidos`}</title></circle>)}
    </svg>
    <div className="admin-reports-line-labels">{rows.map((row, index) => <span key={row.day} title={`${row.day} · ${moneyFormat.format(row.totalCents / 100)} · ${row.ordersCount} pedidos`}>{index % labelStep === 0 || index === rows.length - 1 ? row.day.slice(8) + "/" + row.day.slice(5, 7) : ""}</span>)}</div>
  </div>;
}

function ComparisonCards({ current, previous, money: moneyFormat }: { current: AdminSalesReportData; previous: AdminSalesReportData; money: Intl.NumberFormat }) {
  const metrics = [
    { label: "Pedidos", current: current.ordersCount, previous: previous.ordersCount, format: (value: number) => String(value) },
    { label: "Valor histórico dos pedidos", current: current.ordersTotalCents, previous: previous.ordersTotalCents, format: (value: number) => moneyFormat.format(value / 100), isMoney: true },
    { label: "Novos clientes", current: current.newCustomersCount, previous: previous.newCustomersCount, format: (value: number) => String(value) },
    { label: "Unidades em pedidos", current: current.products.reduce((sum, row) => sum + row.unitsInOrders, 0), previous: previous.products.reduce((sum, row) => sum + row.unitsInOrders, 0), format: (value: number) => String(value) },
  ];
  return <div className="admin-reports-comparison-cards">{metrics.map(metric => {
    const maximum = Math.max(0, metric.current, metric.previous);
    const currentDelta = comparisonDelta(metric.current, metric.previous, "isMoney" in metric && metric.isMoney);
    return <article className="admin-reports-comparison-card" key={metric.label}>
      <h4>{metric.label}</h4>
      <div className="admin-reports-comparison-values"><div><span>Selecionado</span><strong>{metric.format(metric.current)}</strong></div><div><span>Período anterior</span><strong>{metric.format(metric.previous)}</strong></div></div>
      <div className="admin-reports-comparison-bars" aria-hidden="true">
        <div><span>Atual</span><i className="current" style={{ width: `${maximum ? metric.current / maximum * 100 : 0}%` }} /></div>
        <div><span>Anterior</span><i className="previous" style={{ width: `${maximum ? metric.previous / maximum * 100 : 0}%` }} /></div>
      </div>
      <p><span>Variação</span><strong>{currentDelta.absolute}</strong><small>{currentDelta.percent}</small></p>
    </article>;
  })}</div>;
}
