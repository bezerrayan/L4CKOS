import { useEffect, useRef, useState } from "react";
import { Menu } from "lucide-react";
import { useIsMobile } from "../hooks/useIsMobile";
import { AdminSidebarProfile } from "../components/admin/AdminSidebarProfile";
import { AdminSettingsUI } from "../components/admin/settings/AdminSettingsUI";
import "../components/admin/AdminOrdersVisualPreview.css";
import "../components/admin/AdminSettingsVisualPreview.css";
import "../components/admin/AdminStage1.css";

const adminNavigation = [
  { group: "Visão geral", items: ["Dashboard / KPIs"] },
  { group: "Operação", items: ["Pedidos", "Produtos", "Clientes", "Lotes / Pré-venda"] },
  { group: "Comercial", items: ["Promoções", "Cupons", "Avaliações"] },
  { group: "Sistema", items: ["Relatórios", "Auditoria", "Backup", "Configurações"] },
];

// Fixture deliberadamente segura para revisão visual. A rota dev-only não consulta a API.
const settingsPreviewRuntime = {
  mode: "read-only" as const,
  generatedAt: "2026-10-21T15:00:00.000Z",
  environment: {
    nodeEnv: "non-production",
    frontendUrlConfigured: true,
    databaseConfigured: true,
  },
  integrations: {
    asaas: { status: "configured" as const, configuredCount: 1, expectedCount: 4 },
    melhorEnvio: { status: "partial" as const, configuredCount: 1, expectedCount: 3 },
    resend: { status: "configured" as const, configuredCount: 1, expectedCount: 6 },
    googleOAuth: { status: "missing" as const, configuredCount: 0, expectedCount: 3 },
    database: { status: "configured" as const, configuredCount: 1, expectedCount: 1 },
    frontend: { status: "configured" as const, configuredCount: 1, expectedCount: 1 },
  },
  security: {
    secretsExposed: false,
    editable: false,
    source: "server-environment-presence",
  },
};

const navigationTargets: Record<string, string> = {
  Produtos: "products",
  "Destaques da Home": "promos",
  Pedidos: "orders",
  Cupons: "coupons",
};

export default function AdminSettingsVisualPreview() {
  const previewQuery = new URLSearchParams(window.location.search);
  const tabValue = previewQuery.get("section");
  const initialTab = tabValue === "integrations" || tabValue === "environment" || tabValue === "outside" ? tabValue : "overview";
  const statusMode = previewQuery.get("status");
  const mobile = useIsMobile(900);
  const [menuOpen, setMenuOpen] = useState(false);
  const [navigationNote, setNavigationNote] = useState("");
  const menuTriggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLElement>(null);

  useEffect(() => {
    if (!menuOpen || !mobile) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    menuRef.current?.querySelector<HTMLElement>(".orders-menu-close")?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        setMenuOpen(false);
        menuTriggerRef.current?.focus();
        return;
      }
      if (event.key !== "Tab" || !menuRef.current) return;
      const focusable = [...menuRef.current.querySelectorAll<HTMLElement>('button:not([disabled])')].filter(item => item.offsetParent !== null);
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [menuOpen, mobile]);

  const closeMenu = () => {
    setMenuOpen(false);
    menuTriggerRef.current?.focus();
  };

  return (
    <div className="l4-orders-preview l4-settings-preview">
      {menuOpen && mobile ? <button className="orders-menu-backdrop" type="button" aria-label="Fechar navegação administrativa" onClick={closeMenu} /> : null}
      <aside className={`orders-sidebar${menuOpen ? " is-open" : ""}`} id="settings-preview-navigation" ref={menuRef} aria-label="Navegação administrativa" inert={mobile && !menuOpen}>
        <div className="l4-admin-brand"><strong>L4CKOS</strong><span>GESTÃO</span><small>PRÉVIA LOCAL</small></div>
        <button type="button" className="orders-menu-close" onClick={closeMenu}>Fechar menu</button>
        <nav className="orders-nav-scroll" aria-label="Seções da gestão">
          {adminNavigation.map(group => (
            <section className="orders-nav-group" key={group.group} aria-label={group.group}>
              <h2>{group.group}</h2>
              {group.items.map(item => <button key={item} type="button" aria-current={item === "Configurações" ? "page" : undefined} className={item === "Configurações" ? "" : "orders-nav-inactive"} onClick={() => { if (item === "Configurações" && mobile) closeMenu(); }}>{item}</button>)}
            </section>
          ))}
        </nav>
        <AdminSidebarProfile name="Conta demonstrativa" email="conta-demo@example.test" preview />
      </aside>

      <main className="orders-main-column">
        <div className="orders-preview-banner">
          <span><strong>AMBIENTE DE DEMONSTRAÇÃO</strong><span className="orders-preview-divider">·</span>Fixture fictícia, sem API</span>
          <span className="orders-preview-fake-label">A tela real usa admin.settingsStatus</span>
        </div>
        {mobile ? <button ref={menuTriggerRef} type="button" className="orders-mobile-menu-trigger" aria-expanded={menuOpen} aria-controls="settings-preview-navigation" onClick={() => setMenuOpen(true)}><Menu size={18} /> Menu administrativo</button> : null}
        {navigationNote ? <p className="settings-preview-nav-note" role="status">{navigationNote}</p> : null}
        <AdminSettingsUI
          initialTab={initialTab}
          runtimeStatus={statusMode === "missing" || statusMode === "error" ? undefined : settingsPreviewRuntime}
          runtimeStatusLoading={statusMode === "loading"}
          runtimeStatusError={statusMode === "error"}
          onSelectSection={section => setNavigationNote(`Prévia de navegação local para a área “${Object.keys(navigationTargets).find(label => navigationTargets[label] === section) ?? section}”.`)}
        />
      </main>
    </div>
  );
}
