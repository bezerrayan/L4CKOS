import type { CSSProperties } from "react";
import { AdminEmptyState, AdminFilterPills, AdminMetricCards, AdminStatusBadge, AdminSurface } from "../AdminUI";
import { formatPrice } from "../../../lib/utils";

export type OrderListFilter = "all" | "pending" | "paid" | "processing" | "shipped" | "delivered" | "cancelled" | "withoutTracking";

export type AdminOrderView = {
  id: number;
  userId?: number | null;
  customerName?: string | null;
  customerEmail?: string | null;
  status?: string | null;
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
    productId?: number | null;
    productName?: string | null;
    quantity?: number | string | null;
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
  const cards: Array<{ label: string; value: string | number; tone?: "danger" | "warning" | "success" }> = [
    { label: "Total", value: summary.total },
    { label: "Pendentes", value: summary.pending, tone: "warning" },
    { label: "Pagos", value: summary.paid, tone: "success" },
    { label: "Em separação", value: summary.processing },
    { label: "Enviados", value: summary.shipped },
    { label: "Entregues", value: summary.delivered, tone: "success" },
    { label: "Cancelados", value: summary.cancelled, tone: "danger" },
    { label: "Sem rastreio", value: summary.withoutTracking, tone: "warning" },
    { label: "Faturamento carregado", value: formatPrice(summary.revenueCents / 100), tone: "success" },
  ];

  return <AdminMetricCards cards={cards} />;
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
  return <AdminFilterPills value={value} onChange={onChange} options={options} />;
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
  return <AdminStatusBadge style={tone}>{label || status}</AdminStatusBadge>;
}

export function OrderOperationalAlerts({ alerts }: { alerts: OperationalAlert[] }) {
  if (alerts.length === 0) return null;

  return (
    <div style={styles.alertList}>
      {alerts.map(alert => (
        <div
          key={alert.title}
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
}: {
  order: AdminOrderView | null;
  statusLabel: (status: string) => string;
  statusTone: (status: string) => CSSProperties;
  addressLines: (address: NonNullable<AdminOrderView["shippingAddress"]>) => string[];
}) {
  if (!order) return null;

  const items = order.items ?? [];
  const itemCount = items.reduce((sum, item) => sum + Number(item.quantity ?? 0), 0);

  return (
    <aside style={styles.detailPanel}>
      <div style={styles.detailHeader}>
        <div>
          <span style={styles.detailEyebrow}>Pedido</span>
          <strong style={styles.detailTitle}>#{order.id}</strong>
        </div>
        <OrderStatusBadge status={String(order.status ?? "")} label={statusLabel(String(order.status ?? ""))} tone={statusTone(String(order.status ?? ""))} />
      </div>

      <div style={styles.detailGrid}>
        <DetailInfo label="Cliente" value={order.customerName || order.customerEmail || `Cliente #${order.userId}`} />
        <DetailInfo label="E-mail" value={order.customerEmail || "Não informado"} />
        <DetailInfo label="Total" value={formatPrice(Number(order.totalPrice ?? 0) / 100)} />
        <DetailInfo label="Criado em" value={formatDateTime(order.createdAt)} />
        <DetailInfo label="Rastreio" value={order.trackingCode || "Ainda não informado"} />
        <DetailInfo label="Itens" value={`${itemCount} item(ns)`} />
      </div>

      <section style={styles.detailSection}>
        <strong style={styles.detailSubtitle}>Entrega</strong>
        {order.shippingAddress ? (
          <div style={styles.addressCard}>
            <div style={styles.addressHeader}>
              <span style={styles.itemName}>{order.shippingAddress.recipient || "Destinatário não informado"}</span>
              <span style={styles.addressHint}>
                {order.shippingAddress.source === "profile" ? "Endereço padrão atual do cliente" : "Endereço salvo no pedido"}
              </span>
            </div>
            <div style={styles.addressLines}>
              {addressLines(order.shippingAddress).map(line => (
                <span key={`${order.id}-${line}`} style={styles.secondaryText}>{line}</span>
              ))}
            </div>
          </div>
        ) : (
          <span style={styles.secondaryText}>Nenhum endereço disponível para este pedido.</span>
        )}
      </section>

      <section style={styles.detailSection}>
        <strong style={styles.detailSubtitle}>Itens reservados</strong>
        {items.length === 0 ? (
          <AdminEmptyState title="Sem itens detalhados" description="Este pedido ainda não possui itens detalhados na reserva." />
        ) : (
          <div style={styles.itemsList}>
            {items.map((item, index) => (
              <div key={`${order.id}-${item.productId}-${index}`} style={styles.itemRow}>
                <span style={styles.itemName}>{item.productName || `Produto #${item.productId}`}</span>
                <span style={styles.secondaryText}>Quantidade: {item.quantity}</span>
              </div>
            ))}
          </div>
        )}
      </section>
    </aside>
  );
}

function DetailInfo({ label, value }: { label: string; value: string }) {
  return (
    <div style={styles.detailInfo}>
      <span style={styles.detailInfoLabel}>{label}</span>
      <strong style={styles.detailInfoValue}>{value}</strong>
    </div>
  );
}

function formatDateTime(value: Date | string | null | undefined) {
  if (!value) return "Não informado";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Não informado";
  return date.toLocaleString("pt-BR");
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
  },
  detailHeader: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "flex-start",
    gap: 12,
    flexWrap: "wrap",
  },
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
    gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))",
    gap: 10,
  },
  detailInfo: {
    display: "grid",
    gap: 5,
    padding: "10px 12px",
    borderRadius: 12,
    border: "1px solid rgba(255,255,255,0.075)",
    background: "#090909",
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
  },
  addressHeader: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "flex-start",
    gap: 12,
    flexWrap: "wrap",
  },
  addressHint: {
    color: "#8b949e",
    fontSize: 11,
    lineHeight: 1.4,
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
    display: "grid",
    gap: 4,
    padding: "10px 12px",
    borderRadius: 12,
    border: "1px solid #202020",
    background: "#121212",
  },
  itemName: {
    color: "#f0ede8",
    fontSize: 13,
    fontWeight: 700,
  },
  secondaryText: {
    color: "#9ca3af",
    fontSize: 11,
    lineHeight: 1.35,
  },
};
