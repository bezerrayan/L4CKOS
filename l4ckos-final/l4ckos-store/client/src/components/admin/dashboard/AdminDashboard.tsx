import type { CSSProperties, ReactNode } from "react";
import { getCategoryLabel } from "../../../lib/productCategories";
import { formatPrice } from "../../../lib/utils";
import {
  AdminEmptyState,
  AdminLoadingState,
  AdminMetricCards,
  AdminQuickActions,
  AdminStatCard,
  AdminStatsGrid,
  AdminStatusBadge,
  AdminSurface,
} from "../AdminUI";

type DashboardOrder = {
  id: number;
  status?: string | null;
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
};

type DashboardPromo = {
  isActive?: boolean | number | null;
};

type DashboardCoupon = {
  isActive?: boolean | number | null;
};

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
};

type OrderStatusSummary = {
  status: string;
  label: string;
  count: number;
};

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
  isMobile: boolean;
  isCompact: boolean;
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
};

function OverviewIcon({ children }: { children: ReactNode }) {
  return (
    <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      {children}
    </svg>
  );
}

function isActiveFlag(value: boolean | number | null | undefined) {
  return value === true || value === 1;
}

function asMoney(cents: number | string | null | undefined) {
  return Number(cents ?? 0) / 100;
}

function formatOrderDate(value: Date | string | null | undefined) {
  if (!value) return "Data não informada";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Data não informada";
  return date.toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });
}

export function AdminDashboard({
  dashboardData,
  dashboardLoading = false,
  dashboardError = false,
  onRetryDashboard,
  isMobile,
  isCompact,
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
}: AdminDashboardProps) {
  const recentOrders = orders.slice(0, 6);
  const lowStockProducts = products.filter(row => row.salesMode !== "PREORDER" && Number(row.stock ?? 0) <= 5).slice(0, 6);
  const totalRevenue = orders.reduce((sum, order) => sum + asMoney(order.totalPrice), 0);
  const averageTicket = orders.length > 0 ? totalRevenue / orders.length : null;
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
      ? [{ title: "Nenhum banner ativo", description: "Há banners cadastrados, mas nenhum está ativo para campanha.", tone: "warning" as const }]
      : []),
    ...(!promoBannersLoading && !promoBannersError && promoBanners.length === 0
      ? [{ title: "Nenhum banner cadastrado", description: "A home ainda não tem banners promocionais gerenciados pelo painel.", tone: "neutral" as const }]
      : []),
    ...(!ordersLoading && !ordersError && ordersWithoutTracking > 0
      ? [{ title: `${ordersWithoutTracking} pedido(s) sem rastreio`, description: "Pedidos pagos/em separação/enviados ainda sem código informado.", tone: "warning" as const }]
      : []),
    ...(!productsLoading && !productsError && productsWithoutImage > 0
      ? [{ title: `${productsWithoutImage} produto(s) sem imagem`, description: "Revise o cadastro visual para manter a vitrine consistente.", tone: "warning" as const }]
      : []),
  ];

  const ordersAction = quickActions.find(action => action.label === "Pedidos");

  return (
    <div
      className="admin-dashboard dashboard-focused"
      style={styles.dashboardStack}
    >
      <section
        className="dashboard-day-summary"
        aria-labelledby="dashboard-day-title"
      >
        <h2 id="dashboard-day-title">Resumo do dia</h2>
        {dashboardLoading ? (
          <AdminLoadingState>Carregando indicadores...</AdminLoadingState>
        ) : dashboardError || !dashboardData ? (
          <DashboardQueryState onRetry={onRetryDashboard} />
        ) : <AdminStatsGrid
          style={{
            gridTemplateColumns: isMobile ? "1fr" : "repeat(3, minmax(0, 1fr))",
          }}
        >
          <AdminStatCard
            label="Valor de pedidos criados hoje e entregues"
            value={formatPrice((dashboardData?.salesToday ?? 0) / 100)}
            hint="Soma dos pedidos entregues criados hoje; não representa confirmação financeira."
            tone="neutral"
            icon={
              <OverviewIcon>
                <path d="M12 20V10"></path>
                <path d="m18 20-6-6-6 6"></path>
                <path d="M6 4h12"></path>
              </OverviewIcon>
            }
          />
          <AdminStatCard
            label="Pedidos pendentes"
            value={String(dashboardData?.pendingOrders ?? 0)}
            hint="Pedidos aguardando pagamento."
            tone="neutral"
            icon={
              <OverviewIcon>
                <circle cx="12" cy="12" r="8"></circle>
                <path d="M12 8v5l3 2"></path>
              </OverviewIcon>
            }
          />
          <AdminStatCard
            label="Pedidos hoje"
            value={String(dashboardData?.ordersToday ?? 0)}
            hint="Criados desde o início do dia calculado no servidor."
            tone="neutral"
            icon={
              <OverviewIcon>
                <path d="M3 6h18"></path>
                <path d="M8 6V3"></path>
                <path d="M16 6V3"></path>
                <rect x="3" y="6" width="18" height="15" rx="2"></rect>
              </OverviewIcon>
            }
          />
        </AdminStatsGrid>}
      </section>

      {ordersLoading || productsLoading ? (
        <AdminSurface title="Precisa de atenção">
          <AdminLoadingState>Verificando pedidos e estoque...</AdminLoadingState>
        </AdminSurface>
      ) : ordersError || productsError ? (
        <AdminSurface title="Precisa de atenção">
          <AdminEmptyState title="Alertas indisponíveis" description="Não foi possível consultar pedidos e estoque para atualizar todos os alertas." />
        </AdminSurface>
      ) : <DashboardAlerts alerts={derivedAlerts} />}

      <AdminSurface
        title="Últimos pedidos"
        aside={
          ordersAction ? (
            <button
              type="button"
              className="dashboard-view-orders"
              onClick={ordersAction.onClick}
            >
              Ver todos os pedidos
            </button>
          ) : undefined
        }
      >
        {ordersLoading ? (
          <AdminLoadingState>Carregando pedidos...</AdminLoadingState>
        ) : ordersError ? (
          <AdminEmptyState title="Pedidos indisponíveis" description="Não foi possível carregar a lista de pedidos agora." />
        ) : recentOrders.length === 0 ? (
          <AdminEmptyState
            title="Sem pedidos carregados"
            description="Quando houver pedidos, os mais recentes aparecerão aqui."
          />
        ) : (
          <div className="dashboard-orderList" style={styles.orderList}>
            {recentOrders.map(order => (
              <button
                key={order.id}
                type="button"
                className="dashboard-orderItemButton"
                style={styles.orderItemButton}
                onClick={() => onViewOrder(order.id)}
              >
                <span
                  className="dashboard-order-main"
                  style={styles.orderItemMain}
                >
                  <strong style={styles.compactListTitle}>
                    Pedido #{order.id}
                  </strong>
                  <span style={styles.compactListMeta}>
                    {order.customerName ||
                      order.customerEmail ||
                      `Cliente #${order.userId}`}
                  </span>
                  <span
                    className="dashboard-order-date"
                    style={styles.compactListMeta}
                  >
                    {formatOrderDate(order.createdAt)}
                  </span>
                </span>
                <span
                  className="dashboard-order-side"
                  style={styles.orderItemSide}
                >
                  <strong style={styles.orderAmount}>
                    {formatPrice(asMoney(order.totalPrice))}
                  </strong>
                  <AdminStatusBadge
                    style={getOrderStatusTone(String(order.status))}
                  >
                    {getOrderStatusLabel(String(order.status))}
                  </AdminStatusBadge>
                </span>
              </button>
            ))}
          </div>
        )}
      </AdminSurface>

      <details className="dashboard-complementary">
        <summary>
          <span className="dashboard-complementary-title">
            Informações complementares
          </span>
          <span className="dashboard-complementary-caption">
            Financeiro, status, ações rápidas, estoque e atividade
          </span>
          <span className="dashboard-disclosure-icon" aria-hidden="true" />
        </summary>
        <div className="dashboard-complementary-content">
          <AdminSurface
            title="Visão financeira e operacional"
            description="Os totais de pedidos incluem todos os status e não equivalem a pagamentos recebidos."
          >
            <AdminMetricCards
              compact
              cards={[
                { label: "Usuários", value: dashboardData ? dashboardData.usersCount ?? 0 : "—" },
                {
                  label: "Produtos cadastrados",
                  value: dashboardData ? dashboardData.productsCount ?? 0 : "—",
                },
                {
                  label: "Estoque baixo",
                  value: dashboardData ? dashboardData.lowStockCount ?? 0 : "—",
                  tone:
                    Number(dashboardData?.lowStockCount ?? 0) > 0
                      ? "warning"
                      : "neutral",
                },
              ]}
            />
            <div className="dashboard-metricGrid" style={styles.metricGrid}>
              <MetricCard
                label="Valor total dos pedidos"
                value={ordersLoading || ordersError ? "—" : formatPrice(totalRevenue)}
              />
              <MetricCard
                label="Média por pedido"
                value={ordersLoading || ordersError || averageTicket === null ? "—" : formatPrice(averageTicket)}
              />
              <MetricCard label="Pedidos com status pago" value={ordersLoading || ordersError ? "—" : String(paidOrders)} />
              <MetricCard
                label="Pedidos enviados"
                value={ordersLoading || ordersError ? "—" : String(shippedOrders)}
              />
              <MetricCard
                label="Cancelados"
                value={ordersLoading || ordersError ? "—" : String(cancelledOrders)}
                tone="danger"
              />
              <MetricCard
                label="Banners ativos"
                value={promoBannersLoading || promoBannersError ? "—" : `${activeBanners}/${promoBanners.length}`}
              />
              <MetricCard
                label="Cupons ativos"
                value={couponsLoading || couponsError ? "—" : `${activeCoupons}/${coupons.length}`}
              />
              <MetricCard
                label="Produtos cadastrados"
                value={productsLoading || productsError ? "—" : String(products.length)}
              />
            </div>
          </AdminSurface>

          <div
            className="dashboard-block-pair"
            style={{
              ...styles.dashboardColumns,
              gridTemplateColumns: isCompact
                ? "1fr"
                : styles.dashboardColumns.gridTemplateColumns,
            }}
          >
            <AdminSurface
              title="Pedidos por status"
              description="Distribuição dos pedidos retornados pela gestão."
            >
              {ordersLoading ? <AdminLoadingState>Carregando status...</AdminLoadingState> : ordersError ? (
                <AdminEmptyState title="Status indisponíveis" description="Não foi possível consultar os pedidos." />
              ) : (
              <div
                className="dashboard-statusSummaryGrid"
                style={styles.statusSummaryGrid}
              >
                {orderStatusSummary.map(item => (
                  <div
                    key={item.status}
                    className="dashboard-statusSummaryCard"
                    style={styles.statusSummaryCard}
                  >
                    <AdminStatusBadge
                      style={{
                        ...getOrderStatusTone(item.status),
                        ...styles.statusSummaryBadge,
                      }}
                    >
                      {item.label}
                    </AdminStatusBadge>
                    <strong style={styles.statusSummaryValue}>
                      {item.count}
                    </strong>
                  </div>
                ))}
              </div>
              )}
            </AdminSurface>

            <AdminSurface
              title="Atendimento de pedidos"
              description="Contagens por situação retornada pela gestão."
            >
              {ordersLoading ? <AdminLoadingState>Carregando pedidos...</AdminLoadingState> : ordersError ? (
                <AdminEmptyState title="Atendimento indisponível" description="Não foi possível consultar os pedidos." />
              ) : <div style={styles.systemStatusList}>
                <StatusRow
                  label="Pedidos pagos para separar"
                  value={String(paidOrders)}
                />
                <StatusRow
                  label="Pedidos enviados"
                  value={String(shippedOrders)}
                />
                <StatusRow
                  label="Pedidos cancelados"
                  value={String(cancelledOrders)}
                />
              </div>}
            </AdminSurface>
          </div>

          <div
            className="dashboard-block-pair"
            style={{
              ...styles.dashboardColumns,
              gridTemplateColumns: isCompact
                ? "1fr"
                : styles.dashboardColumns.gridTemplateColumns,
            }}
          >
            <AdminSurface title="Ações rápidas">
              <AdminQuickActions actions={quickActions} />
            </AdminSurface>

            <AdminSurface title="Status do sistema">
              <div style={styles.systemStatusList}>
                <StatusRow
                  label="Pedidos aguardando pagamento"
                  value={dashboardLoading || dashboardError || !dashboardData ? "—" : String(dashboardData.pendingOrders ?? 0)}
                />
                <StatusRow
                  label="Produtos cadastrados"
                  value={dashboardLoading || dashboardError || !dashboardData ? "Não disponível" : `${dashboardData.productsCount ?? 0} itens`}
                />
                <StatusRow
                  label="Usuários cadastrados"
                  value={dashboardLoading || dashboardError || !dashboardData ? "Não disponível" : `${dashboardData.usersCount ?? 0} usuários`}
                />
              </div>
            </AdminSurface>
          </div>

          <AdminSurface
            title="Produtos com baixo estoque"
            description="Itens com 5 unidades ou menos para priorizar revisão."
          >
            {productsLoading ? (
              <AdminLoadingState>Carregando produtos...</AdminLoadingState>
            ) : productsError ? (
              <AdminEmptyState title="Estoque indisponível" description="Não foi possível consultar os produtos agora." />
            ) : lowStockProducts.length === 0 ? (
              <AdminEmptyState
                title="Estoque saudável"
                description="Nenhum produto carregado está com estoque baixo."
              />
            ) : (
              <div className="dashboard-compactList" style={styles.compactList}>
                {lowStockProducts.map(product => (
                  <button
                    key={product.id}
                    type="button"
                    className="dashboard-compactListItemButton"
                    style={styles.compactListItemButton}
                    onClick={() => onViewProduct(product)}
                  >
                    <span style={styles.compactListTitle}>
                      {product.name || `Produto #${product.id}`}
                    </span>
                    <span style={styles.compactListMeta}>
                      {getCategoryLabel(product.category || "")}
                    </span>
                    <strong
                      style={
                        Number(product.stock ?? 0) <= 0
                          ? styles.stockTextEmpty
                          : styles.stockTextLow
                      }
                    >
                      {Number(product.stock ?? 0) <= 0
                        ? "Sem estoque"
                        : `${product.stock} un.`}
                    </strong>
                  </button>
                ))}
              </div>
            )}
          </AdminSurface>
          <AdminSurface
            title="Atividade recente"
            description="Últimos eventos registrados na trilha de auditoria administrativa."
          >
            {auditLoading ? (
              <AdminLoadingState>Carregando atividade...</AdminLoadingState>
            ) : auditError ? (
              <AdminEmptyState title="Atividade indisponível" description="Não foi possível consultar os registros recentes." />
            ) : recentAudit.length === 0 ? (
              <AdminEmptyState
                title="Sem atividade recente"
                description="Assim que o painel registrar ações administrativas, elas aparecerão aqui."
              />
            ) : (
              <div style={styles.activityList}>
                {recentAudit.map(item => (
                  <div
                    key={item.id}
                    className="dashboard-activityItem"
                    style={styles.activityItem}
                  >
                    <div
                      className="dashboard-activityBullet"
                      style={styles.activityBullet}
                    />
                    <div style={styles.activityContent}>
                      <strong style={styles.activityTitle}>
                        {item.action}
                      </strong>
                      <span style={styles.activityMeta}>
                        {item.entity} {item.entityId ? `#${item.entityId}` : ""}{" "}
                        · {new Date(item.createdAt).toLocaleString("pt-BR")}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </AdminSurface>
        </div>
      </details>
    </div>
  );
}

function MetricCard({ label, value, tone = "neutral" }: { label: string; value: string; tone?: "neutral" | "danger" }) {
  return (
    <div className="dashboard-metricCard" style={{ ...styles.metricCard, ...(tone === "danger" ? styles.metricCardDanger : {}) }}>
      <span style={styles.metricLabel}>{label}</span>
      <strong style={styles.metricValue}>{value}</strong>
    </div>
  );
}

function StatusRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="dashboard-systemStatusRow" style={styles.systemStatusRow}>
      <span style={styles.systemStatusLabel}>{label}</span>
      <strong style={styles.systemStatusValue}>{value}</strong>
    </div>
  );
}

function DashboardQueryState({ onRetry }: { onRetry?: () => void }) {
  return (
    <div className="dashboard-queryError" role="status">
      <div>
        <strong>Indicadores indisponíveis</strong>
        <span>Não foi possível carregar o resumo agora.</span>
      </div>
      {onRetry ? <button type="button" onClick={onRetry}>Tentar novamente</button> : null}
    </div>
  );
}

function DashboardAlerts({ alerts }: { alerts: DashboardAlert[] }) {
  const priority = { danger: 0, warning: 1, neutral: 2 };
  const prioritizedAlerts = [...alerts].sort((a, b) => priority[a.tone] - priority[b.tone]);
  return (
    <AdminSurface title="Precisa de atenção">
      {alerts.length === 0 ? (
        <AdminEmptyState title="Sem alertas agora" description="Nenhum dado carregado exige atenção imediata." />
      ) : (
        <div className="dashboard-alertList" style={styles.alertList}>
          {prioritizedAlerts.map(alert => (
            <div
              key={alert.title}
              className={`dashboard-alert dashboard-alert--${alert.tone}`}
              style={{
                ...styles.alertItem,
                ...(alert.tone === "danger" ? styles.alertItemDanger : alert.tone === "warning" ? styles.alertItemWarning : {}),
              }}
            >
              <strong style={styles.alertTitle}>{alert.title}</strong>
              <span style={styles.alertDescription}>{alert.description}</span>
            </div>
          ))}
        </div>
      )}
    </AdminSurface>
  );
}

const styles: Record<string, CSSProperties> = {
  dashboardStack: {
    display: "grid",
    gap: 20,
  },
  dashboardColumns: {
    display: "grid",
    gridTemplateColumns: "minmax(0, 1.4fr) minmax(280px, 0.8fr)",
    gap: 20,
  },
  metricGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))",
    gap: 12,
  },
  metricCard: {
    display: "grid",
    alignContent: "space-between",
    gap: 10,
    minHeight: 104,
    padding: "15px 16px",
    borderRadius: 13,
    border: "1px solid rgba(255,255,255,0.07)",
    background: "linear-gradient(180deg, rgba(255,255,255,0.018), rgba(255,255,255,0.004)), #090909",
  },
  metricCardDanger: {
    borderColor: "rgba(239,68,68,0.24)",
    background: "linear-gradient(180deg, rgba(239,68,68,0.055), rgba(239,68,68,0.015)), #090909",
  },
  metricLabel: {
    color: "#8f98a6",
    fontSize: 11,
    fontWeight: 800,
    letterSpacing: "0.085em",
    textTransform: "uppercase",
  },
  metricValue: {
    color: "#f8f4ec",
    fontSize: 25,
    lineHeight: 1,
    fontWeight: 900,
  },
  systemStatusList: {
    display: "grid",
    gap: 9,
  },
  systemStatusRow: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 16,
    padding: "12px 14px",
    borderRadius: 11,
    background: "#090909",
    border: "1px solid rgba(255,255,255,0.065)",
  },
  systemStatusLabel: {
    color: "#9ca3af",
    fontSize: 13,
    lineHeight: 1.5,
  },
  systemStatusValue: {
    color: "#f8f4ec",
    fontSize: 16,
  },
  statusSummaryGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(142px, 1fr))",
    gap: 10,
  },
  statusSummaryCard: {
    display: "grid",
    gap: 10,
    justifyItems: "start",
    padding: "13px",
    borderRadius: 12,
    border: "1px solid rgba(255,255,255,0.065)",
    background: "#090909",
    minWidth: 0,
    overflow: "hidden",
  },
  statusSummaryBadge: {
    maxWidth: "100%",
    whiteSpace: "normal",
    lineHeight: 1.25,
    textAlign: "center",
    paddingTop: 7,
    paddingBottom: 7,
  },
  statusSummaryValue: {
    color: "#f8f4ec",
    fontSize: 25,
    lineHeight: 1,
    fontWeight: 900,
  },
  alertList: {
    display: "grid",
    gap: 9,
  },
  alertItem: {
    display: "grid",
    gap: 6,
    padding: "12px 13px",
    borderRadius: 12,
    border: "1px solid rgba(255,255,255,0.07)",
    background: "#090909",
  },
  alertItemWarning: {
    borderColor: "rgba(245,158,11,0.22)",
    background: "linear-gradient(180deg, rgba(245,158,11,0.055), rgba(245,158,11,0.015)), #090909",
  },
  alertItemDanger: {
    borderColor: "rgba(239,68,68,0.28)",
    background: "linear-gradient(180deg, rgba(239,68,68,0.065), rgba(239,68,68,0.016)), #090909",
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
  orderList: {
    display: "grid",
    gap: 9,
  },
  orderItemButton: {
    display: "grid",
    gridTemplateColumns: "minmax(0, 1fr) auto",
    gap: 12,
    alignItems: "center",
    width: "100%",
    padding: "12px 13px",
    borderRadius: 12,
    border: "1px solid rgba(255,255,255,0.065)",
    background: "#090909",
    color: "#f8f4ec",
    cursor: "pointer",
    textAlign: "left",
  },
  orderItemMain: {
    display: "grid",
    gap: 4,
    minWidth: 0,
  },
  orderItemSide: {
    display: "grid",
    justifyItems: "end",
    gap: 8,
  },
  orderAmount: {
    color: "#f8f4ec",
    fontSize: 14,
    lineHeight: 1,
  },
  compactList: {
    display: "grid",
    gap: 9,
  },
  compactListItemButton: {
    display: "grid",
    gridTemplateColumns: "minmax(0, 1fr) auto",
    gap: "6px 12px",
    alignItems: "center",
    width: "100%",
    padding: "12px 13px",
    borderRadius: 12,
    border: "1px solid rgba(255,255,255,0.065)",
    background: "#090909",
    color: "#f8f4ec",
    cursor: "pointer",
    textAlign: "left",
  },
  compactListTitle: {
    color: "#f8f4ec",
    fontSize: 14,
    fontWeight: 800,
    lineHeight: 1.35,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  compactListMeta: {
    color: "#9ca3af",
    fontSize: 12,
    lineHeight: 1.45,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  stockTextLow: {
    color: "#fbbf24",
    fontSize: 13,
    fontWeight: 900,
  },
  stockTextEmpty: {
    color: "#f87171",
    fontSize: 13,
    fontWeight: 900,
  },
  activityList: {
    display: "grid",
    gap: 0,
  },
  activityItem: {
    display: "grid",
    gridTemplateColumns: "8px 1fr",
    gap: 12,
    alignItems: "flex-start",
    padding: "12px 0",
    borderBottom: "1px solid rgba(255,255,255,0.07)",
  },
  activityBullet: {
    width: 8,
    height: 8,
    marginTop: 6,
    borderRadius: "50%",
    background: "#ef4444",
    opacity: 0.75,
  },
  activityContent: {
    display: "grid",
    gap: 4,
  },
  activityTitle: {
    color: "#f8f4ec",
    fontSize: 14,
  },
  activityMeta: {
    color: "#8b949e",
    fontSize: 12,
    lineHeight: 1.5,
  },
};
