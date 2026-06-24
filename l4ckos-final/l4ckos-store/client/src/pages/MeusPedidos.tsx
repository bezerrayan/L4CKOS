import { Link } from "react-router-dom";
import type { CSSProperties } from "react";
import { PackageSearch } from "lucide-react";
import EmptyState from "../components/EmptyState";
import { useUser } from "../contexts/UserContext";
import { useOrders } from "../hooks/useOrders";

type OrderStatus = "pending" | "processing" | "paid" | "shipped" | "delivered" | "cancelled";

const statusLabel: Record<OrderStatus, string> = {
  pending: "Aguardando pagamento",
  processing: "Em separacao",
  paid: "Pagamento confirmado",
  shipped: "Em transporte",
  delivered: "Entregue",
  cancelled: "Cancelado",
};

const statusColor: Record<OrderStatus, string> = {
  pending: "#b45309",
  processing: "#0f766e",
  paid: "#15803d",
  shipped: "#1d4ed8",
  delivered: "#166534",
  cancelled: "#b91c1c",
};

function formatMoney(cents: number) {
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
  }).format((Number(cents) || 0) / 100);
}

function formatDate(value: unknown) {
  if (!value) return "-";
  const date = new Date(value as string);
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleDateString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function MeusPedidos() {
  const { isAuthenticated } = useUser();
  const ordersQuery = useOrders();

  if (!isAuthenticated) {
    return (
      <section style={styles.wrapper}>
        <h1 style={styles.title}>Meus pedidos</h1>
        <p style={styles.muted}>Você precisa entrar para ver seu histórico de compras.</p>
        <Link to="/login" style={styles.primaryButton}>
          Entrar na conta
        </Link>
      </section>
    );
  }

  const orders = (ordersQuery.data ?? [])
    .filter((order): order is NonNullable<typeof order> => Boolean(order))
    .slice()
    .sort((a, b) => Number(b.id) - Number(a.id));

  return (
    <section style={styles.wrapper}>
      <div style={styles.headerRow}>
        <div>
          <h1 style={styles.title}>Meus pedidos</h1>
          <p style={styles.muted}>Acompanhe status, total pago e rastreio de cada compra.</p>
        </div>
        <Link to="/acompanhar-pedido" style={styles.secondaryButton}>
          Rastrear pedido
        </Link>
      </div>

      {ordersQuery.isLoading ? <p style={styles.muted}>Carregando pedidos...</p> : null}
      {ordersQuery.isError ? <p style={styles.error}>Não foi possível carregar seus pedidos agora.</p> : null}

      {!ordersQuery.isLoading && !ordersQuery.isError && orders.length === 0 ? (
        <EmptyState
          icon={PackageSearch}
          title="VOCÊ AINDA NÃO TEM PEDIDOS"
          text="Quando realizar uma compra, poderá acompanhar as atualizações por aqui."
          action={{ label: "EXPLORAR PRODUTOS", to: "/produtos" }}
        />
      ) : null}

      <div style={styles.list}>
        {orders.map(order => {
          const status = order.status as OrderStatus;
          return (
            <article key={order.id} style={styles.card}>
              <div style={styles.cardTop}>
                <div>
                  <strong style={styles.orderId}>Pedido #{order.id}</strong>
                  <p style={styles.meta}>Criado em {formatDate(order.createdAt)}</p>
                </div>
                <span style={{ ...styles.badge, background: `${statusColor[status]}22`, color: statusColor[status] }}>
                  {statusLabel[status]}
                </span>
              </div>

              <div style={styles.grid}>
                <div>
                  <p style={styles.metaLabel}>Total</p>
                  <p style={styles.metaStrong}>{formatMoney(Number(order.totalPrice))}</p>
                </div>
                <div>
                  <p style={styles.metaLabel}>Rastreio</p>
                  <p style={styles.metaStrong}>{order.trackingCode || "Ainda não informado"}</p>
                </div>
              </div>

              <div style={styles.cardActions}>
                <Link to={`/meus-pedidos/${order.id}`} style={styles.secondaryButton}>
                  Ver detalhes
                </Link>
                <Link to={`/acompanhar-pedido?pedido=${order.id}`} style={styles.primaryButton}>
                  Acompanhar pedido
                </Link>
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}

const styles: Record<string, CSSProperties> = {
  wrapper: {
    maxWidth: 980,
    margin: "0 auto",
    display: "grid",
    gap: 16,
    color: "#f0ede8",
  },
  headerRow: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 12,
    flexWrap: "wrap",
  },
  title: {
    margin: 0,
    fontSize: 32,
    fontWeight: 800,
    color: "#f0ede8",
  },
  muted: {
    margin: 0,
    color: "#a1a1aa",
    fontSize: 15,
  },
  error: {
    margin: 0,
    color: "#b91c1c",
    fontSize: 15,
    fontWeight: 600,
  },
  list: {
    display: "grid",
    gap: 12,
  },
  card: {
    background: "#101010",
    border: "1px solid #2b2b2b",
    borderRadius: 12,
    padding: 16,
    boxShadow: "0 10px 28px rgba(0, 0, 0, 0.32)",
    display: "grid",
    gap: 14,
  },
  cardTop: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "flex-start",
    gap: 12,
    flexWrap: "wrap",
  },
  orderId: {
    fontSize: 18,
    color: "#f0ede8",
  },
  meta: {
    margin: "4px 0 0",
    color: "#a1a1aa",
    fontSize: 13,
  },
  grid: {
    display: "grid",
    gap: 12,
    gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
  },
  metaLabel: {
    margin: 0,
    color: "#a1a1aa",
    fontSize: 12,
    textTransform: "uppercase",
    letterSpacing: 0.4,
  },
  metaStrong: {
    margin: "4px 0 0",
    color: "#f0ede8",
    fontSize: 15,
    fontWeight: 700,
  },
  badge: {
    borderRadius: 999,
    fontSize: 12,
    fontWeight: 700,
    padding: "6px 10px",
  },
  cardActions: {
    display: "flex",
    gap: 8,
    justifyContent: "flex-end",
    flexWrap: "wrap",
  },
  primaryButton: {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    background: "linear-gradient(135deg, #1a1a1a 0%, #3a3a3a 100%)",
    color: "white",
    textDecoration: "none",
    fontWeight: 700,
    fontSize: 14,
    borderRadius: 8,
    padding: "10px 14px",
  },
  secondaryButton: {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    border: "1px solid #2f2f2f",
    color: "#f0ede8",
    textDecoration: "none",
    fontWeight: 700,
    fontSize: 14,
    borderRadius: 8,
    padding: "10px 14px",
    background: "#0f0f0f",
  },
};
