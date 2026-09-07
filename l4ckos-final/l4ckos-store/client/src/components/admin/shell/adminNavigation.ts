import type { LucideIcon } from "lucide-react";
import {
  BarChart3,
  ClipboardList,
  FolderKanban,
  Home,
  Megaphone,
  Settings,
  Star,
  Users,
} from "lucide-react";

export type AdminNavigationItem = {
  label: string;
  to: string;
  icon: LucideIcon;
  match?: (pathname: string) => boolean;
};

export type AdminNavigationGroup = {
  label?: string;
  items: AdminNavigationItem[];
};

export const adminNavigation: AdminNavigationGroup[] = [
  {
    items: [{ label: "Visão geral", to: "/gestao", icon: Home, match: pathname => pathname === "/gestao" }],
  },
  {
    label: "Operação",
    items: [
      { label: "Pedidos", to: "/gestao/pedidos", icon: ClipboardList, match: pathname => pathname.startsWith("/gestao/pedidos") },
      { label: "Catálogo", to: "/gestao/catalogo/produtos", icon: FolderKanban, match: pathname => pathname.startsWith("/gestao/catalogo") },
      { label: "Clientes", to: "/gestao/clientes", icon: Users, match: pathname => pathname.startsWith("/gestao/clientes") },
      { label: "Avaliações", to: "/gestao/avaliacoes", icon: Star, match: pathname => pathname.startsWith("/gestao/avaliacoes") },
    ],
  },
  {
    label: "Crescimento",
    items: [
      { label: "Marketing", to: "/gestao/marketing", icon: Megaphone, match: pathname => pathname.startsWith("/gestao/marketing") },
      { label: "Relatórios", to: "/gestao/relatorios", icon: BarChart3, match: pathname => pathname.startsWith("/gestao/relatorios") },
    ],
  },
  {
    label: "Sistema",
    items: [{ label: "Operações", to: "/gestao/operacoes", icon: Settings, match: pathname => pathname.startsWith("/gestao/operacoes") }],
  },
];

type Breadcrumb = { label: string; to?: string };

const exactBreadcrumbs: Record<string, Breadcrumb[]> = {
  "/gestao": [{ label: "Visão geral" }],
  "/gestao/pedidos": [{ label: "Pedidos" }],
  "/gestao/catalogo": [{ label: "Catálogo" }],
  "/gestao/catalogo/produtos": [{ label: "Catálogo", to: "/gestao/catalogo/produtos" }, { label: "Produtos" }],
  "/gestao/catalogo/produtos/novo": [{ label: "Catálogo", to: "/gestao/catalogo/produtos" }, { label: "Produtos", to: "/gestao/catalogo/produtos" }, { label: "Novo produto" }],
  "/gestao/catalogo/estoque": [{ label: "Catálogo", to: "/gestao/catalogo/produtos" }, { label: "Estoque" }],
  "/gestao/clientes": [{ label: "Clientes" }],
  "/gestao/marketing": [{ label: "Marketing" }],
  "/gestao/marketing/promocoes": [{ label: "Marketing", to: "/gestao/marketing" }, { label: "Promoções" }],
  "/gestao/marketing/cupons": [{ label: "Marketing", to: "/gestao/marketing" }, { label: "Cupons" }],
  "/gestao/marketing/campanhas": [{ label: "Marketing", to: "/gestao/marketing" }, { label: "Campanhas" }],
  "/gestao/avaliacoes": [{ label: "Avaliações" }],
  "/gestao/relatorios": [{ label: "Relatórios" }],
  "/gestao/operacoes": [{ label: "Operações" }],
  "/gestao/operacoes/auditoria": [{ label: "Operações", to: "/gestao/operacoes" }, { label: "Auditoria" }],
  "/gestao/operacoes/backup": [{ label: "Operações", to: "/gestao/operacoes" }, { label: "Backup" }],
  "/gestao/operacoes/configuracoes": [{ label: "Operações", to: "/gestao/operacoes" }, { label: "Configurações" }],
};

export function getAdminBreadcrumbs(pathname: string): Breadcrumb[] {
  if (exactBreadcrumbs[pathname]) return exactBreadcrumbs[pathname];
  if (/^\/gestao\/pedidos\/\d+$/.test(pathname)) return [{ label: "Pedidos", to: "/gestao/pedidos" }, { label: "Pedido" }];
  if (/^\/gestao\/clientes\/\d+$/.test(pathname)) return [{ label: "Clientes", to: "/gestao/clientes" }, { label: "Cliente" }];
  if (/^\/gestao\/catalogo\/produtos\/\d+$/.test(pathname)) return [{ label: "Catálogo", to: "/gestao/catalogo/produtos" }, { label: "Produtos", to: "/gestao/catalogo/produtos" }, { label: "Produto" }];
  return [{ label: "Gestão" }];
}

export function getAdminPageTitle(pathname: string) {
  const crumbs = getAdminBreadcrumbs(pathname);
  return crumbs.at(-1)?.label ?? "Gestão";
}
