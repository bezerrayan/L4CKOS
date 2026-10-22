import { Link } from "react-router-dom";
import { PackageSearch } from "lucide-react";
import EmptyState from "../components/EmptyState";
import { useUser } from "../contexts/UserContext";
import { useOrders } from "../hooks/useOrders";
import { getOrderStatusLabel } from "../utils/orderStatus";
import { AccountOrdersPreview } from "./AccountPreview";
import "./MeusPedidos.css";

function formatMoney(cents: number) {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format((Number(cents) || 0) / 100);
}

function formatDate(value: unknown) {
  if (!value) return "-";
  const date = new Date(value as string);
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleDateString("pt-BR", {
    day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "America/Sao_Paulo",
  });
}

function MeusPedidosAuthenticated() {
  const { isAuthenticated } = useUser();
  const ordersQuery = useOrders();

  if (!isAuthenticated) {
    return <main className="l4-orders-page">
      <header className="l4-orders-header"><div><p className="l4-orders-eyebrow">Minha conta</p><h1>Meus pedidos</h1><p>Entre para consultar seu histórico de compras.</p></div><Link className="l4-orders-button is-primary" to="/login">Entrar na conta</Link></header>
    </main>;
  }

  const orders = (ordersQuery.data ?? [])
    .filter((order): order is NonNullable<typeof order> => Boolean(order))
    .slice()
    .sort((a, b) => Number(b.id) - Number(a.id));

  return <main className="l4-orders-page">
    <header className="l4-orders-header">
      <div><p className="l4-orders-eyebrow">Minha conta</p><h1>Meus pedidos</h1><p>Acompanhe status, total e rastreio de cada compra.</p></div>
      <Link to="/acompanhar-pedido" className="l4-orders-button">Rastrear pedido</Link>
    </header>

    {ordersQuery.isLoading ? <p className="l4-orders-message">Carregando pedidos...</p> : null}
    {ordersQuery.isError ? <p className="l4-orders-error" role="alert">Não foi possível carregar seus pedidos agora.</p> : null}
    {!ordersQuery.isLoading && !ordersQuery.isError && orders.length === 0 ? <EmptyState icon={PackageSearch} title="VOCÊ AINDA NÃO TEM PEDIDOS" text="Quando realizar uma compra, poderá acompanhar as atualizações por aqui." action={{ label: "EXPLORAR PRODUTOS", to: "/produtos" }} /> : null}

    <div className="l4-orders-list">
      {orders.map(order => {
        const status = String(order.status);
        const statusLabel = order.awaitingProduction ? "Acompanhando produção" : getOrderStatusLabel(status);
        return <article key={order.id} className="l4-order-row">
          <div className="l4-order-heading">
            <div><h2>Pedido #{order.id}</h2><p>Criado em {formatDate(order.createdAt)}</p></div>
            <span className={`l4-order-status is-${status}`} aria-label={`Status do pedido: ${statusLabel}`}>{statusLabel}</span>
          </div>
          <dl className="l4-order-summary">
            <div><dt>Total</dt><dd>{formatMoney(Number(order.totalPrice))}</dd></div>
            <div><dt>Rastreio</dt><dd>{order.trackingCode || "Ainda não informado"}</dd></div>
          </dl>
          <div className="l4-order-actions">
            <Link to={`/meus-pedidos/${order.id}`} className="l4-orders-button">Ver detalhes</Link>
            <Link to={`/acompanhar-pedido?pedido=${order.id}`} className="l4-orders-button is-primary">Acompanhar pedido</Link>
          </div>
        </article>;
      })}
    </div>
  </main>;
}

export default function MeusPedidos() {
  if (import.meta.env.DEV) {
    const preview = new URLSearchParams(window.location.search).get("accountPreview");
    if (preview === "empty" || preview === "populated") return <AccountOrdersPreview scenario={preview} />;
  }
  return <MeusPedidosAuthenticated />;
}
