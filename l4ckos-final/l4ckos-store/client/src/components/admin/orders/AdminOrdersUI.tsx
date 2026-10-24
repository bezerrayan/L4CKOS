import type { CSSProperties } from "react";
import { AdminEmptyState, AdminStatusBadge, AdminSurface } from "../AdminUI";
import { formatPrice } from "../../../lib/utils";
import { getOrderLogisticsAccent, getPaymentStatusAccent, type LogisticsStatusKey } from "../../../lib/orderStatusPresentation";

import { CANCELLATION_NOTICE } from "../../../../../shared/paymentExceptions";
const reservationStateLabels: Record<string, string> = {
  active: "Reservada",
  consumed: "Consumida",
  released: "Liberada",
  expired: "Expirada",
  restocked: "Reposta ao estoque",
};
export type OrderListFilter = "all" | "pending" | "paid" | "processing" | "shipped" | "delivered" | "cancelled" | "withoutTracking";

export type AdminOrderView = {
  id: number;
  userId?: number | null;
  customerName?: string | null;
  customerEmail?: string | null;
  status?: string | null;
  paymentStatus?: string | null;
  paymentConfirmationSource?: string | null;
  paymentConfirmedAt?: Date | string | null;
  paymentConfirmedBy?: number | null;
  paymentConfirmationReference?: string | null;
  totalPrice?: number | string | null;
  trackingCode?: string | null;
  createdAt?: Date | string | null;
  shippingAddress?: {
    recipient?: string | null;
    source?: string | null;
    street?: string | null;
    number?: string | null;
    complement?: string | null;
    neighborhood?: string | null;
    city?: string | null;
    state?: string | null;
    zipCode?: string | null;
  } | null;
  items?: Array<{
    id?: number | null;
    productId?: number | null;
    productName?: string | null;
    quantity?: number | string | null;
    productPrice?: number | string | null;
    sku?: string | null;
    productImage?: string | null;
    variantName?: string | null;
    size?: string | null;
    color?: string | null;
    salesModeAtPurchase?: "STOCK" | "PREORDER" | null;
    productionBatchNameAtPurchase?: string | null;
    productionStatus?: string | null;
    status?: string | null;
  }> | null;
};

export type OrdersSummary = {
  total: number;
  pending: number;
  paid: number;
  processing: number;
  shipped: number;
  delivered: number;
  cancelled: number;
  withoutTracking: number;
  revenueCents: number;
};

type FilterOption = {
  key: OrderListFilter;
  label: string;
  count: number;
};

type OperationalAlert = {
  title: string;
  description: string;
  tone: "warning" | "danger" | "neutral";
};

export function OrdersSummaryCards({ summary }: { summary: OrdersSummary }) {
  const primaryMetrics = [
    { label: "Pedidos carregados", value: summary.total },
    { label: "Pendentes de pagamento", value: summary.pending, status: "pending" },
    { label: "Pagos · aguardando preparação", value: summary.paid, status: "paid" },
  ] as const;
  const operationalMetrics = [
    { label: "Em separação", value: summary.processing, status: "processing" },
    { label: "Enviados", value: summary.shipped, status: "shipped" },
    { label: "Entregues", value: summary.delivered, status: "delivered" },
    { label: "Cancelados", value: summary.cancelled, status: "cancelled" },
    { label: "Sem rastreio", value: summary.withoutTracking, status: "pending" },
    { label: "Valor dos pedidos carregados", value: formatPrice(summary.revenueCents / 100), tone: "value" },
  ] as const;
  const metricCards = (metrics: typeof primaryMetrics | typeof operationalMetrics) => metrics.map(metric => (
    <article key={metric.label} className={`admin-order-summary-card${"tone" in metric && metric.tone === "value" ? " is-value" : ""}`} data-status={"status" in metric ? metric.status : undefined} style={{ "--order-status-accent": "status" in metric && metric.status ? getOrderLogisticsAccent(metric.status) : "#E8002A" } as CSSProperties}>
      <strong>{metric.value}</strong>
      <span>{metric.label}</span>
    </article>
  ));

  return <div className="admin-orders-summary-groups">
    <section className="admin-orders-summary-group admin-orders-summary-group--primary" aria-label="Resumo de pedidos">
      <h3>Visão geral</h3>
      <div className="admin-order-summary-grid admin-order-summary-grid--primary">{metricCards(primaryMetrics)}</div>
    </section>
    <section className="admin-orders-summary-group admin-orders-summary-group--operations" aria-label="Fluxo logístico e financeiro">
      <h3>Fluxo e acompanhamento</h3>
      <div className="admin-order-summary-grid admin-order-summary-grid--operations">{metricCards(operationalMetrics)}</div>
    </section>
  </div>;
}

export function OrdersFilters({
  value,
  onChange,
  options,
}: {
  value: OrderListFilter;
  onChange: (value: OrderListFilter) => void;
  options: FilterOption[];
}) {
  return <div className="admin-orders-filters" role="group" aria-label="Filtrar pedidos">
    {options.map(option => {
      const status = option.key === "all" ? null : option.key === "withoutTracking" ? "pending" : option.key as LogisticsStatusKey;
      const accent = status ? getOrderLogisticsAccent(status) : "#A3A3A3";
      return <button key={option.key} type="button" className="admin-orders-filter-pill" data-status={option.key} aria-pressed={value === option.key} style={{ "--order-status-accent": accent } as CSSProperties} onClick={() => onChange(option.key)}>
        <span>{option.label}</span><strong>{option.count}</strong>
      </button>;
    })}
  </div>;
}

export function OrderStatusBadge({
  status,
  label,
  tone,
}: {
  status: string;
  label: string;
  tone: CSSProperties;
}) {
  return <AdminStatusBadge className="admin-order-status-badge" dataStatus={status} style={tone}>{label || status}</AdminStatusBadge>;
}

export function PaymentStatusBadge({ confirmed }: { confirmed: boolean }) {
  const key = confirmed ? "confirmed" : "pending";
  return <span className={`admin-payment-state ${confirmed ? "is-confirmed" : "is-unconfirmed"}`} data-payment-status={key} style={{ "--payment-status-accent": getPaymentStatusAccent(key) } as CSSProperties}>{confirmed ? "Pagamento confirmado" : "Pagamento pendente"}</span>;
}

export function OrderOperationalAlerts({ alerts }: { alerts: OperationalAlert[] }) {
  if (alerts.length === 0) return null;

  return (
    <div className="admin-orders-operational-alerts" style={styles.alertList}>
      {alerts.map(alert => (
        <div
          key={alert.title}
          className={`admin-orders-operational-alert is-${alert.tone}`}
          style={{
            ...styles.alertItem,
            ...(alert.tone === "danger" ? styles.alertDanger : alert.tone === "warning" ? styles.alertWarning : {}),
          }}
        >
          <strong style={styles.alertTitle}>{alert.title}</strong>
          <span style={styles.alertDescription}>{alert.description}</span>
        </div>
      ))}
    </div>
  );
}

export function OrderDetailPanel({
  order,
  statusLabel,
  statusTone,
  addressLines,
  onUpdateLogistics,
  onUpdateTracking,
  isUpdating,
  className,
}: {
  order: AdminOrderView | null;
  statusLabel: (status: string) => string;
  statusTone: (status: string) => CSSProperties;
  addressLines: (address: NonNullable<AdminOrderView["shippingAddress"]>) => string[];
  onUpdateLogistics: () => void;
  onUpdateTracking: () => void;
  isUpdating: boolean;
  className?: string;
}) {
  if (!order) return null;

  const items = order.items ?? [];
  const itemCount = items.reduce((sum, item) => sum + Number(item.quantity ?? 0), 0);
  const paymentConfirmed = order.paymentStatus === "confirmed";
  const reservationItems = items.filter(item => Boolean(item.status));

  return (
    <article className={`admin-order-detail${className ? ` ${className}` : ""}`}>
      <header className="admin-order-detail-card-header">
        <div><span className="admin-order-detail-eyebrow">Pedido</span><h3>#{order.id}</h3></div>
        <div className="admin-order-detail-count"><strong>{itemCount}</strong><span>{itemCount === 1 ? "unidade" : "unidades"} · {items.length} {items.length === 1 ? "produto" : "produtos"}</span></div>
      </header>
      <div className="admin-order-detail-columns">
        <div className="admin-order-operations-column">
          <section className="admin-order-info-card" aria-labelledby="admin-order-customer-heading">
            <h4 id="admin-order-customer-heading">Cliente</h4>
            <dl className="admin-order-customer-facts">
              <div><dt>Nome</dt><dd>{order.customerName || `Cliente #${order.userId ?? "—"}`}</dd></div>
              <div><dt>E-mail</dt><dd>{order.customerEmail || "Não informado"}</dd></div>
              <div><dt>Pedido criado</dt><dd>{formatDateTime(order.createdAt)}</dd></div>
            </dl>
          </section>

          <section className="admin-order-info-card admin-order-financial-card" aria-labelledby="admin-order-payment-heading">
            <div className="admin-order-section-heading"><h4 id="admin-order-payment-heading">Resumo financeiro</h4><PaymentStatusBadge confirmed={paymentConfirmed} /></div>
            <div className="admin-order-total"><span>Total do pedido</span><strong>{formatPrice(Number(order.totalPrice ?? 0) / 100)}</strong></div>
            {paymentConfirmed ? <div className="admin-order-payment-meta">
              <span>{order.paymentConfirmationSource === "manual" ? `Confirmação manual pelo admin #${order.paymentConfirmedBy ?? "—"}` : order.paymentConfirmationSource === "asaas_webhook" ? "Confirmado pelo webhook validado do Asaas" : order.paymentConfirmationSource ? `Origem: ${order.paymentConfirmationSource}` : "Origem não informada"}</span>
              <span>{formatDateTime(order.paymentConfirmedAt)}</span>
            </div> : <p className="admin-order-payment-note">A confirmação ocorre pelo fluxo financeiro autorizado.</p>}
            <p className="admin-order-financial-notice">{CANCELLATION_NOTICE} Reembolsos seguem conciliação.</p>
          </section>

          <section className="admin-order-info-card" aria-labelledby="admin-order-logistics-heading">
            <div className="admin-order-section-heading"><h4 id="admin-order-logistics-heading">Andamento logístico</h4><OrderStatusBadge status={String(order.status ?? "")} label={statusLabel(String(order.status ?? ""))} tone={statusTone(String(order.status ?? ""))} /></div>
            <div className="admin-order-detail-actions">
              <button type="button" className="admin-order-action-launch" disabled={isUpdating} onClick={onUpdateLogistics}>Atualizar logística</button>
              <button type="button" className="admin-order-action-launch" disabled={isUpdating} onClick={onUpdateTracking}>{order.trackingCode ? "Editar rastreio" : "Adicionar rastreio"}</button>
            </div>
          </section>

          <section className="admin-order-info-card" aria-labelledby="admin-order-delivery-heading">
            <div className="admin-order-section-heading"><h4 id="admin-order-delivery-heading">Entrega</h4></div>
            <div className="admin-order-delivery-tracking"><span>Rastreio</span><strong>{order.trackingCode || "Ainda não informado"}</strong></div>
            {order.shippingAddress ? <div className="admin-order-address-card">
              <div className="admin-order-address-heading"><strong>{order.shippingAddress.recipient || "Destinatário não informado"}</strong><span>{order.shippingAddress.source === "profile" ? "Endereço atual do perfil" : "Endereço salvo no pedido"}</span></div>
              <div className="admin-order-address-lines">{addressLines(order.shippingAddress).map((line, index) => <span key={`${order.id}-address-${index}`}>{line}</span>)}</div>
            </div> : <p className="admin-order-muted">Nenhum endereço disponível para este pedido.</p>}
          </section>

          {reservationItems.length ? <section className="admin-order-info-card admin-order-reservations" aria-labelledby="admin-order-reservations-heading">
            <h4 id="admin-order-reservations-heading">Reserva de estoque</h4>
            <ul>{reservationItems.map((item, index) => <li key={`${order.id}-reservation-${item.id ?? item.productId}-${index}`}>
              <span>{item.productName || `Produto #${item.productId ?? "—"}`} · {Number(item.quantity ?? 0)} un.</span>
              <strong>{reservationStateLabels[String(item.status)] ?? String(item.status)}</strong>
            </li>)}</ul>
          </section> : null}
        </div>

        <section className="admin-order-products-panel" aria-labelledby="admin-order-products-heading">
          <header className="admin-order-products-header"><div><h4 id="admin-order-products-heading">Produtos do pedido</h4></div><strong aria-label={`${items.length} itens`}>{items.length}</strong></header>
          {items.length === 0 ? <AdminEmptyState title="Sem itens detalhados" description="Este pedido ainda não possui itens detalhados na reserva." /> : <div className="admin-order-products-list">
            {items.map((item, index) => {
              const quantity = Number(item.quantity ?? 0);
              const unitPrice = item.productPrice === undefined || item.productPrice === null ? null : Number(item.productPrice);
              const subtotal = unitPrice !== null && Number.isFinite(unitPrice) && Number.isFinite(quantity) ? unitPrice * quantity : null;
              const spec = [item.variantName, item.color && `Cor ${item.color}`, item.size && `Tamanho ${item.size}`].filter(Boolean);
              return <article key={`${order.id}-${item.id ?? item.productId}-${index}`} className="admin-order-product-card">
                <div className="admin-order-product-identity">
                  {item.productImage ? <img src={item.productImage} alt={item.productName || `Produto #${item.productId ?? "—"}`} loading="lazy" /> : <div className="admin-order-product-image-empty" aria-hidden="true">Sem imagem</div>}
                  <div className="admin-order-product-title"><span>Produto #{item.productId ?? "—"}{item.sku ? ` · SKU ${item.sku}` : ""}</span><h5>{item.productName || `Produto #${item.productId ?? "—"}`}</h5>
                    {spec.length ? <p>{spec.join(" · ")}</p> : <p>Variação não registrada</p>}
                    {item.salesModeAtPurchase === "PREORDER" && item.productionBatchNameAtPurchase ? <p>Pré-venda · {item.productionBatchNameAtPurchase}</p> : null}
                    <dl className="admin-order-product-pricing">
                      <div><dt>Quantidade</dt><dd>{Number.isFinite(quantity) ? quantity : "—"}</dd></div>
                      {unitPrice !== null && Number.isFinite(unitPrice) ? <div><dt>Preço unitário</dt><dd>{formatPrice(unitPrice / 100)}</dd></div> : null}
                      {subtotal !== null ? <div><dt>Subtotal do item</dt><dd>{formatPrice(subtotal / 100)}</dd></div> : null}
                    </dl>
                  </div>
                </div>
              </article>;
            })}
          </div>}
        </section>
      </div>
    </article>
  );
}

function formatDateTime(value: Date | string | null | undefined) {
  if (!value) return "Não informado";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Não informado";
  return date.toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" });
}

const styles: Record<string, CSSProperties> = {
  summaryGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(142px, 1fr))",
    gap: 10,
  },
  summaryCard: {
    display: "grid",
    gap: 8,
    padding: "14px 14px",
    borderRadius: 14,
    border: "1px solid rgba(255,255,255,0.075)",
    background: "#090909",
  },
  summaryCardWarning: {
    borderColor: "rgba(245,158,11,0.26)",
    background: "linear-gradient(180deg, rgba(245,158,11,0.075), rgba(245,158,11,0.02)), #090909",
  },
  summaryCardDanger: {
    borderColor: "rgba(239,68,68,0.34)",
    background: "linear-gradient(180deg, rgba(239,68,68,0.085), rgba(239,68,68,0.02)), #090909",
  },
  summaryCardSuccess: {
    borderColor: "rgba(34,197,94,0.24)",
    background: "linear-gradient(180deg, rgba(34,197,94,0.075), rgba(34,197,94,0.02)), #090909",
  },
  summaryLabel: {
    color: "#9ca3af",
    fontSize: 11,
    fontWeight: 800,
    letterSpacing: "0.10em",
    textTransform: "uppercase",
  },
  summaryValue: {
    color: "#f8f4ec",
    fontSize: 22,
    lineHeight: 1,
    fontWeight: 900,
  },
  filterRow: {
    display: "flex",
    gap: 8,
    flexWrap: "wrap",
    alignItems: "center",
  },
  filterButton: {
    display: "inline-flex",
    alignItems: "center",
    gap: 8,
    minHeight: 38,
    padding: "0 12px",
    borderRadius: 999,
    border: "1px solid rgba(255,255,255,0.10)",
    background: "#101010",
    color: "#d1d5db",
    cursor: "pointer",
    fontSize: 12,
    fontWeight: 800,
  },
  filterButtonActive: {
    borderColor: "rgba(239,68,68,0.42)",
    background: "linear-gradient(180deg, rgba(239,68,68,0.16), rgba(127,29,29,0.12)), #141414",
    color: "#ffffff",
  },
  alertList: {
    display: "grid",
    gap: 10,
  },
  alertItem: {
    display: "grid",
    gap: 5,
    padding: "13px 14px",
    borderRadius: 13,
    border: "1px solid rgba(255,255,255,0.08)",
    background: "#090909",
  },
  alertWarning: {
    borderColor: "rgba(245,158,11,0.28)",
    background: "linear-gradient(180deg, rgba(245,158,11,0.08), rgba(245,158,11,0.025)), #090909",
  },
  alertDanger: {
    borderColor: "rgba(239,68,68,0.34)",
    background: "linear-gradient(180deg, rgba(239,68,68,0.09), rgba(239,68,68,0.025)), #090909",
  },
  alertTitle: {
    color: "#f8f4ec",
    fontSize: 14,
    lineHeight: 1.35,
  },
  alertDescription: {
    color: "#9ca3af",
    fontSize: 12,
    lineHeight: 1.55,
  },
  detailPanel: {
    position: "sticky",
    top: 16,
    display: "grid",
    gap: 14,
    padding: "18px 16px",
    borderRadius: 18,
    border: "1px solid #252525",
    background: "#0d0d0d",
    minWidth: 0,
    overflow: "hidden",
  },
  detailHeader: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "flex-start",
    gap: 12,
    flexWrap: "wrap",
    minWidth: 0,
  },
  detailStateGroup: { display: "grid", justifyItems: "end", gap: 5 },
  stateCaption: { color: "#8f8f8f", fontSize: 11 },
  detailEyebrow: {
    display: "block",
    color: "#9ca3af",
    fontSize: 11,
    fontWeight: 800,
    letterSpacing: "0.12em",
    textTransform: "uppercase",
    marginBottom: 4,
  },
  detailTitle: {
    color: "#f8f4ec",
    fontSize: 22,
    lineHeight: 1.1,
  },
  detailGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 118px), 1fr))",
    gap: 10,
    minWidth: 0,
  },
  detailInfo: {
    display: "grid",
    gap: 5,
    padding: "10px 12px",
    borderRadius: 12,
    border: "1px solid rgba(255,255,255,0.075)",
    background: "#090909",
    minWidth: 0,
  },
  detailInfoLabel: {
    color: "#8b949e",
    fontSize: 11,
    lineHeight: 1.3,
  },
  detailInfoValue: {
    color: "#f0ede8",
    fontSize: 13,
    lineHeight: 1.35,
    overflowWrap: "anywhere",
    wordBreak: "break-word",
    minWidth: 0,
  },
  detailSection: {
    display: "grid",
    gap: 10,
    paddingTop: 4,
  },
  detailSubtitle: {
    color: "#f8f4ec",
    fontSize: 14,
  },
  addressCard: {
    display: "grid",
    gap: 8,
    padding: "12px 14px",
    borderRadius: 12,
    border: "1px solid #202020",
    background: "#121212",
    minWidth: 0,
  },
  addressHeader: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "flex-start",
    gap: 12,
    flexWrap: "wrap",
    minWidth: 0,
  },
  addressHint: {
    color: "#8b949e",
    fontSize: 11,
    lineHeight: 1.4,
    overflowWrap: "anywhere",
  },
  addressLines: {
    display: "grid",
    gap: 4,
  },
  itemsList: {
    display: "grid",
    gap: 8,
  },
  itemRow: {
    display: "flex",
    alignItems: "flex-start",
    gap: 10,
    padding: "10px 12px",
    borderRadius: 12,
    border: "1px solid #202020",
    background: "#121212",
    minWidth: 0,
  },
  itemImage: { width: 42, height: 52, flex: "0 0 42px", objectFit: "contain", alignSelf: "flex-start" },
  itemDescription: { display: "grid", gap: 4, minWidth: 0, flex: "1 1 auto" },
  itemQuantity: { flex: "0 0 auto", color: "#d7d7d7", fontSize: 13, fontVariantNumeric: "tabular-nums" },
  itemName: {
    color: "#f0ede8",
    fontSize: 13,
    fontWeight: 700,
    overflowWrap: "anywhere",
  },
  secondaryText: {
    color: "#9ca3af",
    fontSize: 11,
    lineHeight: 1.35,
    overflowWrap: "anywhere",
  },
  paymentConfirmed: {
    display: "grid",
    gap: 5,
    padding: "12px 14px",
    borderRadius: 12,
    border: "1px solid rgba(255,255,255,0.12)",
    background: "#121212",
  },
  paymentPending: {
    display: "grid",
    gap: 8,
    padding: "12px 14px",
    borderRadius: 12,
    border: "1px solid rgba(245,158,11,0.28)",
    background: "rgba(245,158,11,0.045)",
  },
  confirmPaymentButton: {
    minHeight: 44,
    marginTop: 3,
    padding: "0 14px",
    borderRadius: 10,
    border: "1px solid rgba(255,255,255,0.16)",
    background: "#f4f1eb",
    color: "#080808",
    fontSize: 12,
    fontWeight: 850,
    cursor: "pointer",
  },
};
