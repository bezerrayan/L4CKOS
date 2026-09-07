import { useNavigate } from "react-router-dom";
import Admin, { type AdminSection } from "../Admin";

const sectionRoutes: Record<AdminSection, string> = {
  overview: "/gestao",
  orders: "/gestao/pedidos",
  products: "/gestao/catalogo/produtos",
  customers: "/gestao/clientes",
  promos: "/gestao/marketing/promocoes",
  coupons: "/gestao/marketing/cupons",
  reviews: "/gestao/avaliacoes",
  reports: "/gestao/relatorios",
  audit: "/gestao/operacoes/auditoria",
  backup: "/gestao/operacoes/backup",
  settings: "/gestao/operacoes/configuracoes",
};

export function LegacyAdminSectionPage({ section }: { section: AdminSection }) {
  const navigate = useNavigate();
  return <Admin controlledSection={section} onSectionChange={next => navigate(sectionRoutes[next])} />;
}
