import { Suspense, lazy } from "react";
import { BrowserRouter, Navigate, Route, Routes, useLocation } from "react-router-dom";
import Footer from "./components/Footer";
import Header from "./components/Header";
import CartDrawer from "./components/CartDrawer";
import CookiePreferences from "./components/CookiePreferences";
import { useUser } from "./contexts/UserContext";
import { useIsMobile } from "./hooks/useIsMobile";
import { AdminShell } from "./components/admin/shell/AdminShell";
import { AdminRoutePlaceholder } from "./pages/admin/AdminRoutePlaceholder";
import { DashboardPage } from "./pages/admin/DashboardPage";
import { CustomersPage } from "./pages/admin/CustomersPage";
import { ReviewsPage } from "./pages/admin/ReviewsPage";
import { ReportsPage } from "./pages/admin/ReportsPage";
import { AuditPage } from "./pages/admin/AuditPage";
import { BackupPage } from "./pages/admin/BackupPage";
import { SettingsPage } from "./pages/admin/SettingsPage";
import { MarketingPage } from "./pages/admin/MarketingPage";
import { OperationsPage } from "./pages/admin/OperationsPage";
import { CouponsPage } from "./pages/admin/CouponsPage";
import { PromotionsPage } from "./pages/admin/PromotionsPage";
import { OrdersPage } from "./pages/admin/OrdersPage";
import { ProductsPage } from "./pages/admin/ProductsPage";

const Home = lazy(() => import("./pages/Home"));
const Produtos = lazy(() => import("./pages/Produtos"));
const ProductDetail = lazy(() => import("./pages/ProductDetail"));
const Carrinho = lazy(() => import("./pages/Carrinho"));
const Pagamento = lazy(() => import("./pages/Pagamento"));
const Favoritos = lazy(() => import("./pages/Favoritos"));
const Login = lazy(() => import("./pages/Login"));
const Cadastro = lazy(() => import("./pages/Cadastro"));
const EsqueciSenha = lazy(() => import("./pages/EsqueciSenha"));
const RedefinirSenha = lazy(() => import("./pages/RedefinirSenha"));
const Perfil = lazy(() => import("./pages/Perfil"));
const Sobre = lazy(() => import("./pages/Sobre"));
const Contato = lazy(() => import("./pages/Contato"));
const FAQs = lazy(() => import("./pages/FAQs"));
const Termos = lazy(() => import("./pages/Termos"));
const Privacidade = lazy(() => import("./pages/Privacidade"));
const NotFound = lazy(() => import("./pages/NotFound"));
const MeusPedidos = lazy(() => import("./pages/MeusPedidos"));
const AcompanharPedido = lazy(() => import("./pages/AcompanharPedido"));
const TrocasDevolucoes = lazy(() => import("./pages/TrocasDevolucoes"));
const PedidoDetalhe = lazy(() => import("./pages/PedidoDetalhe"));
const ComingSoon = lazy(() => import("./pages/ComingSoon"));

function RouteFallback() {
  return (
    <div
      className="l4-page-shell"
      style={{
        minHeight: "50vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        color: "#9ca3af",
        fontSize: 14,
      }}
    >
      Carregando página...
    </div>
  );
}

function AdminRoute() {
  const { user, isAuthenticated, isLoading } = useUser();

  if (isLoading) {
    return <RouteFallback />;
  }

  if (!isAuthenticated || user?.role !== "admin") {
    return <NotFound />;
  }

  return <AdminShell />;
}

function AppRoutes() {
  const isMobile = useIsMobile(980);
  const location = useLocation();
  const { user, isAuthenticated, isLoading } = useUser();
  const comingSoonRaw = String(import.meta.env.VITE_COMING_SOON ?? "false")
    .trim()
    .toLowerCase()
    .replace(/[^a-z]/g, "");
  const comingSoonEnabled = comingSoonRaw === "true";
  const isCheckoutRoute = location.pathname === "/checkout";
  const isAdminRoute = location.pathname === "/admin" || location.pathname.startsWith("/gestao");
  const isAdmin = isAuthenticated && user?.role === "admin";
  const comingSoonAllowedRoutes = new Set(["/login", "/cadastro", "/esqueci-senha", "/redefinir-senha"]);
  const isAllowedDuringComingSoon = comingSoonAllowedRoutes.has(location.pathname);

  if (comingSoonEnabled && !isAllowedDuringComingSoon) {
    if (isLoading) return <ComingSoon />;
    if (!isAdmin) return <ComingSoon />;
  }

  return (
    <>
      {!isCheckoutRoute && !isAdminRoute ? <Header /> : null}

      <div
        style={{
          minHeight: isCheckoutRoute || isAdminRoute ? "100vh" : isMobile ? "calc(100vh - 150px)" : "calc(100vh - 170px)",
          margin: "0 auto",
          padding: "0",
          width: "100%",
          overflowX: "clip",
        }}
        className="l4-page-shell"
      >
        <Suspense fallback={<RouteFallback />}>
          <Routes>
            <Route path="/" element={<Home />} />
            <Route path="/produtos" element={<Produtos />} />
            <Route path="/categorias/:categorySlug" element={<Produtos />} />
            <Route path="/produto/:id" element={<ProductDetail />} />
            <Route path="/favoritos" element={<Favoritos />} />
            <Route path="/carrinho" element={<Carrinho />} />
            <Route path="/checkout" element={<Pagamento />} />
            <Route path="/login" element={<Login />} />
            <Route path="/cadastro" element={<Cadastro />} />
            <Route path="/esqueci-senha" element={<EsqueciSenha />} />
            <Route path="/redefinir-senha" element={<RedefinirSenha />} />
            <Route path="/perfil" element={<Perfil />} />
            <Route path="/meus-pedidos" element={<MeusPedidos />} />
            <Route path="/meus-pedidos/:id" element={<PedidoDetalhe />} />
            <Route path="/acompanhar-pedido" element={<AcompanharPedido />} />
            <Route path="/admin/*" element={<Navigate replace to="/gestao" />} />
            <Route path="/gestao" element={<AdminRoute />}>
              <Route index element={<DashboardPage />} />
              <Route path="pedidos" element={<OrdersPage />} />
              <Route path="pedidos/:id" element={<AdminRoutePlaceholder title="Pedido" description="O detalhe dedicado de pedidos será extraído em uma próxima fase. A gestão operacional continua disponível na lista atual." returnTo="/gestao/pedidos" returnLabel="Voltar para pedidos" />} />
              <Route path="catalogo" element={<Navigate replace to="/gestao/catalogo/produtos" />} />
              <Route path="catalogo/produtos" element={<ProductsPage />} />
              <Route path="catalogo/produtos/novo" element={<ProductsPage />} />
              <Route path="catalogo/produtos/:id" element={<AdminRoutePlaceholder title="Produto" description="A edição continua disponível na lista atual de produtos enquanto a página dedicada não é extraída." returnTo="/gestao/catalogo/produtos" returnLabel="Abrir produtos" />} />
              <Route path="catalogo/estoque" element={<AdminRoutePlaceholder title="Estoque" description="A visão operacional de inventário será extraída em uma próxima fase. A edição por variante continua disponível em Produtos." returnTo="/gestao/catalogo/produtos" returnLabel="Abrir produtos" />} />
              <Route path="clientes" element={<CustomersPage />} />
              <Route path="clientes/:id" element={<AdminRoutePlaceholder title="Cliente" description="O detalhe de cliente será extraído em fase posterior. As ações atuais continuam na lista de clientes." returnTo="/gestao/clientes" returnLabel="Voltar para clientes" />} />
              <Route path="marketing" element={<MarketingPage />} />
              <Route path="marketing/promocoes" element={<PromotionsPage />} />
              <Route path="marketing/cupons" element={<CouponsPage />} />
              <Route path="marketing/campanhas" element={<Navigate replace to="/gestao/marketing/cupons" />} />
              <Route path="avaliacoes" element={<ReviewsPage />} />
              <Route path="relatorios" element={<ReportsPage />} />
              <Route path="operacoes" element={<OperationsPage />} />
              <Route path="operacoes/auditoria" element={<AuditPage />} />
              <Route path="operacoes/backup" element={<BackupPage />} />
              <Route path="operacoes/configuracoes" element={<SettingsPage />} />
              <Route path="*" element={<Navigate replace to="/gestao" />} />
            </Route>
            <Route path="/sobre" element={<Sobre />} />
            <Route path="/contato" element={<Contato />} />
            <Route path="/faqs" element={<FAQs />} />
            <Route path="/trocas-e-devolucoes" element={<TrocasDevolucoes />} />
            <Route path="/termos" element={<Termos />} />
            <Route path="/privacidade" element={<Privacidade />} />
            <Route path="*" element={<NotFound />} />
          </Routes>
        </Suspense>
      </div>

      {!isCheckoutRoute && !isAdminRoute ? <Footer /> : null}
      <CartDrawer />
      <CookiePreferences />
    </>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <AppRoutes />
    </BrowserRouter>
  );
}
