import { useMemo, useState } from "react";
import { ArrowUpRight, Box, CircleAlert, PackageCheck, Truck } from "lucide-react";
import { trpc } from "../../../lib/trpc";
import { AdminEmptyState, AdminLoadingState, AdminStatusBadge, AdminTableWrapper } from "../AdminUI";
import { confirmedSizesBySize, isConfirmedPayment, preorderSizeOrder } from "./logisticsModel";
import "./AdminLogisticsPanel.css";

type Props = { onOpenOrder: (orderId: number) => void };
const orderStage: Record<string, string> = {
  pending: "Aguardando pagamento", paid: "Pagamento confirmado", processing: "Em preparação",
  shipped: "Enviado", delivered: "Entregue", cancelled: "Cancelado",
};
const batchStage: Record<string, string> = {
  DRAFT: "Rascunho", OPEN: "Pré-venda aberta", CLOSED: "Aguardando produção",
  IN_PRODUCTION: "Em produção", RECEIVED: "Lote recebido", SHIPPING: "Envios iniciados",
  COMPLETED: "Concluído", CANCELLED: "Lote cancelado",
};
function formatDate(value: Date | string | null | undefined) {
  if (!value) return "Prazo não registrado";
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? "Prazo não registrado" : new Intl.DateTimeFormat("pt-BR", { dateStyle: "medium", timeZone: "UTC" }).format(date);
}

export function AdminLogisticsPanel({ onOpenOrder }: Props) {
  const [selectedBatch, setSelectedBatch] = useState<number | null>(null);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("all");
  const [page, setPage] = useState(0);
  const orders = trpc.admin.ordersList.useQuery(undefined);
  const batches = trpc.productionBatches.list.useQuery();
  const batchId = selectedBatch ?? (batches.data?.[0] ? Number(batches.data[0].id) : null);
  const summary = trpc.productionBatches.detail.useQuery(batchId ?? 0, { enabled: batchId !== null });

  const metrics = useMemo(() => {
    const all = orders.data ?? [];
    const confirmed = all.filter(order => isConfirmedPayment(order));
    return {
      awaitingProduction: confirmed.filter(order => order.items?.some(item => item.salesModeAtPurchase === "PREORDER" && item.productionStatus === "CLOSED")).length,
      inProduction: confirmed.filter(order => order.items?.some(item => item.salesModeAtPurchase === "PREORDER" && item.productionStatus === "IN_PRODUCTION")).length,
      awaitingPacking: confirmed.filter(order => order.items?.some(item => item.salesModeAtPurchase === "PREORDER" && item.productionStatus === "RECEIVED")).length,
      readyForShipping: confirmed.filter(order => order.items?.some(item => item.salesModeAtPurchase === "PREORDER" && ["SHIPPING", "COMPLETED"].includes(item.productionStatus ?? ""))).length,
      shipped: confirmed.filter(order => order.status === "shipped").length,
      delivered: confirmed.filter(order => order.status === "delivered").length,
      pending: all.filter(order => order.status !== "cancelled" && !isConfirmedPayment(order)).length,
    };
  }, [orders.data]);

  const confirmedSizeTotals = useMemo(() => {
    return confirmedSizesBySize(summary.data?.groups ?? []);
  }, [summary.data?.groups]);

  const filteredOrders = (orders.data ?? []).filter(order => {
    if (order.status === "cancelled") return false;
    const confirmed = isConfirmedPayment(order);
    const items = order.items ?? [];
    if (filter === "payment_pending" && confirmed) return false;
    if (filter === "production" && !(confirmed && items.some(item => item.salesModeAtPurchase === "PREORDER" && ["CLOSED", "IN_PRODUCTION"].includes(item.productionStatus ?? "")))) return false;
    if (filter === "shipping" && !(confirmed && items.some(item => item.salesModeAtPurchase === "PREORDER" && ["RECEIVED", "SHIPPING", "COMPLETED"].includes(item.productionStatus ?? "")))) return false;
    if (filter === "shipped" && order.status !== "shipped") return false;
    if (filter === "delivered" && order.status !== "delivered") return false;
    const needle = search.trim().toLocaleLowerCase("pt-BR");
    if (!needle) return true;
    return [order.id, order.customerName, order.customerEmail, order.trackingCode, ...items.map(item => item.productName)]
      .some(value => String(value ?? "").toLocaleLowerCase("pt-BR").includes(needle));
  });
  const pageSize = 15;
  const pageCount = Math.max(1, Math.ceil(filteredOrders.length / pageSize));
  const currentPage = Math.min(page, pageCount - 1);
  const visibleOrders = filteredOrders.slice(currentPage * pageSize, (currentPage + 1) * pageSize);
  const metricsCards = [
    { label: "Aguardando produção", value: metrics.awaitingProduction, icon: Box, tone: "red" },
    { label: "Em produção", value: metrics.inProduction, icon: PackageCheck, tone: "dark" },
    { label: "Aguardando embalagem", value: metrics.awaitingPacking, icon: Box, tone: "dark" },
    { label: "Pré-venda em etapa de envio", value: metrics.readyForShipping, icon: Truck, tone: "red" },
    { label: "Enviados", value: metrics.shipped, icon: Truck, tone: "dark" },
    { label: "Entregues", value: metrics.delivered, icon: PackageCheck, tone: "dark" },
    { label: "Pagamento pendente", value: metrics.pending, icon: CircleAlert, tone: "amber" },
  ] as const;

  return <div className="l4-logistics">
    <div className="l4-logistics-notice" role="note">
      <span className="l4-logistics-live-dot" aria-hidden="true" />
      <div><strong>Consulta operacional · somente leitura</strong><p>Os status vêm dos registros atuais de pedidos e lotes. Pagamentos pendentes ficam fora da demanda confirmada. Compra de frete, etiquetas, rastreamento do Melhor Envio e etapas de embalagem ainda não estão conectados.</p></div>
    </div>

    {orders.isLoading ? <AdminLoadingState>Carregando operação logística…</AdminLoadingState> : orders.isError ? <div className="l4-logistics-state" role="alert"><p>Não foi possível carregar os pedidos.</p><button type="button" onClick={() => void orders.refetch()} disabled={orders.isFetching}>Tentar novamente</button></div> : <>
      <section className="l4-logistics-metrics" aria-label="Visão geral logística">
        {metricsCards.map(({ label, value, icon: Icon, tone }) => <article className={`l4-logistics-metric l4-logistics-metric--${tone}`} key={label}>
          <span className="l4-logistics-metric-icon"><Icon size={17} aria-hidden="true" /></span><span className="l4-logistics-metric-label">{label}</span><strong>{value}</strong>
        </article>)}
      </section>

      <section className="l4-logistics-batch" aria-labelledby="l4-logistics-batch-title">
        <div className="l4-logistics-section-heading"><div><span className="l4-logistics-eyebrow">PRÉ-VENDA / PRODUÇÃO CONSOLIDADA</span><h2 id="l4-logistics-batch-title">Demanda por lote</h2><p>Somente pedidos com confirmação de pagamento validada entram nas peças necessárias para produção.</p></div>
          <label className="l4-logistics-batch-select">Lote<select value={batchId ?? ""} onChange={event => setSelectedBatch(event.target.value ? Number(event.target.value) : null)} disabled={!batches.data?.length}>
            {!batches.data?.length && <option value="">Nenhum lote disponível</option>}
            {(batches.data ?? []).map(batch => <option key={batch.id} value={batch.id}>{batch.name} · {batchStage[batch.status] ?? batch.status}</option>)}
          </select></label>
        </div>
        {batches.isLoading || (batchId !== null && summary.isLoading) ? <AdminLoadingState>Carregando resumo do lote…</AdminLoadingState> : batches.isError || summary.isError ? <div className="l4-logistics-state" role="alert"><p>Não foi possível carregar o resumo do lote.</p><button type="button" onClick={() => { void batches.refetch(); void summary.refetch(); }}>Tentar novamente</button></div> : !batchId || !summary.data ? <AdminEmptyState title="Nenhum lote disponível" description="Quando houver um lote de pré-venda, sua demanda confirmada aparecerá aqui." /> : <>
          <div className="l4-logistics-batch-stats">
            <div><span>Pedidos pagos</span><strong>{summary.data.paidOrders}</strong></div>
            <div><span>Demanda confirmada</span><strong>{summary.data.confirmedQuantity} <small>peças</small></strong></div>
            <div><span>Pedidos pendentes</span><strong>{summary.data.pendingOrders}</strong></div>
            <div><span>Reserva pendente</span><strong>{summary.data.pendingQuantity} <small>peças · não confirmadas</small></strong></div>
            <div><span>Capacidade do lote</span><strong>{summary.data.batch.maximumQuantity ?? "Sem limite"}</strong></div>
            <div><span>Saldo após reservas</span><strong>{summary.data.batch.maximumQuantity === null ? "—" : Math.max(0, Number(summary.data.batch.maximumQuantity) - Number(summary.data.confirmedQuantity) - Number(summary.data.pendingQuantity))}</strong></div>
          </div>
          <div className="l4-logistics-production-grid">
            <div className="l4-logistics-size-table"><h3>Peças para produção por tamanho</h3><div className="l4-logistics-size-list">
              {preorderSizeOrder.map(size => <div key={size}><span>{size}</span><strong>{confirmedSizeTotals.find(([key]) => key === size)?.[1] ?? 0}</strong></div>)}
              {confirmedSizeTotals.filter(([size]) => !preorderSizeOrder.includes(size as typeof preorderSizeOrder[number])).map(([size, qty]) => <div key={size}><span>{size}</span><strong>{qty}</strong></div>)}
            </div><p>Não inclui pedidos sem pagamento confirmado.</p></div>
            <div className="l4-logistics-batch-summary"><span className="l4-logistics-eyebrow">ETAPA DO LOTE</span><strong>{batchStage[summary.data.batch.status] ?? summary.data.batch.status}</strong><p>Expedição estimada: {formatDate(summary.data.batch.estimatedShippingStart)} – {formatDate(summary.data.batch.estimatedShippingEnd)}</p><p>Confirmações pendentes permanecem como reserva de capacidade e não entram na produção confirmada.</p></div>
          </div>
        </>}
      </section>

      <section className="l4-logistics-orders" aria-labelledby="l4-logistics-orders-title">
        <div className="l4-logistics-section-heading"><div><span className="l4-logistics-eyebrow">ACOMPANHAMENTO</span><h2 id="l4-logistics-orders-title">Pedidos</h2><p>{filteredOrders.length} pedidos não cancelados encontrados, sem exposição de endereço nesta visão.</p></div><span className="l4-logistics-count">{orders.data?.length ?? 0} registros</span></div>
        <div className="l4-logistics-filters"><label>Buscar pedido<input type="search" value={search} onChange={event => { setSearch(event.target.value); setPage(0); }} placeholder="Nº, cliente, produto ou rastreio" /></label><label>Filtrar etapa<select value={filter} onChange={event => { setFilter(event.target.value); setPage(0); }}><option value="all">Todas as etapas</option><option value="payment_pending">Pagamento pendente</option><option value="production">Produção</option><option value="shipping">Em preparação para envio</option><option value="shipped">Enviados</option><option value="delivered">Entregues</option></select></label></div>
        {filteredOrders.length === 0 ? <AdminEmptyState title="Nenhum pedido encontrado" description="Revise a busca ou o filtro selecionado." /> : <><AdminTableWrapper className="l4-logistics-table-wrap"><table className="l4-logistics-table"><thead><tr><th>Pedido</th><th>Itens</th><th>Tipo</th><th>Pagamento</th><th>Andamento</th><th>Rastreamento</th><th><span className="sr-only">Ações</span></th></tr></thead><tbody>
          {visibleOrders.map(order => {
            const confirmed = isConfirmedPayment(order);
            const items = order.items ?? [];
            const modes = [...new Set(items.map(item => item.salesModeAtPurchase === "PREORDER" ? "Pré-venda" : "Estoque"))];
            const batchStatus = items.find(item => item.salesModeAtPurchase === "PREORDER")?.productionStatus;
            const shipmentEstimate = items.find(item => item.salesModeAtPurchase === "PREORDER")?.estimatedShippingStartAtPurchase;
            return <tr key={order.id}>
              <td data-label="Pedido"><strong>#{order.id}</strong><small>{order.customerName || "Cliente"}</small></td>
              <td data-label="Itens">{items.reduce((sum, item) => sum + Number(item.quantity || 0), 0)} peças</td>
              <td data-label="Tipo">{modes.length ? modes.join(" + ") : "Não registrado"}</td>
              <td data-label="Pagamento"><AdminStatusBadge className={confirmed ? "l4-logistics-payment l4-logistics-payment--confirmed" : "l4-logistics-payment l4-logistics-payment--pending"}>{confirmed ? "Confirmado" : "Pendente"}</AdminStatusBadge></td>
              <td data-label="Andamento"><span className="l4-logistics-stage">{batchStatus ? batchStage[batchStatus] ?? batchStatus : orderStage[order.status] ?? order.status}</span>{shipmentEstimate ? <small>Postagem estimada: {formatDate(shipmentEstimate)}</small> : null}</td>
              <td data-label="Rastreamento">{order.trackingCode || <span className="l4-logistics-muted">Não registrado</span>}</td>
              <td data-label="Ação"><button type="button" className="l4-logistics-open-order" onClick={() => onOpenOrder(Number(order.id))} aria-label={`Abrir pedido ${order.id}`}>Ver pedido <ArrowUpRight size={15} aria-hidden="true" /></button></td>
            </tr>;
          })}
        </tbody></table></AdminTableWrapper><nav className="l4-logistics-pagination" aria-label="Paginação dos pedidos"><span>{filteredOrders.length ? `${currentPage * pageSize + 1}–${Math.min((currentPage + 1) * pageSize, filteredOrders.length)} de ${filteredOrders.length}` : "0 pedidos"}</span><div><button type="button" onClick={() => setPage(currentPage - 1)} disabled={currentPage === 0}>Anterior</button><span aria-current="page">{currentPage + 1} / {pageCount}</span><button type="button" onClick={() => setPage(currentPage + 1)} disabled={currentPage + 1 >= pageCount}>Próxima</button></div></nav></>}
      </section>
    </>}
  </div>;
}
