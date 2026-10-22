import type { AdminSalesReportData } from "../../shared/reports";

export type SalesReportOrder = {
  id: number;
  createdAt: Date | string;
  status: string;
  paymentStatus: string;
  totalPrice: number;
};
export type SalesReportItem = { orderId: number; productId: number; productName?: string | null; quantity: number };

export type SalesReportData = AdminSalesReportData;

const statusOrder = ["pending", "processing", "paid", "shipped", "delivered", "cancelled"] as const;

export function aggregateSalesReport(orders: SalesReportOrder[], from: Date, to: Date, items: SalesReportItem[] = []): SalesReportData {
  const statusMap = new Map<string, { status: string; count: number; totalCents: number }>();
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

    const day = createdAt.toISOString().slice(0, 10);
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
  return {
    from: from.toISOString(),
    to: to.toISOString(),
    timeZone: "UTC",
    ordersCount: orders.length,
    ordersTotalCents,
    confirmedPaymentsCount,
    confirmedPaymentsCents,
    statuses,
    daily: [...dailyMap.values()].sort((a, b) => a.day.localeCompare(b.day)),
    products: [...productMap.values()].sort((a, b) => b.unitsInOrders - a.unitsInOrders || a.productName.localeCompare(b.productName)),
    orders: [...orders]
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
      .slice(0, 100)
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
const dateTime = (iso: string) => new Intl.DateTimeFormat("pt-BR", { timeZone: "UTC", dateStyle: "short", timeStyle: "short" }).format(new Date(iso));
const statusLabels: Record<string, string> = {
  pending: "Pendente", processing: "Em preparação", paid: "Pago", shipped: "Enviado", delivered: "Entregue", cancelled: "Cancelado",
};

function pdfText(x: number, y: number, size: number, value: string, color = "0.12 0.12 0.12", font = "F1") {
  return `BT /${font} ${size} Tf ${color} rg 1 0 0 1 ${x.toFixed(2)} ${(842 - y).toFixed(2)} Tm <${winAnsiHex(value)}> Tj ET\n`;
}

function pdfLine(x1: number, y1: number, x2: number, y2: number, color = "0.72 0.72 0.72", width = 0.7) {
  return `${color} RG ${width} w ${x1} ${(842 - y1).toFixed(2)} m ${x2} ${(842 - y2).toFixed(2)} l S\n`;
}

function pdfRect(x: number, y: number, width: number, height: number, color: string) {
  return `${color} rg ${x} ${(842 - y - height).toFixed(2)} ${width} ${height} re f\n`;
}

export function renderSalesReportPdf(report: SalesReportData, generatedAt = new Date()) {
  const pages: string[] = [];
  let content = "";
  let y = 48;
  const left = 48;
  const right = 547;
  const pageMarker = winAnsiHex("PAGINA 0000 DE 0000");
  const finishPage = () => {
    content += pdfText(left, 820, 8, "L4CKOS · Resumo sem dados pessoais · Datas de criação em UTC", "0.38 0.38 0.38");
    content += pdfText(453, 820, 8, "PAGINA 0000 DE 0000", "0.38 0.38 0.38");
    pages.push(content);
  };
  const newPage = (continued: boolean) => {
    if (content) finishPage();
    content = "";
    y = 48;
    content += pdfText(left, y, 18, "L4CKOS", "0.91 0.01 0.16", "F2");
    content += pdfText(390, y, 9, continued ? "RELATÓRIO DE PEDIDOS · CONTINUAÇÃO" : "RELATÓRIO DE PEDIDOS");
    y += 27;
    content += pdfLine(left, y, right, y, "0.65 0.65 0.65", 0.8);
    y += 22;
  };

  newPage(false);
  content += pdfText(left, y, 16, "Resumo de pedidos");
  y += 20;
  content += pdfText(left, y, 10, `Período (UTC): ${dateTime(report.from)} a ${dateTime(report.to)}`, "0.38 0.38 0.38");
  content += pdfText(390, y, 9, `Gerado: ${dateTime(generatedAt.toISOString())}`, "0.38 0.38 0.38");
  y += 32;

  content += pdfText(left, y, 10, "PEDIDOS CRIADOS NO PERÍODO", "0.38 0.38 0.38");
  content += pdfText(left, y + 24, 20, String(report.ordersCount), "0.05 0.05 0.05");
  content += pdfText(220, y, 10, "VALOR TOTAL DOS PEDIDOS · TODOS OS ESTADOS", "0.38 0.38 0.38");
  content += pdfText(220, y + 24, 20, money(report.ordersTotalCents), "0.05 0.05 0.05");
  content += pdfText(left, y + 45, 9, `Criados no período com paymentStatus confirmado: ${report.confirmedPaymentsCount} pedido(s) · ${money(report.confirmedPaymentsCents)}`, "0.28 0.36 0.3");
  content += pdfText(left, y + 57, 8, "Indicador não deduz reembolsos; o contrato atual não fornece valor líquido.", "0.38 0.38 0.38");
  y += 73;

  content += pdfText(left, y, 12, "Distribuição por situação");
  y += 13;
  for (const row of report.statuses) {
    content += pdfText(left, y + 12, 9, statusLabels[row.status] ?? row.status);
    content += pdfText(190, y + 12, 9, `${row.count} pedido(s)`);
    content += pdfText(300, y + 12, 9, money(row.totalCents));
    content += pdfLine(left, y + 17, right, y + 17, "0.86 0.86 0.86", 0.4);
    y += 21;
  }
  y += 15;

  if (report.daily.length >= 2) {
    content += pdfText(left, y, 12, "Evolução diária · valor dos pedidos");
    y += 15;
    const chartTop = y;
    const chartHeight = 74;
    const chartWidth = right - left;
    const max = Math.max(1, ...report.daily.map(item => item.totalCents));
    content += pdfLine(left, chartTop + chartHeight, right, chartTop + chartHeight, "0.65 0.65 0.65", 0.5);
    const step = chartWidth / report.daily.length;
    const barWidth = Math.max(1.5, Math.min(13, step * 0.55));
    report.daily.forEach((item, index) => {
      const height = Math.max(item.totalCents ? 2 : 0, chartHeight * item.totalCents / max);
      const barX = left + index * step + (step - barWidth) / 2;
      content += pdfRect(barX, chartTop + chartHeight - height, barWidth, height, "0.91 0.01 0.16");
      if (index % Math.max(1, Math.ceil(report.daily.length / 8)) === 0 || index === report.daily.length - 1) {
        content += pdfText(barX - 5, chartTop + chartHeight + 13, 7, item.day.slice(5).replace("-", "/"), "0.38 0.38 0.38");
      }
    });
    y += chartHeight + 37;
  }

  content += pdfText(left, y, 12, "Pedidos recentes · resumo sem dados pessoais");
  content += pdfText(left, y + 12, 8, "Até 100 linhas mais recentes; os indicadores acima incluem todo o período.", "0.38 0.38 0.38");
  y += 28;
  const header = () => {
    content += pdfText(left, y, 8, "PEDIDO", "0.38 0.38 0.38");
    content += pdfText(135, y, 8, "CRIADO (UTC)", "0.38 0.38 0.38");
    content += pdfText(290, y, 8, "SITUAÇÃO", "0.38 0.38 0.38");
    content += pdfText(450, y, 8, "VALOR", "0.38 0.38 0.38");
    y += 8;
    content += pdfLine(left, y, right, y, "0.5 0.5 0.5", 0.7);
    y += 7;
  };
  header();
  for (const order of report.orders) {
    if (y > 785) {
      newPage(true);
      y += 5;
      header();
    }
    content += pdfText(left, y + 9, 8, `#${order.id}`, "0.05 0.05 0.05");
    content += pdfText(135, y + 9, 8, dateTime(order.createdAt), "0.05 0.05 0.05");
    content += pdfText(290, y + 9, 8, statusLabels[order.status] ?? order.status, "0.05 0.05 0.05");
    content += pdfText(450, y + 9, 8, money(order.totalPriceCents), "0.05 0.05 0.05");
    content += pdfLine(left, y + 13, right, y + 13, "0.86 0.86 0.86", 0.35);
    y += 17;
  }
  if (!report.orders.length) content += pdfText(left, y + 12, 9, "Nenhum pedido no período.", "0.38 0.38 0.38");
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
