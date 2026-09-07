import { useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { trpc } from "../../lib/trpc";
import { useIsMobile } from "../../hooks/useIsMobile";
import { AdminDashboard } from "../../components/admin/dashboard/AdminDashboard";

/** Route-owned dashboard composition. Financial and logistics fields remain the canonical RC DTO fields. */
export function DashboardPage() {
  const navigate = useNavigate();
  const isMobile = useIsMobile();
  const isCompact = useIsMobile(1180);
  const dashboardQuery = trpc.admin.dashboard.useQuery();
  const ordersQuery = trpc.admin.ordersList.useQuery();
  const productsQuery = trpc.admin.productsList.useQuery();
  const promoBannersQuery = trpc.admin.promoBannersList.useQuery();
  const couponsQuery = trpc.admin.couponsList.useQuery();
  const auditQuery = trpc.admin.auditList.useQuery({ limit: 200 });
  const inventoryExceptionsQuery = trpc.admin.inventoryExceptions.useQuery();

  const orders = useMemo(() => [...(ordersQuery.data ?? [])].sort((a, b) => b.id - a.id), [ordersQuery.data]);
  const products = useMemo(() => [...(productsQuery.data ?? [])].sort((a, b) => b.id - a.id), [productsQuery.data]);
  const recentAudit = useMemo(() => (auditQuery.data ?? []).slice(0, 5), [auditQuery.data]);
  const quickActions = useMemo(() => [
    { label: "Novo produto", caption: "Cadastre ou atualize o catálogo", onClick: () => navigate("/gestao/catalogo/produtos/novo") },
    { label: "Pedidos", caption: "Acompanhe status e rastreio", onClick: () => navigate("/gestao/pedidos") },
    { label: "Clientes", caption: "Revise VIP, bloqueios e perfis", onClick: () => navigate("/gestao/clientes") },
    { label: "Cupons", caption: "Gerencie promoções e descontos", onClick: () => navigate("/gestao/marketing/cupons") },
  ], [navigate]);

  return <AdminDashboard
    dashboardData={dashboardQuery.data}
    isMobile={isMobile}
    isCompact={isCompact}
    orders={orders}
    products={products}
    promoBanners={promoBannersQuery.data ?? []}
    coupons={couponsQuery.data ?? []}
    recentAudit={recentAudit}
    quickActions={quickActions}
    ordersLoading={ordersQuery.isLoading}
    productsLoading={productsQuery.isLoading}
    inventoryExceptions={inventoryExceptionsQuery.data?.length ?? 0}
    onViewOrder={id => navigate(`/gestao/pedidos/${id}`)}
    onViewProduct={product => navigate(`/gestao/catalogo/produtos/${product.id}`)}
  />;
}
