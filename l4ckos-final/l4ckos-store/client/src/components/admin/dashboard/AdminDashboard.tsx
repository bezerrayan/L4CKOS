import type { CSSProperties, ReactNode } from "react";
import { getCategoryLabel } from "../../../lib/productCategories";
import { formatPrice } from "../../../lib/utils";
import {
  AdminEmptyState,
  AdminLoadingState,
  AdminQuickActions,
  AdminStatusBadge,
} from "../AdminUI";
import { OrderStatusBadge, PaymentStatusBadge } from "../orders/AdminOrdersUI";
import "./AdminDashboard.css";

type DashboardOrder = {
  id: number;
  status?: string | null;
  paymentStatus?: string | null;
  totalPrice?: number | string | null;
  userId?: number | null;
  customerName?: string | null;
  customerEmail?: string | null;
  trackingCode?: string | null;
  createdAt?: Date | string | null;
};

type DashboardProduct = {
  salesMode?: string;
  id: number;
  name?: string | null;
  category?: string | null;
  stock?: number | string | null;
  imageUrl?: string | null;
  variants?: Array<{ id?: number; isActive?: number | boolean | null; stock?: number | string | null }>;
  variantAvailability?: {
    physicalStock?: number | null;
    activeCount?: number | null;
    inactiveCount?: number | null;
    sellableCount?: number | null;
  } | null;
};

type DashboardPromo = { isActive?: boolean | number | null };
type DashboardCoupon = { isActive?: boolean | number | null };
type DashboardAudit = {
  id: number;
  action: string;
  entity: string;
  entityId?: string | null;
  createdAt: Date | string;
};
type DashboardAlert = {
  title: string;
  description: string;
  tone: "danger" | "warning" | "neutral";
  route?: "orders" | "products" | "promos";
};
type OrderStatusSummary = { status: string; label: string; count: number };
type DashboardKpis = {
  salesToday?: number | null;
  pendingOrders?: number | null;
  ordersToday?: number | null;
  usersCount?: number | null;
  productsCount?: number | null;
  lowStockCount?: number | null;
};
type AdminDashboardProps = {
  dashboardData?: DashboardKpis | null;
  dashboardLoading?: boolean;
  dashboardError?: boolean;
  onRetryDashboard?: () => void;
  orders: DashboardOrder[];
  products: DashboardProduct[];
  promoBanners: DashboardPromo[];
  coupons: DashboardCoupon[];
  recentAudit: DashboardAudit[];
  quickActions: Array<{ label: string; caption: string; onClick: () => void }>;
  ordersLoading: boolean;
  ordersError?: boolean;
  productsLoading: boolean;
  productsError?: boolean;
  promoBannersLoading?: boolean;
  promoBannersError?: boolean;
  couponsLoading?: boolean;
  couponsError?: boolean;
  auditLoading?: boolean;
  auditError?: boolean;
  orderStatusSummary: OrderStatusSummary[];
  operationalAlerts: DashboardAlert[];
  getOrderStatusLabel: (status: string) => string;
  getOrderStatusTone: (status: string) => CSSProperties;
  onViewOrder: (orderId: number) => void;
  onViewProduct: (product: DashboardProduct) => void;
  onNavigateSection?: (section: "orders" | "products" | "promos") => void;
};

const auditActionLabels: Record<string, string> = {
  "order.payment_confirmed_manual": "Pagamento confirmado manualmente",
  "review.moderate": "Avaliação moderada",
  "product.update": "Produto atualizado",
  "payment.reconciliation_required": "Conciliação de pagamento necessária",
  "coupon.update": "Cupom atualizado",
  "batch.transition": "Status do lote alterado",
  "user.setRole": "Papel de acesso atualizado",
  "user.setFlags": "Permissões da conta atualizadas",
  "backup.manual": "Backup manual realizado",
  "order.update": "Pedido atualizado",
  "order.cancelled": "Pedido cancelado",
  "product.create": "Produto criado",
  "product.delete": "Produto removido",
  "coupon.create": "Cupom criado",
  "coupon.delete": "Cupom removido",
  "promoBanner.create": "Destaque da Home criado",
  "promoBanner.update": "Destaque da Home atualizado",
  "promoBanner.delete": "Destaque da Home removido",
  "batch.created": "Lote criado",
  "batch.edited": "Lote atualizado",
  "batch.products_assigned": "Produtos associados ao lote",
  "marketing.campaign.send": "Campanha de e-mail enviada",
};
const auditEntityLabels: Record<string, string> = {
  order: "Pedido", product: "Produto", productReview: "Avaliação", coupon: "Cupom",
  productionBatch: "Lote", user: "Usuário", backup: "Backup", promoBanner: "Destaque da Home", emailCampaign: "Campanha de e-mail",
};
const alertActions = {
  orders: "Ver pedidos",
  products: "Revisar catálogo",
  promos: "Abrir destaques",
} as const;

function isActiveFlag(value: boolean | number | null | undefined) {
  return value === true || value === 1;
}

function asMoney(cents: number | string | null | undefined) {
  return Number(cents ?? 0) / 100;
}

function safeDate(value: Date | string | null | undefined) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function formatDateTime(value: Date | string | null | undefined) {
  const date = safeDate(value);
  return date ? date.toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short", timeZone: "America/Sao_Paulo" }) : "Data não informada";
}

function formatAuditAction(action: string) {
  if (auditActionLabels[action]) return auditActionLabels[action];
  const lastPart = action.split(".").filter(Boolean).at(-1) ?? action;
  return lastPart.replace(/([a-z])([A-Z])/g, "$1 $2").replaceAll("_", " ").replace(/^\w/, value => value.toLocaleUpperCase("pt-BR"));
}

function DashboardPanel({
  title,
  description,
  aside,
  children,
  className = "",
}: {
  title: string;
  description?: string;
  aside?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return <section className={`dashboard-v2__panel ${className}`.trim()}>
    <header className="dashboard-v2__panel-heading">
      <div><h2>{title}</h2>{description ? <p>{description}</p> : null}</div>
      {aside ? <div className="dashboard-v2__panel-aside">{aside}</div> : null}
    </header>
    {children}
  </section>;
}

export function AdminDashboard({
  dashboardData,
  dashboardLoading = false,
  dashboardError = false,
  onRetryDashboard,
  orders,
  products,
  promoBanners,
  coupons,
  recentAudit,
  quickActions,
  ordersLoading,
  ordersError = false,
  productsLoading,
  productsError = false,
  promoBannersLoading = false,
  promoBannersError = false,
  couponsLoading = false,
  couponsError = false,
  auditLoading = false,
  auditError = false,
  orderStatusSummary,
  operationalAlerts,
  getOrderStatusLabel,
  getOrderStatusTone,
  onViewOrder,
  onViewProduct,
  onNavigateSection,
}: AdminDashboardProps) {
  const recentOrders = orders.slice(0, 6);
  const lowStockProducts = products.filter(row => row.salesMode !== "PREORDER" && Number(row.stock ?? 0) <= 5).slice(0, 6);
  const totalOrderValue = orders.reduce((sum, order) => sum + asMoney(order.totalPrice), 0);
  const averageOrderValue = orders.length > 0 ? totalOrderValue / orders.length : null;
  const paidOrders = orders.filter(order => order.status === "paid").length;
  const shippedOrders = orders.filter(order => order.status === "shipped").length;
  const cancelledOrders = orders.filter(order => order.status === "cancelled").length;
  const activeBanners = promoBanners.filter(banner => isActiveFlag(banner.isActive)).length;
  const activeCoupons = coupons.filter(coupon => isActiveFlag(coupon.isActive)).length;
  const ordersWithoutTracking = orders.filter(order => ["paid", "processing", "shipped"].includes(String(order.status ?? "")) && !order.trackingCode).length;
  const productsWithoutImage = products.filter(product => !product.imageUrl).length;
  const derivedAlerts: DashboardAlert[] = [
    ...operationalAlerts,
    ...(!promoBannersLoading && !promoBannersError && activeBanners === 0 && promoBanners.length > 0
      ? [{ title: "Nenhum destaque ativo", description: "Há destaques cadastrados, mas nenhum está ativo na campanha.", tone: "warning" as const, route: "promos" as const }]
      : []),
    ...(!promoBannersLoading && !promoBannersError && promoBanners.length === 0
      ? [{ title: "Nenhum destaque cadastrado", description: "A Home ainda não tem destaques promocionais gerenciados pelo painel.", tone: "neutral" as const, route: "promos" as const }]
      : []),
    ...(!ordersLoading && !ordersError && ordersWithoutTracking > 0
      ? [{ title: `${ordersWithoutTracking} pedido(s) sem rastreio`, description: "Pedidos em preparação, separação ou enviados sem código informado.", tone: "warning" as const, route: "orders" as const }]
      : []),
    ...(!productsLoading && !productsError && productsWithoutImage > 0
      ? [{ title: `${productsWithoutImage} produto(s) sem imagem`, description: "Revise as imagens para manter a vitrine consistente.", tone: "warning" as const, route: "products" as const }]
      : []),
  ];
  const ordersAction = quickActions.find(action => action.label === "Pedidos");

  return <div className="admin-dashboard dashboard-v2">
    <section className="dashboard-v2__summary" aria-labelledby="dashboard-day-title">
      <header className="dashboard-v2__page-heading"><span>PAINEL OPERACIONAL</span><h2 id="dashboard-day-title">Resumo do dia</h2></header>
      {dashboardLoading ? <AdminLoadingState>Carregando indicadores...</AdminLoadingState> : dashboardError || !dashboardData ? <DashboardQueryState onRetry={onRetryDashboard} /> : <div className="dashboard-v2__kpis">
        <article className="dashboard-v2__kpi is-money">
          <span>Valor dos pedidos de hoje já entregues</span>
          <strong>{formatPrice((dashboardData.salesToday ?? 0) / 100)}</strong>
          <p>Soma dos pedidos criados desde o início do dia local do servidor que estão com status logístico Entregue. Não confirma pagamento nem valor recebido.</p>
        </article>
        <article className="dashboard-v2__kpi is-pending">
          <span>Pedidos pendentes</span>
          <strong>{dashboardData.pendingOrders ?? 0}</strong>
          <p>Contagem pelo estado logístico Pendente; não representa confirmação financeira.</p>
        </article>
        <article className="dashboard-v2__kpi is-today">
          <span>Pedidos criados hoje</span>
          <strong>{dashboardData.ordersToday ?? 0}</strong>
          <p>Contagem desde o início do dia calculado pelo servidor.</p>
        </article>
      </div>}
    </section>

    <DashboardPanel title="Precisa de atenção" description="Prioridades operacionais para revisão manual.">
      {ordersLoading || productsLoading ? <AdminLoadingState>Verificando pedidos e estoque...</AdminLoadingState> : ordersError || productsError ? <AdminEmptyState title="Alertas indisponíveis" description="Não foi possível consultar pedidos e estoque para atualizar todos os alertas." /> : <DashboardAlerts alerts={derivedAlerts} onNavigateSection={onNavigateSection} />}
    </DashboardPanel>

    <DashboardPanel
      title="Últimos pedidos"
      description="Acesso rápido aos pedidos recentes, com pagamento e logística separados."
      aside={ordersAction ? <button type="button" className="dashboard-v2__text-action" onClick={ordersAction.onClick}>Ver todos os pedidos</button> : undefined}
    >
      {ordersLoading ? <AdminLoadingState>Carregando pedidos...</AdminLoadingState> : ordersError ? <AdminEmptyState title="Pedidos indisponíveis" description="Não foi possível carregar a lista de pedidos agora." /> : recentOrders.length === 0 ? <AdminEmptyState title="Sem pedidos carregados" description="Quando houver pedidos, os mais recentes aparecerão aqui." /> : <div className="dashboard-v2__orders-wrap">
        <table className="dashboard-v2__orders-table">
          <thead><tr><th>Pedido</th><th>Cliente</th><th>Valor</th><th>Pagamento</th><th>Logística</th><th>Data</th></tr></thead>
          <tbody>{recentOrders.map(order => {
            const status = String(order.status ?? "pending");
            const date = safeDate(order.createdAt);
            return <tr key={order.id}>
              <td data-label="Pedido"><button type="button" className="dashboard-v2__order-link" onClick={() => onViewOrder(order.id)}>#{order.id}</button></td>
              <td data-label="Cliente"><span className="dashboard-v2__customer">{order.customerName || order.customerEmail || `Cliente #${order.userId ?? "—"}`}</span></td>
              <td data-label="Valor"><strong className="dashboard-v2__order-amount">{formatPrice(asMoney(order.totalPrice))}</strong></td>
              <td data-label="Pagamento"><PaymentStatusBadge confirmed={order.paymentStatus === "confirmed"} /></td>
              <td data-label="Logística"><OrderStatusBadge status={status} label={getOrderStatusLabel(status)} tone={getOrderStatusTone(status)} /></td>
              <td data-label="Data"><time dateTime={date?.toISOString()}>{formatDateTime(order.createdAt)}</time></td>
            </tr>;
          })}</tbody>
        </table>
      </div>}
    </DashboardPanel>

    <section className="dashboard-v2__main-grid">
      <DashboardPanel title="Financeiro e operação" description="Totais sobre os pedidos carregados. Eles não equivalem a pagamentos recebidos.">
        {ordersLoading || ordersError ? <DashboardLoadOrError isLoading={ordersLoading} label="pedidos" /> : <div className="dashboard-v2__metrics">
          <MetricCard label="Valor total registrado dos pedidos carregados" value={formatPrice(totalOrderValue)} />
          <MetricCard label="Valor médio por pedido carregado" value={averageOrderValue === null ? "—" : formatPrice(averageOrderValue)} />
          <MetricCard label="Aguardando preparação" value={String(paidOrders)} tone="purple" />
          <MetricCard label="Pedidos enviados" value={String(shippedOrders)} tone="status" />
          <MetricCard label="Pedidos cancelados" value={String(cancelledOrders)} tone="danger" />
          <MetricCard label="Destaques ativos" value={promoBannersLoading || promoBannersError ? "—" : `${activeBanners}/${promoBanners.length}`} />
          <MetricCard label="Cupons ativos" value={couponsLoading || couponsError ? "—" : `${activeCoupons}/${coupons.length}`} />
          <MetricCard label="Produtos cadastrados" value={productsLoading || productsError ? "—" : String(products.length)} />
          <MetricCard label="Usuários cadastrados" value={dashboardLoading || dashboardError || !dashboardData ? "—" : String(dashboardData.usersCount ?? 0)} />
          <MetricCard label="Registros de estoque baixo" value={dashboardLoading || dashboardError || !dashboardData ? "—" : String(dashboardData.lowStockCount ?? 0)} tone={Number(dashboardData?.lowStockCount ?? 0) > 0 ? "warning" : "neutral"} />
        </div>}
      </DashboardPanel>

      <DashboardPanel title="Pedidos por status" description="Distribuição dos estados retornados pela gestão.">
        {ordersLoading ? <AdminLoadingState>Carregando status...</AdminLoadingState> : ordersError ? <AdminEmptyState title="Status indisponíveis" description="Não foi possível consultar os pedidos." /> : <div className="dashboard-v2__status-grid">
          {orderStatusSummary.map(item => <div key={item.status} className="dashboard-v2__status-row">
            <AdminStatusBadge dataStatus={item.status} style={getOrderStatusTone(item.status)}>{item.label}</AdminStatusBadge>
            <strong>{item.count}</strong>
          </div>)}
        </div>}
      </DashboardPanel>
    </section>

    <DashboardPanel title="Ações rápidas" description="Atalhos para as áreas operacionais mais usadas.">
      <AdminQuickActions actions={quickActions} />
    </DashboardPanel>

    <section className="dashboard-v2__main-grid dashboard-v2__support-grid">
      <DashboardPanel title="Estoque crítico" description="A prioridade preserva o critério atual do estoque-base; o estoque físico e a disponibilidade das variantes são mostrados separadamente.">
        {productsLoading ? <AdminLoadingState>Carregando produtos...</AdminLoadingState> : productsError ? <AdminEmptyState title="Estoque indisponível" description="Não foi possível consultar os produtos agora." /> : lowStockProducts.length === 0 ? <AdminEmptyState title="Estoque saudável" description="Nenhum produto carregado atende ao filtro atual de estoque baixo." /> : <div className="dashboard-v2__inventory-list">
          {lowStockProducts.map(product => {
            const hasVariants = (product.variants?.length ?? 0) > 0;
            const baseStock = Number(product.stock ?? 0);
            const physicalStock = Number(product.variantAvailability?.physicalStock ?? baseStock);
            const category = product.category ? getCategoryLabel(product.category) : null;
            const availability = product.variantAvailability;
            const variantSummary = hasVariants
              ? availability?.sellableCount == null
                ? "Disponibilidade das variantes indisponível"
                : `${availability.sellableCount} combinação(ões) vendável(is)`
              : "Produto sem variantes; estoque base separado";
            const variantApproval = hasVariants && availability
              ? `${availability.activeCount ?? 0} ativas · ${availability.inactiveCount ?? 0} inativas`
              : null;
            return <button key={product.id} type="button" className="dashboard-v2__inventory-row" onClick={() => onViewProduct(product)} aria-label={`Abrir cadastro do produto ${product.name || product.id}`}>
              <span className="dashboard-v2__inventory-priority" data-priority={baseStock <= 0 ? "empty" : "low"} aria-hidden="true" />
              <span className="dashboard-v2__inventory-copy"><strong>{product.name || `Produto #${product.id}`}</strong><span>#{product.id}{category ? ` · ${category}` : ""}</span></span>
              <span className="dashboard-v2__inventory-state"><strong>{hasVariants ? `${physicalStock} un. físicas nas variantes` : baseStock <= 0 ? "Sem estoque físico" : `${baseStock} un. físicas`}</strong><small>{hasVariants ? `Estoque-base do produto: ${baseStock} · ${variantApproval ? `${variantApproval} · ` : ""}${variantSummary}` : variantSummary}</small></span>
              <span className="dashboard-v2__inventory-action">Abrir cadastro</span>
            </button>;
          })}
        </div>}
      </DashboardPanel>

      <DashboardPanel title="Atividade recente" description="Eventos administrativos com identificador e horário local.">
        {auditLoading ? <AdminLoadingState>Carregando atividade...</AdminLoadingState> : auditError ? <AdminEmptyState title="Atividade indisponível" description="Não foi possível consultar os registros recentes." /> : recentAudit.length === 0 ? <AdminEmptyState title="Sem atividade recente" description="Os próximos eventos administrativos aparecerão aqui." /> : <div className="dashboard-v2__activity-list">
          {recentAudit.map(item => {
            const date = safeDate(item.createdAt);
            return <article key={item.id} className="dashboard-v2__activity-row">
              <span className="dashboard-v2__activity-marker" aria-hidden="true" />
              <div className="dashboard-v2__activity-copy"><strong>{formatAuditAction(item.action)}</strong><span>{auditEntityLabels[item.entity] ?? item.entity}{item.entityId ? ` #${item.entityId}` : ""} · Log #{item.id}</span></div>
              <time dateTime={date?.toISOString()}>{formatDateTime(item.createdAt)}</time>
            </article>;
          })}
        </div>}
      </DashboardPanel>
    </section>

    <details className="dashboard-v2__details">
      <summary>Atendimento de pedidos e status do sistema</summary>
      <div className="dashboard-v2__details-grid">
        <DashboardPanel title="Atendimento de pedidos" description="Contagens por estado logístico retornado pela gestão.">
          {ordersLoading || ordersError ? <DashboardLoadOrError isLoading={ordersLoading} label="pedidos" /> : <div className="dashboard-v2__support-rows">
            <StatusRow label="Aguardando preparação" value={String(paidOrders)} />
            <StatusRow label="Pedidos enviados" value={String(shippedOrders)} />
            <StatusRow label="Pedidos cancelados" value={String(cancelledOrders)} />
          </div>}
        </DashboardPanel>
        <DashboardPanel title="Status do sistema">
          <div className="dashboard-v2__support-rows">
            <StatusRow label="Pedidos aguardando pagamento" value={dashboardLoading || dashboardError || !dashboardData ? "—" : String(dashboardData.pendingOrders ?? 0)} />
            <StatusRow label="Produtos cadastrados" value={dashboardLoading || dashboardError || !dashboardData ? "Não disponível" : `${dashboardData.productsCount ?? 0} itens`} />
            <StatusRow label="Usuários cadastrados" value={dashboardLoading || dashboardError || !dashboardData ? "Não disponível" : `${dashboardData.usersCount ?? 0} usuários`} />
          </div>
        </DashboardPanel>
      </div>
    </details>
  </div>;
}

function MetricCard({ label, value, tone = "neutral" }: { label: string; value: string; tone?: "neutral" | "warning" | "danger" | "purple" | "status" }) {
  return <article className={`dashboard-v2__metric is-${tone}`}><span>{label}</span><strong>{value}</strong></article>;
}

function StatusRow({ label, value }: { label: string; value: string }) {
  return <div className="dashboard-v2__support-row"><span>{label}</span><strong>{value}</strong></div>;
}

function DashboardLoadOrError({ isLoading, label }: { isLoading: boolean; label: string }) {
  return isLoading ? <AdminLoadingState>Carregando {label}...</AdminLoadingState> : <AdminEmptyState title="Dados indisponíveis" description={`Não foi possível consultar ${label} agora.`} />;
}

function DashboardQueryState({ onRetry }: { onRetry?: () => void }) {
  return <div className="dashboard-v2__query-error" role="status"><div><strong>Indicadores indisponíveis</strong><span>Não foi possível carregar o resumo agora.</span></div>{onRetry ? <button type="button" onClick={onRetry}>Tentar novamente</button> : null}</div>;
}

function DashboardAlerts({ alerts, onNavigateSection }: { alerts: DashboardAlert[]; onNavigateSection?: AdminDashboardProps["onNavigateSection"] }) {
  const priority = { danger: 0, warning: 1, neutral: 2 };
  const prioritizedAlerts = [...alerts].sort((a, b) => priority[a.tone] - priority[b.tone]);
  if (alerts.length === 0) return <AdminEmptyState title="Sem alertas agora" description="Nenhum dado carregado exige atenção imediata." />;
  return <div className="dashboard-v2__alert-grid">
    {prioritizedAlerts.map(alert => <article key={alert.title} className={`dashboard-v2__alert is-${alert.tone}`}>
      <span className="dashboard-v2__alert-indicator" aria-hidden="true" />
      <div><strong>{alert.title}</strong><p>{alert.description}</p></div>
      {alert.route && onNavigateSection ? <button type="button" onClick={() => onNavigateSection(alert.route!)}>{alertActions[alert.route]}<span aria-hidden="true">↗</span></button> : null}
    </article>)}
  </div>;
}
