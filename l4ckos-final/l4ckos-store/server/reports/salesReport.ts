import type { AdminSalesReportData } from "../../shared/reports";
import { addDateDays, addDateMonths, localDateKey, monthDateRange, REPORT_TIME_ZONE } from "../../shared/reportPeriods";

export type SalesReportOrder = {
  id: number;
  createdAt: Date | string;
  status: string;
  paymentStatus: string;
  totalPrice: number;
  userId?: number;
};
export type SalesReportItem = { orderId: number; productId: number; productName?: string | null; quantity: number };
export type SalesReportOptions = {
  confirmedPaymentEvents?: Array<{ id: number; totalPrice: number }>;
  newCustomersCount?: number;
};

export type SalesReportData = AdminSalesReportData;

const statusOrder = ["pending", "processing", "paid", "shipped", "delivered", "cancelled"] as const;

export function aggregateSalesReport(orders: SalesReportOrder[], from: Date, to: Date, items: SalesReportItem[] = [], options: SalesReportOptions = {}): SalesReportData {
  const statusMap = new Map<string, { status: string; count: number; totalCents: number }>();
  const paymentStatusMap = new Map<string, { status: string; count: number; totalCents: number }>();
  const dailyMap = new Map<string, { day: string; ordersCount: number; totalCents: number }>();
  let ordersTotalCents = 0;
  let confirmedPaymentsCents = 0;
  let confirmedPaymentsCount = 0;
  const orderStatusById = new Map(orders.map(order => [order.id, order.status]));
  const productMap = new Map<number, { productId: number; productName: string; unitsInOrders: number; unitsInCancelledOrders: number }>();

  for (const order of orders) {
    const createdAt = order.createdAt instanceof Date ? order.createdAt : new Date(order.createdAt);
    const totalCents = Number(order.totalPrice);
    if (!Number.isFinite(createdAt.getTime()) || !Number.isSafeInteger(totalCents)) continue;
    ordersTotalCents += totalCents;
    if (order.paymentStatus === "confirmed") {
      confirmedPaymentsCents += totalCents;
      confirmedPaymentsCount += 1;
    }
    const status = String(order.status);
    const statusRow = statusMap.get(status) ?? { status, count: 0, totalCents: 0 };
    statusRow.count += 1;
    statusRow.totalCents += totalCents;
    statusMap.set(status, statusRow);

    const paymentStatus = String(order.paymentStatus);
    const paymentRow = paymentStatusMap.get(paymentStatus) ?? { status: paymentStatus, count: 0, totalCents: 0 };
    paymentRow.count += 1;
    paymentRow.totalCents += totalCents;
    paymentStatusMap.set(paymentStatus, paymentRow);

    const day = localDateKey(createdAt);
    const dailyRow = dailyMap.get(day) ?? { day, ordersCount: 0, totalCents: 0 };
    dailyRow.ordersCount += 1;
    dailyRow.totalCents += totalCents;
    dailyMap.set(day, dailyRow);
  }

  for (const item of items) {
    const quantity = Number(item.quantity);
    if (!Number.isSafeInteger(quantity) || quantity < 0) continue;
    const productName = String(item.productName || `Produto #${item.productId}`);
    const product = productMap.get(item.productId) ?? { productId: item.productId, productName, unitsInOrders: 0, unitsInCancelledOrders: 0 };
    product.unitsInOrders += quantity;
    if (orderStatusById.get(item.orderId) === "cancelled") product.unitsInCancelledOrders += quantity;
    productMap.set(item.productId, product);
  }

  const statuses = [
    ...statusOrder.map(status => statusMap.get(status) ?? { status, count: 0, totalCents: 0 }),
    ...[...statusMap.values()].filter(row => !statusOrder.includes(row.status as (typeof statusOrder)[number])).sort((a, b) => a.status.localeCompare(b.status)),
  ];
  const paymentStatuses = ["confirmed", "unconfirmed"].map(status => paymentStatusMap.get(status) ?? { status, count: 0, totalCents: 0 });
  const fromDay = localDateKey(from);
  const toDay = localDateKey(to);
  const dayCount = Math.max(0, Math.min(3661, Math.round((Date.parse(`${toDay}T00:00:00Z`) - Date.parse(`${fromDay}T00:00:00Z`)) / 86_400_000) + 1));
  const daily = dayCount <= 93
    ? Array.from({ length: dayCount }, (_, index) => dailyMap.get(addDateDays(fromDay, index)) ?? { day: addDateDays(fromDay, index), ordersCount: 0, totalCents: 0 })
    : [...dailyMap.values()].sort((a, b) => a.day.localeCompare(b.day));
  const monthlyMap = new Map<string, { month: string; ordersCount: number; totalCents: number }>();
  for (const row of dailyMap.values()) {
    const month = row.day.slice(0, 7);
    const current = monthlyMap.get(month) ?? { month, ordersCount: 0, totalCents: 0 };
    current.ordersCount += row.ordersCount;
    current.totalCents += row.totalCents;
    monthlyMap.set(month, current);
  }
  const fromMonth = `${fromDay.slice(0, 7)}-01`;
  const toMonth = `${toDay.slice(0, 7)}-01`;
  const monthCount = Math.max(0, Math.min(121, (Number(toMonth.slice(0, 4)) - Number(fromMonth.slice(0, 4))) * 12 + Number(toMonth.slice(5, 7)) - Number(fromMonth.slice(5, 7)) + 1));
  const monthly = Array.from({ length: monthCount }, (_, index) => {
    const month = addDateMonths(fromMonth, index).slice(0, 7);
    return monthlyMap.get(month) ?? { month, ordersCount: 0, totalCents: 0 };
  });
  const pending = paymentStatusMap.get("unconfirmed") ?? { count: 0, totalCents: 0 };
  const confirmedEvents = options.confirmedPaymentEvents ?? [];
  const confirmedEventTotalCents = confirmedEvents.reduce((sum, row) => sum + Number(row.totalPrice || 0), 0);
  const buyerIds = new Set(orders.map(order => order.userId).filter((id): id is number => Number.isSafeInteger(id)));
  return {
    from: from.toISOString(),
    to: to.toISOString(),
    timeZone: REPORT_TIME_ZONE,
    ordersCount: orders.length,
    ordersTotalCents,
    averageOrderCents: orders.length ? Math.round(ordersTotalCents / orders.length) : 0,
    pendingPaymentsCount: pending.count,
    pendingPaymentsCents: pending.totalCents,
    confirmedPaymentsCount,
    confirmedPaymentsCents,
    confirmedPaymentEventsCount: confirmedEvents.length,
    confirmedPaymentEventsCents: confirmedEventTotalCents,
    newCustomersCount: options.newCustomersCount ?? 0,
    buyersCount: buyerIds.size,
    statuses,
    paymentStatuses,
    daily,
    monthly,
    products: [...productMap.values()].sort((a, b) => b.unitsInOrders - a.unitsInOrders || a.productName.localeCompare(b.productName)),
    orders: [...orders]
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
      .slice(0, 5000)
      .map(order => ({
        id: order.id,
        createdAt: (order.createdAt instanceof Date ? order.createdAt : new Date(order.createdAt)).toISOString(),
        status: String(order.status),
        paymentStatus: String(order.paymentStatus),
        totalPriceCents: Number(order.totalPrice),
      })),
  };
}

function winAnsiHex(value: string) {
  const special: Record<string, number> = {
    "€": 0x80, "‚": 0x82, "ƒ": 0x83, "„": 0x84, "…": 0x85, "†": 0x86, "‡": 0x87,
    "ˆ": 0x88, "‰": 0x89, "Š": 0x8a, "‹": 0x8b, "Œ": 0x8c, "Ž": 0x8e, "‘": 0x91,
    "’": 0x92, "“": 0x93, "”": 0x94, "•": 0x95, "–": 0x96, "—": 0x97, "™": 0x99,
    "š": 0x9a, "›": 0x9b, "œ": 0x9c, "ž": 0x9e, "Ÿ": 0x9f,
  };
  return [...value].map(char => {
    const code = special[char] ?? char.codePointAt(0)!;
    return (code <= 0xff ? code : 0x3f).toString(16).padStart(2, "0");
  }).join("").toUpperCase();
}

const money = (cents: number) => `R$ ${(cents / 100).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const dateTime = (iso: string) => new Intl.DateTimeFormat("pt-BR", { timeZone: REPORT_TIME_ZONE, dateStyle: "short", timeStyle: "short" }).format(new Date(iso));
const statusLabels: Record<string, string> = {
  pending: "Pendente", paid: "Aguardando preparação", processing: "Em separação", shipped: "Enviado", delivered: "Entregue", cancelled: "Cancelado",
};
const logisticsColors: Record<string, string> = {
  pending: "0.96 0.62 0.04", paid: "0.66 0.33 0.97", processing: "0.05 0.65 0.91",
  shipped: "0.39 0.40 0.95", delivered: "0.09 0.64 0.29", cancelled: "0.94 0.27 0.27",
};
const paymentColors: Record<string, string> = { confirmed: "0.09 0.64 0.29", unconfirmed: "0.96 0.62 0.04" };

function reportDelta(current: number, previous: number, cents = false) {
  const delta = current - previous;
  const magnitude = cents ? money(Math.abs(delta)) : Math.abs(delta).toLocaleString("pt-BR");
  const absolute = delta === 0 ? (cents ? money(0) : "0") : `${delta > 0 ? "+" : "-"}${magnitude}`;
  const percent = previous === 0
    ? "Indisponível · base anterior zero"
    : `${delta === 0 ? "0,0" : Math.abs(delta / previous * 100).toLocaleString("pt-BR", { maximumFractionDigits: 1 })}% ${delta > 0 ? "acima" : delta < 0 ? "abaixo" : "sem variação"}`;
  return { absolute, percent };
}

export function pdfComparisonDescription(report: SalesReportData, comparison?: SalesReportData) {
  if (!comparison) return "Comparação equivalente anterior não informada.";
  const currentFrom = localDateKey(new Date(report.from));
  const currentTo = localDateKey(new Date(report.to));
  const priorFrom = localDateKey(new Date(comparison.from));
  const priorTo = localDateKey(new Date(comparison.to));
  const currentMonth = monthDateRange(Number(currentFrom.slice(0, 4)), Number(currentFrom.slice(5, 7)));
  const priorMonth = monthDateRange(Number(priorFrom.slice(0, 4)), Number(priorFrom.slice(5, 7)));
  if (currentFrom.endsWith("-01") && currentTo === currentMonth.to && priorFrom.endsWith("-01") && priorTo === priorMonth.to) return "Mês completo versus mês completo anterior";
  const currentMonthStart = `${currentFrom.slice(0, 7)}-01`;
  const previousMonthStart = addDateMonths(currentMonthStart, -1);
  if (currentFrom === currentMonthStart && priorFrom === previousMonthStart) {
    const previousMonthEnd = monthDateRange(Number(previousMonthStart.slice(0, 4)), Number(previousMonthStart.slice(5, 7))).to;
    const elapsedDay = Number(currentTo.slice(8, 10));
    const equivalentPreviousEnd = addDateDays(previousMonthStart, Math.min(elapsedDay, Number(previousMonthEnd.slice(8, 10))) - 1);
    if (priorTo === equivalentPreviousEnd) return "Intervalo equivalente do mês anterior";
  }
  const currentYearFull = currentFrom.endsWith("-01-01") && currentTo.endsWith("-12-31");
  const previousYearFull = priorFrom.endsWith("-01-01") && priorTo.endsWith("-12-31");
  if (currentYearFull && previousYearFull) return "Ano completo versus ano completo anterior";
  if (currentFrom.endsWith("-01-01") && priorFrom.endsWith("-01-01")) return "Intervalo transcorrido versus o mesmo intervalo do ano anterior";
  return "Períodos consecutivos de igual duração";
}

function pdfText(x: number, y: number, size: number, value: string, color = "0.12 0.12 0.12", font = "F1") {
  return `BT /${font} ${size} Tf ${color} rg 1 0 0 1 ${x.toFixed(2)} ${(842 - y).toFixed(2)} Tm <${winAnsiHex(value)}> Tj ET\n`;
}

function pdfParagraph(x: number, y: number, size: number, value: string, color = "0.35 0.35 0.35", maxChars = 118) {
  const lines: string[] = [];
  let line = "";
  for (const word of value.split(/\s+/)) {
    const candidate = line ? `${line} ${word}` : word;
    if (candidate.length > maxChars && line) { lines.push(line); line = word; }
    else line = candidate;
  }
  if (line) lines.push(line);
  return { content: lines.map((text, index) => pdfText(x, y + index * (size + 3), size, text, color)).join(""), height: lines.length * (size + 3) };
}

function pdfLine(x1: number, y1: number, x2: number, y2: number, color = "0.72 0.72 0.72", width = 0.7) {
  return `${color} RG ${width} w ${x1} ${(842 - y1).toFixed(2)} m ${x2} ${(842 - y2).toFixed(2)} l S\n`;
}

function pdfRect(x: number, y: number, width: number, height: number, color: string) {
  return `${color} rg ${x} ${(842 - y - height).toFixed(2)} ${width} ${height} re f\n`;
}

export function renderSalesReportPdf(report: SalesReportData, generatedAt = new Date(), comparison?: SalesReportData) {
  const pages: string[] = [];
  let content = "";
  let y = 48;
  const left = 48;
  const right = 547;
  const pageMarker = winAnsiHex("PAGINA 0000 DE 0000");
  const finishPage = () => {
    content += pdfText(left, 820, 8, "L4CKOS · Relatório gerencial · America/Sao_Paulo · Sem dados pessoais", "0.38 0.38 0.38");
    content += pdfText(453, 820, 8, "PAGINA 0000 DE 0000", "0.38 0.38 0.38");
    pages.push(content);
  };
  const newPage = (continued: boolean) => {
    if (content) finishPage();
    content = "";
    y = 48;
    content += pdfRect(left, 34, 5, 23, "0.91 0.01 0.16");
    content += pdfText(left + 13, y, 18, "L4CKOS", "0.08 0.08 0.08", "F2");
    content += pdfText(390, y + 1, 9, continued ? "RELATÓRIO GERENCIAL · CONTINUAÇÃO" : "RELATÓRIO GERENCIAL");
    y += 22;
    content += pdfLine(left, y, right, y, "0.65 0.65 0.65", 0.8);
    y += 19;
  };
  const ensureSpace = (height: number) => {
    if (y + height > 792) newPage(true);
  };
  const addParagraph = (value: string, size = 8) => {
    const paragraph = pdfParagraph(left, y, size, value);
    ensureSpace(paragraph.height + 4);
    const adjusted = pdfParagraph(left, y, size, value);
    content += adjusted.content;
    y += adjusted.height + 4;
  };

  newPage(false);
  const localDate = new Intl.DateTimeFormat("pt-BR", { timeZone: REPORT_TIME_ZONE, dateStyle: "long" });
  content += pdfText(left, y, 16, "Acompanhamento gerencial");
  y += 18;
  content += pdfText(left, y, 9, `Período: ${localDate.format(new Date(report.from))} a ${localDate.format(new Date(report.to))} · fuso America/Sao_Paulo`, "0.38 0.38 0.38");
  content += pdfText(390, y, 8, `Gerado em ${dateTime(generatedAt.toISOString())}`, "0.38 0.38 0.38");
  y += 27;
  const kpis = [
    ["PEDIDOS CRIADOS", String(report.ordersCount)],
    ["VALOR HISTÓRICO DOS PEDIDOS · TODOS OS ESTADOS", money(report.ordersTotalCents)],
    ["CRIADOS NO PERÍODO · PAGAMENTO CONFIRMADO ATUALMENTE", `${report.confirmedPaymentsCount} · ${money(report.confirmedPaymentsCents)}`],
    ["CONFIRMAÇÕES OCORRIDAS NO PERÍODO", `${report.confirmedPaymentEventsCount} · ${money(report.confirmedPaymentEventsCents)}`],
    ["PAGAMENTOS PENDENTES", `${report.pendingPaymentsCount} · ${money(report.pendingPaymentsCents)}`],
    ["TICKET MÉDIO · TODOS OS PEDIDOS", money(report.averageOrderCents)],
  ];
  const cardGap = 10;
  const cardWidth = (right - left - cardGap) / 2;
  kpis.forEach(([label, value], index) => {
    const col = index % 2;
    const row = Math.floor(index / 2);
    const x = left + col * (cardWidth + cardGap);
    const top = y + row * 45;
    content += pdfRect(x, top, cardWidth, 39, "0.95 0.95 0.95");
    content += pdfRect(x, top, 3, 39, index < 2 ? "0.91 0.01 0.16" : "0.28 0.28 0.28");
    content += pdfText(x + 10, top + 13, 7.2, label, "0.35 0.35 0.35");
    content += pdfText(x + 10, top + 31, 10.5, value, "0.06 0.06 0.06", "F2");
  });
  y += Math.ceil(kpis.length / 2) * 45 + 4;
  const comparisonTitle = `Comparativo · ${pdfComparisonDescription(report, comparison)}`;
  ensureSpace(comparison ? 132 : 36);
  content += pdfText(left, y, 11, comparisonTitle, "0.08 0.08 0.08", "F2");
  y += 16;
  if (comparison) {
    const selectedLabel = `${localDate.format(new Date(report.from))} a ${localDate.format(new Date(report.to))}`;
    const previousLabel = `${localDate.format(new Date(comparison.from))} a ${localDate.format(new Date(comparison.to))}`;
    addParagraph(`Selecionado: ${selectedLabel} · Anterior: ${previousLabel}`, 7);
    const comparisons = [
      ["Pedidos", report.ordersCount, comparison.ordersCount],
      ["Valor histórico", report.ordersTotalCents, comparison.ordersTotalCents],
      ["Novos clientes", report.newCustomersCount, comparison.newCustomersCount],
      ["Unidades em pedidos", report.products.reduce((sum, row) => sum + row.unitsInOrders, 0), comparison.products.reduce((sum, row) => sum + row.unitsInOrders, 0)],
    ] as const;
    content += pdfText(left, y + 8, 7, "INDICADOR", "0.42 0.42 0.42");
    content += pdfText(180, y + 8, 7, "SELECIONADO", "0.42 0.42 0.42");
    content += pdfText(278, y + 8, 7, "ANTERIOR", "0.42 0.42 0.42");
    content += pdfText(370, y + 8, 7, "VARIAÇÃO", "0.42 0.42 0.42");
    content += pdfText(479, y + 8, 7, "VAR. %", "0.42 0.42 0.42");
    y += 12;
    for (const [label, current, previous] of comparisons) {
      const cents = label === "Valor histórico";
      const delta = reportDelta(current, previous, cents);
      const formatter = cents ? money : (value: number) => value.toLocaleString("pt-BR");
      const top = y;
      content += pdfRect(left, top, right - left, 19, "0.97 0.97 0.97");
      content += pdfText(left + 4, top + 13, 7.4, label, "0.22 0.22 0.22");
      content += pdfText(180, top + 13, 7.4, formatter(current), "0.12 0.12 0.12");
      content += pdfText(278, top + 13, 7.4, formatter(previous), "0.12 0.12 0.12");
      content += pdfText(370, top + 13, 7.4, delta.absolute, "0.12 0.12 0.12");
      content += pdfText(479, top + 13, 6.5, previous === 0 ? "Base anterior zero" : delta.percent, "0.28 0.28 0.28");
      y += 20;
    }
  } else {
    content += pdfText(left, y + 9, 8, "Comparativo não informado.", "0.38 0.38 0.38");
    y += 18;
  }
  y += 10;
  content += pdfText(left, y, 11, "Situação logística", "0.08 0.08 0.08", "F2");
  content += pdfText(320, y, 11, "Situação financeira", "0.08 0.08 0.08", "F2");
  y += 17;
  content += pdfText(left, y, 7, "Estados atuais dos pedidos criados no período", "0.4 0.4 0.4");
  content += pdfText(320, y, 7, "paymentStatus atual", "0.4 0.4 0.4");
  y += 13;
  for (let index = 0; index < Math.max(report.statuses.length, report.paymentStatuses.length); index += 1) {
    ensureSpace(15);
    const logistics = report.statuses[index];
    const financial = report.paymentStatuses[index];
    if (logistics) {
      const [red, green, blue] = (logisticsColors[logistics.status] ?? "0.28 0.28 0.28").split(" ");
      content += pdfRect(left, y - 7, 3, 9, `${red} ${green} ${blue}`);
      content += pdfText(left + 7, y, 8, `${statusLabels[logistics.status] ?? logistics.status}: ${logistics.count} · ${money(logistics.totalCents)}`, "0.2 0.2 0.2");
    }
    if (financial) {
      const color = financial.status === "confirmed" ? paymentColors.confirmed : paymentColors.unconfirmed;
      content += pdfRect(320, y - 7, 3, 9, color);
      content += pdfText(327, y, 8, `${financial.status === "confirmed" ? "Confirmado" : "Não confirmado"}: ${financial.count} · ${money(financial.totalCents)}`, "0.2 0.2 0.2");
    }
    y += 14;
  }
  content += pdfLine(left, y + 1, right, y + 1, "0.78 0.78 0.78", 0.5);
  y += 17;
  const notes = [
    `Ticket médio = valor histórico de todos os pedidos criados ÷ ${report.ordersCount} pedido(s); inclui cancelados e não confirmados.`,
    "Os valores são históricos do pedido. Os estados financeiros e logísticos exibidos refletem a situação atual na data da consulta.",
    "Confirmações financeiras são eventos datados por paymentConfirmedAt e incluídos quando o estado canônico atual é confirmed; a soma usa o valor histórico do pedido. Legados sem timestamp não entram.",
    "Períodos anteriores são recalculados dinamicamente; não são fechamentos imutáveis. Não há ledger de reembolsos/ajustes nem histórico confiável de estoque; receita líquida e valores recebidos não são calculados.",
  ];
  for (const note of notes) addParagraph(note, 8);

  const listedProducts = Math.min(report.products.length, 18);
  const listedOrders = Math.min(report.orders.length, 100);
  const remainingContentEstimate = 250 + listedProducts * 17 + (listedOrders ? 40 + listedOrders * 17 : 0);
  if (report.orders.length && y + remainingContentEstimate > 792) newPage(true);
  ensureSpace(125);
  content += pdfText(left, y, 14, "Movimentações e clientes", "0.08 0.08 0.08", "F2");
  y += 22;
  const chartRows = report.monthly.length > 3 ? report.monthly : report.daily;
  const chartLabel = report.monthly.length > 3 ? "Evolução mensal · valor dos pedidos" : "Evolução diária · valor dos pedidos";
  ensureSpace(110);
  content += pdfText(left, y, 11, chartLabel, "0.08 0.08 0.08", "F2");
  y += 15;
  if (!report.ordersCount && !chartRows.some(row => row.totalCents > 0)) {
    content += pdfRect(left, y, right - left, 42, "0.96 0.96 0.96");
    content += pdfText(left + 12, y + 25, 9, "Sem movimentação no período selecionado.", "0.38 0.38 0.38");
    y += 55;
  } else {
    const chartTop = y;
    const chartHeight = 85;
    const chartWidth = right - left;
    const max = Math.max(1, ...chartRows.map(item => item.totalCents));
    content += pdfLine(left, chartTop + chartHeight, right, chartTop + chartHeight, "0.65 0.65 0.65", 0.5);
    const step = chartWidth / Math.max(1, chartRows.length - 1);
    if (report.monthly.length > 3) {
      const barStep = chartWidth / Math.max(1, chartRows.length);
      const barWidth = Math.max(1.5, Math.min(16, barStep * 0.55));
      chartRows.forEach((item, index) => {
        const height = Math.max(item.totalCents ? 2 : 0, chartHeight * item.totalCents / max);
        const x = left + index * barStep + (barStep - barWidth) / 2;
        content += pdfRect(x, chartTop + chartHeight - height, barWidth, height, "0.91 0.01 0.16");
        if (index % Math.max(1, Math.ceil(chartRows.length / 10)) === 0 || index === chartRows.length - 1) {
          const label = "month" in item ? item.month.slice(2) : item.day.slice(5).replace("-", "/");
          content += pdfText(x - 5, chartTop + chartHeight + 13, 7, label, "0.38 0.38 0.38");
        }
      });
    } else {
      const points = chartRows.map((item, index) => ({
        x: chartRows.length === 1 ? left + chartWidth / 2 : left + index * step,
        y: chartTop + chartHeight - (item.totalCents ? Math.max(2, chartHeight * item.totalCents / max) : 0),
        label: "day" in item ? item.day.slice(5).replace("-", "/") : item.month.slice(2),
      }));
      for (let index = 1; index < points.length; index += 1) content += pdfLine(points[index - 1].x, points[index - 1].y, points[index].x, points[index].y, "0.91 0.01 0.16", 2);
      points.forEach((point, index) => {
        content += pdfRect(point.x - 1.5, point.y - 1.5, 3, 3, "0.91 0.01 0.16");
        if (index % Math.max(1, Math.ceil(points.length / 10)) === 0 || index === points.length - 1) content += pdfText(point.x - 5, chartTop + chartHeight + 13, 7, point.label, "0.38 0.38 0.38");
      });
    }
    y += chartHeight + 31;
  }
  content += pdfText(left, y, 11, "Movimentação de clientes", "0.08 0.08 0.08", "F2");
  content += pdfText(left, y + 17, 9, `Novos cadastros no período: ${report.newCustomersCount} · Contas cadastradas com pedidos no período: ${report.buyersCount}`, "0.22 0.22 0.22");
  y += 35;
  content += pdfText(left, y, 11, "Produtos mais movimentados", "0.08 0.08 0.08", "F2");
  y += 16;
  const topProducts = report.products.slice(0, 18);
  if (!topProducts.length) {
    content += pdfText(left, y + 10, 8, "Nenhum item registrado no período.", "0.38 0.38 0.38");
    y += 18;
  }
  for (const product of topProducts) {
    ensureSpace(18);
    const productLabel = product.productName.length > 62 ? `${product.productName.slice(0, 59)}...` : product.productName;
    content += pdfText(left, y + 9, 8, `#${product.productId} ${productLabel}`, "0.12 0.12 0.12");
    content += pdfText(430, y + 9, 8, `${product.unitsInOrders} un. · ${product.unitsInCancelledOrders} canceladas`, "0.28 0.28 0.28");
    content += pdfLine(left, y + 13, right, y + 13, "0.86 0.86 0.86", 0.35);
    y += 17;
  }
  y += 8;
  addParagraph("Unidades representam linhas registradas em pedidos; cancelamentos são apresentados em separado e não equivalem a vendas pagas.", 8);
  y += 10;

  if (report.orders.length) {
    ensureSpace(42);
    content += pdfText(left, y, 14, "Pedidos do período", "0.08 0.08 0.08", "F2");
    content += pdfText(left, y + 14, 8, `Amostra dos até 100 pedidos mais recentes; indicadores e tabelas de status abrangem todos os ${report.ordersCount} pedidos. Sem dados pessoais.`, "0.38 0.38 0.38");
    y += 32;
  const header = () => {
    content += pdfText(left, y, 8, "PEDIDO", "0.38 0.38 0.38");
    content += pdfText(125, y, 8, "CRIADO (FUSO SP)", "0.38 0.38 0.38");
    content += pdfText(292, y, 8, "LOGÍSTICA", "0.38 0.38 0.38");
    content += pdfText(405, y, 8, "PAGAMENTO", "0.38 0.38 0.38");
    content += pdfText(500, y, 8, "VALOR", "0.38 0.38 0.38");
    y += 8;
    content += pdfLine(left, y, right, y, "0.5 0.5 0.5", 0.7);
    y += 7;
  };
  header();
  for (const order of report.orders.slice(0, 100)) {
    if (y + 17 > 792) { newPage(true); y += 5; content += pdfText(left, y - 2, 9, "Pedidos do período · continuação", "0.08 0.08 0.08", "F2"); y += 12; header(); }
    content += pdfText(left, y + 9, 8, `#${order.id}`, "0.05 0.05 0.05");
    content += pdfText(125, y + 9, 8, dateTime(order.createdAt), "0.05 0.05 0.05");
    const [statusRed, statusGreen, statusBlue] = (logisticsColors[order.status] ?? "0.28 0.28 0.28").split(" ");
    content += pdfRect(289, y + 2, 3, 8, `${statusRed} ${statusGreen} ${statusBlue}`);
    content += pdfText(296, y + 9, 8, statusLabels[order.status] ?? order.status, "0.05 0.05 0.05");
    content += pdfText(405, y + 9, 8, order.paymentStatus === "confirmed" ? "Confirmado" : "Não confirmado", "0.05 0.05 0.05");
    content += pdfText(500, y + 9, 8, money(order.totalPriceCents), "0.05 0.05 0.05");
    content += pdfLine(left, y + 13, right, y + 13, "0.86 0.86 0.86", 0.35);
    y += 17;
  }
  } else {
    content += pdfText(left, y + 18, 9, "Nenhum pedido no período.", "0.38 0.38 0.38");
  }
  if (content) finishPage();
  const pageCount = pages.length;
  for (let index = 0; index < pages.length; index += 1) {
    pages[index] = pages[index].replace(pageMarker, winAnsiHex(`PAGINA ${String(index + 1).padStart(4, "0")} DE ${String(pageCount).padStart(4, "0")}`));
  }

  const objects: Buffer[] = [];
  const addObject = (value: string | Buffer) => { objects.push(Buffer.isBuffer(value) ? value : Buffer.from(value, "binary")); return objects.length; };
  const catalogId = addObject("");
  const pagesId = addObject("");
  const fontId = addObject("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>");
  const boldFontId = addObject("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>");
  const pageIds: number[] = [];
  for (const pageContent of pages) {
    const stream = Buffer.from(pageContent, "ascii");
    const streamId = addObject(Buffer.concat([Buffer.from(`<< /Length ${stream.length} >>\nstream\n`, "ascii"), stream, Buffer.from("endstream", "ascii")]));
    const pageId = addObject(`<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 ${fontId} 0 R /F2 ${boldFontId} 0 R >> >> /Contents ${streamId} 0 R >>`);
    pageIds.push(pageId);
  }
  objects[catalogId - 1] = Buffer.from(`<< /Type /Catalog /Pages ${pagesId} 0 R >>`, "ascii");
  objects[pagesId - 1] = Buffer.from(`<< /Type /Pages /Kids [${pageIds.map(id => `${id} 0 R`).join(" ")}] /Count ${pageIds.length} >>`, "ascii");

  const chunks: Buffer[] = [Buffer.from("%PDF-1.4\n%L4CKOS\n", "ascii")];
  const offsets = [0];
  let offset = chunks[0].length;
  objects.forEach((object, index) => {
    offsets.push(offset);
    const wrapped = Buffer.concat([Buffer.from(`${index + 1} 0 obj\n`, "ascii"), object, Buffer.from("\nendobj\n", "ascii")]);
    chunks.push(wrapped);
    offset += wrapped.length;
  });
  const xrefOffset = offset;
  const xref = [`xref\n0 ${objects.length + 1}\n`, "0000000000 65535 f \n", ...offsets.slice(1).map(value => `${String(value).padStart(10, "0")} 00000 n \n`)].join("");
  chunks.push(Buffer.from(xref, "ascii"));
  chunks.push(Buffer.from(`trailer\n<< /Size ${objects.length + 1} /Root ${catalogId} 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`, "ascii"));
  return Buffer.concat(chunks);
}
