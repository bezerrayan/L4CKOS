import { Suspense, lazy } from "react";
import { BrowserRouter, Navigate, Route, Routes, useLocation } from "react-router-dom";
import Footer from "./components/Footer";
import Header from "./components/Header";
import { useUser } from "./contexts/UserContext";
import { useIsMobile } from "./hooks/useIsMobile";
import { siteMode } from "./config/site";

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
const Admin = lazy(() => import("./pages/Admin"));
const Sobre = lazy(() => import("./pages/Sobre"));
const Contato = lazy(() => import("./pages/Contato"));
const FAQs = lazy(() => import("./pages/FAQs"));
const Termos = lazy(() => import("./pages/Termos"));
const Privacidade = lazy(() => import("./pages/Privacidade"));
const NotFound = lazy(() => import("./pages/NotFound"));
const Forbidden = lazy(() => import("./pages/Forbidden"));
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
  const location = useLocation();

  if (isLoading) {
    return <RouteFallback />;
  }

  if (!isAuthenticated) {
    return <Navigate to={`/entrar?next=${encodeURIComponent(location.pathname)}`} replace />;
  }

  if (user?.role !== "admin") {
    return <Forbidden />;
  }

  return <Admin />;
}

function AdminLegacyRoute() {
  const { user, isAuthenticated, isLoading } = useUser();

  if (isLoading) {
    return <RouteFallback />;
  }

  if (!isAuthenticated) {
    return <Navigate to="/entrar?next=%2Fgestao" replace />;
  }

  if (user?.role !== "admin") {
    return <Forbidden />;
  }

  return <Navigate to="/gestao" replace />;
}

function AppRoutes() {
  const isMobile = useIsMobile(980);
  const location = useLocation();
  const { user, isAuthenticated, isLoading } = useUser();
  const comingSoonEnabled = siteMode === "coming-soon";
  const isAdmin = isAuthenticated && user?.role === "admin";
  const comingSoonAllowedRoutes = new Set(["/em-breve", "/login", "/entrar", "/cadastro", "/esqueci-senha", "/redefinir-senha", "/gestao", "/admin"]);
  const isAllowedDuringComingSoon = comingSoonAllowedRoutes.has(location.pathname);

  if (comingSoonEnabled && !isAllowedDuringComingSoon) {
    if (isLoading) return <ComingSoon />;
    if (!isAdmin) return <ComingSoon />;
  }

  return (
    <>
      <Header />

      <div
        style={{
          minHeight: isMobile ? "calc(100vh - 150px)" : "calc(100vh - 170px)",
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
            <Route path="/em-breve" element={<ComingSoon />} />
            <Route path="/produtos" element={<Produtos />} />
            <Route path="/categorias/:categorySlug" element={<Produtos />} />
            <Route path="/produto/:id" element={<ProductDetail />} />
            <Route path="/favoritos" element={<Favoritos />} />
            <Route path="/carrinho" element={<Carrinho />} />
            <Route path="/checkout" element={<Pagamento />} />
            <Route path="/login" element={<Login />} />
            <Route path="/entrar" element={<Login />} />
            <Route path="/cadastro" element={<Cadastro />} />
            <Route path="/esqueci-senha" element={<EsqueciSenha />} />
            <Route path="/redefinir-senha" element={<RedefinirSenha />} />
            <Route path="/perfil" element={<Perfil />} />
            <Route path="/meus-pedidos" element={<MeusPedidos />} />
            <Route path="/meus-pedidos/:id" element={<PedidoDetalhe />} />
            <Route path="/acompanhar-pedido" element={<AcompanharPedido />} />
            <Route path="/gestao" element={<AdminRoute />} />
            <Route path="/admin" element={<AdminLegacyRoute />} />
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

      <Footer />
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
