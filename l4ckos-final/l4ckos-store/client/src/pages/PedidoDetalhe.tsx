import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { Package } from "lucide-react";
import { PurchasedMixedShippingNotice, PurchasedPreorderInfo, PurchasedTransportInfo } from "../components/PreorderInfo";
import { ReviewPurchaseArea } from "../components/reviews/ReviewPurchaseArea";
import { useOrderDetail } from "../hooks/useOrders";
import { trpc } from "../lib/trpc";
import { getOrderStatusLabel } from "../utils/orderStatus";
import { CANCELLATION_NOTICE } from "../../../shared/paymentExceptions";
import { OrderDetailPreview } from "./AccountPreview";
import "./Tracking.css";
import "./PedidoDetalhe.css";

function formatDate(value: unknown) {
  if (!value) return "-";
  const date = new Date(value as string);
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleString("pt-BR", {
    day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit",
    timeZone: "America/Sao_Paulo",
  });
}

function formatMoney(cents: number) {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format((Number(cents) || 0) / 100);
}

function formatShippingAddress(address?: {
  recipient?: string | null;
  street?: string | null;
  number?: string | null;
  complement?: string | null;
  neighborhood?: string | null;
  city?: string | null;
  state?: string | null;
  zipCode?: string | null;
} | null) {
  if (!address) return [];
  return [
    address.recipient || "",
    [address.street, address.number].filter(Boolean).join(", "),
    [address.complement, address.neighborhood].filter(Boolean).join(" • "),
    [[address.city, address.state].filter(Boolean).join(" - "), address.zipCode ? `CEP ${address.zipCode}` : ""].filter(Boolean).join(" • "),
  ].filter(Boolean);
}

function canEditShippingAddress(status?: string | null) {
  return status === "pending" || status === "paid";
}

function shouldShowAwaitingProduction(order: { status: string; items: Array<{ salesModeAtPurchase?: string | null; productionStatus?: string | null }> }) {
  return ["paid", "processing"].includes(order.status) && order.items.some(item =>
    item.salesModeAtPurchase === "PREORDER" && !["RECEIVED", "SHIPPING", "COMPLETED"].includes(item.productionStatus ?? ""),
  );
}

function PedidoDetalheAuthenticated() {
  const params = useParams<{ id: string }>();
  const orderId = Number(params.id);
  const query = useOrderDetail(Number.isFinite(orderId) ? orderId : undefined);
  const utils = trpc.useUtils();
  const [isEditingAddress, setIsEditingAddress] = useState(false);
  const [addressForm, setAddressForm] = useState({ recipient: "", street: "", number: "", complement: "", neighborhood: "" });

  useEffect(() => {
    const address = query.data?.shippingAddress;
    if (!address) return;
    setAddressForm({
      recipient: address.recipient || "",
      street: address.street || "",
      number: address.number || "",
      complement: address.complement || "",
      neighborhood: address.neighborhood || "",
    });
  }, [query.data?.id, query.data?.shippingAddress]);

  const updateShippingAddressMutation = trpc.orders.updateShippingAddress.useMutation({
    onSuccess: async () => {
      setIsEditingAddress(false);
      await Promise.all([utils.orders.detail.invalidate(orderId), utils.orders.list.invalidate()]);
    },
  });

  return <main className="l4-order-detail l4-order-detail-page">
    <header className="l4-detail-page-head">
      <div><p className="l4-detail-eyebrow">Minha conta · Pedidos</p><h1>Detalhes da compra</h1></div>
      <Link to="/meus-pedidos" className="l4-detail-action is-secondary">Voltar aos pedidos</Link>
    </header>

    {query.isLoading ? <p className="l4-detail-message">Carregando pedido...</p> : null}
    {query.isError ? <p className="l4-detail-error" role="alert">Não foi possível carregar este pedido agora.</p> : null}

    {query.data ? <article className="l4-order-detail-body">
      <section className="l4-detail-order-head" aria-labelledby="l4-detail-order-title">
        <div><p className="l4-detail-eyebrow">Compra</p><h2 id="l4-detail-order-title">Pedido #{query.data.id}</h2><p className="l4-detail-muted">Realizado em {formatDate(query.data.createdAt)}</p></div>
        <span className={`l4-detail-status is-${query.data.status}`}>{shouldShowAwaitingProduction({ status: query.data.status, items: query.data.items ?? [] }) ? "Acompanhando produção" : getOrderStatusLabel(query.data.status)}</span>
      </section>

      {query.data.status === "cancelled" ? <p className="l4-detail-cancel-note" role="note">{CANCELLATION_NOTICE}</p> : null}
      <PurchasedMixedShippingNotice items={query.data.items ?? []} />

      <section className="l4-detail-summary" aria-label="Resumo do pedido">
        <div className="l4-detail-total"><p>Total do pedido</p><strong>{formatMoney(Number(query.data.totalPrice))}</strong></div>
        <div><p>Situação do pagamento</p><strong>{query.data.paymentStatus === "confirmed" ? "Confirmado" : query.data.paymentStatus === "unconfirmed" ? "Aguardando confirmação" : "Não informado"}</strong></div>
        <div><p>Rastreio</p><strong>{query.data.trackingCode || "Ainda não informado"}</strong></div>
        <div><p>Última atualização</p><strong>{formatDate(query.data.updatedAt)}</strong></div>
      </section>

      <section className="l4-detail-section" aria-labelledby="l4-detail-items-title">
        <div className="l4-detail-section-heading"><div><p className="l4-detail-eyebrow">Sua compra</p><h3 id="l4-detail-items-title">Produtos</h3></div><span>{query.data.items?.length ?? 0} {query.data.items?.length === 1 ? "item" : "itens"}</span></div>
        {query.data.items?.length ? <div className="l4-detail-items">
          {query.data.items.map(item => {
            const lineTotal = Number(item.productPrice || 0) * Number(item.quantity || 0);
            return <article key={item.id} className="l4-detail-item">
              <div className="l4-detail-product-image">{item.productImage ? <img src={item.productImage} alt={item.productName || `Produto ${item.productId}`} loading="lazy" /> : <div className="l4-detail-image-fallback" role="img" aria-label="Imagem do produto indisponível"><Package size={21} aria-hidden="true" /></div>}</div>
              <div className="l4-detail-item-info"><h4>{item.productName || `Produto #${item.productId}`}</h4>
                {item.color || item.size ? <p className="l4-detail-item-variant">{[item.color, item.size].filter(Boolean).join(" · ")}</p> : null}
                <PurchasedPreorderInfo item={item} status={query.data.status} />
                <p className="l4-detail-item-quantity">Quantidade: {item.quantity}</p>
              </div>
              <dl className="l4-detail-item-prices"><div><dt>Unitário</dt><dd>{formatMoney(Number(item.productPrice || 0))}</dd></div><div><dt>Subtotal</dt><dd>{formatMoney(lineTotal)}</dd></div></dl>
            </article>;
          })}
        </div> : <p className="l4-detail-muted">Os itens deste pedido não estão disponíveis no momento.</p>}
      </section>

      <section className="l4-detail-section l4-detail-delivery" aria-labelledby="l4-detail-delivery-title">
        <div className="l4-detail-section-heading"><div><p className="l4-detail-eyebrow">Destino e transporte</p><h3 id="l4-detail-delivery-title">Entrega</h3></div>
          {canEditShippingAddress(query.data.status) ? <button type="button" className="l4-detail-inline-button" onClick={() => setIsEditingAddress(current => !current)} aria-expanded={isEditingAddress}>{isEditingAddress ? "Cancelar edição" : "Ajustar endereço"}</button> : null}
        </div>
        {query.data.shippingAddress ? <div className="l4-detail-address">{formatShippingAddress(query.data.shippingAddress).map(line => <p key={line}>{line}</p>)}</div> : <p className="l4-detail-muted">Endereço de entrega indisponível no momento.</p>}
        {canEditShippingAddress(query.data.status) ? <p className="l4-detail-address-rule">Você pode ajustar destinatário, rua, número, complemento e bairro até o pedido entrar em separação. CEP, cidade e UF ficam travados para não alterar o frete da cobrança.</p> : null}

        {isEditingAddress && canEditShippingAddress(query.data.status) ? <form className="l4-detail-address-form" onSubmit={event => {
          event.preventDefault();
          updateShippingAddressMutation.mutate({ orderId: query.data.id, address: {
            recipient: addressForm.recipient.trim(), street: addressForm.street.trim(), number: addressForm.number.trim(),
            complement: addressForm.complement.trim() || undefined, neighborhood: addressForm.neighborhood.trim(),
          } });
        }}>
          <input aria-label="Destinatário" placeholder="Destinatário" value={addressForm.recipient} onChange={event => setAddressForm(current => ({ ...current, recipient: event.target.value }))} />
          <input aria-label="Rua" placeholder="Rua" value={addressForm.street} onChange={event => setAddressForm(current => ({ ...current, street: event.target.value }))} />
          <input aria-label="Número" placeholder="Número" value={addressForm.number} onChange={event => setAddressForm(current => ({ ...current, number: event.target.value }))} />
          <input aria-label="Complemento (opcional)" placeholder="Complemento (opcional)" value={addressForm.complement} onChange={event => setAddressForm(current => ({ ...current, complement: event.target.value }))} />
          <input aria-label="Bairro" placeholder="Bairro" value={addressForm.neighborhood} onChange={event => setAddressForm(current => ({ ...current, neighborhood: event.target.value }))} />
          <div className="l4-detail-readonly"><span>{query.data.shippingAddress?.zipCode ? `CEP ${query.data.shippingAddress.zipCode}` : "CEP não informado"}</span><span>{[query.data.shippingAddress?.city, query.data.shippingAddress?.state].filter(Boolean).join(" - ") || "Cidade/UF não informados"}</span></div>
          {updateShippingAddressMutation.error ? <p className="l4-detail-error" role="alert">{updateShippingAddressMutation.error.message}</p> : null}
          <div className="l4-detail-form-actions"><button type="submit" className="l4-detail-action is-primary" disabled={updateShippingAddressMutation.isPending}>{updateShippingAddressMutation.isPending ? "Salvando..." : "Salvar endereço"}</button></div>
        </form> : null}
        <PurchasedTransportInfo option={query.data.shippingAtPurchase} status={query.data.status} />
      </section>

      <footer className="l4-detail-actions">
        <Link to={`/acompanhar-pedido?pedido=${query.data.id}`} className="l4-detail-action is-primary">Acompanhar pedido</Link>
      </footer>
      {query.data.status === "delivered" ? <ReviewPurchaseArea orderId={query.data.id} /> : null}
    </article> : null}
  </main>;
}

export default function PedidoDetalhe() {
  if (import.meta.env.DEV) {
    const preview = new URLSearchParams(window.location.search).get("orderPreview");
    if (preview === "pending" || preview === "paid" || preview === "cancelled") return <OrderDetailPreview scenario={preview} />;
  }
  return <PedidoDetalheAuthenticated />;
}
