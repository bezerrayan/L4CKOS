import { ChevronLeft, Menu, Store, X } from "lucide-react";
import { NavLink, useLocation } from "react-router-dom";
import type { CSSProperties } from "react";
import { adminNavigation } from "./adminNavigation";

export function AdminSidebar({ collapsed, mobileOpen, isMobile, onToggleCollapsed, onCloseMobile }: { collapsed: boolean; mobileOpen: boolean; isMobile: boolean; onToggleCollapsed: () => void; onCloseMobile: () => void }) {
  const { pathname } = useLocation();
  return <>
    {isMobile ? <button type="button" aria-label="Abrir navegação administrativa" aria-expanded={mobileOpen} onClick={onToggleCollapsed} style={styles.mobileTrigger}><Menu size={20} /></button> : null}
    {isMobile && mobileOpen ? <button type="button" aria-label="Fechar navegação administrativa" onClick={onCloseMobile} style={styles.backdrop} /> : null}
    <aside aria-label="Navegação administrativa" style={{ ...styles.sidebar, ...(collapsed ? styles.sidebarCollapsed : {}), ...(isMobile ? styles.sidebarMobile : {}), ...(mobileOpen ? styles.sidebarMobileOpen : {}) }}>
      <div style={styles.brandRow}>
        <NavLink to="/gestao" onClick={onCloseMobile} style={styles.brand} aria-label="L4CKOS Admin, visão geral">
          <span style={styles.brandMark}>L4</span>
          {!collapsed ? <span><strong style={styles.brandName}>L4CKOS</strong><small style={styles.brandSubtitle}>ADMIN</small></span> : null}
        </NavLink>
        <button type="button" aria-label={collapsed ? "Expandir menu" : "Recolher menu"} onClick={onToggleCollapsed} style={styles.collapseButton}>
          {mobileOpen ? <X size={18} /> : <ChevronLeft size={18} style={collapsed ? { transform: "rotate(180deg)" } : undefined} />}
        </button>
      </div>
      <nav style={styles.navigation}>
        {adminNavigation.map((group, index) => <div key={group.label ?? `principal-${index}`} style={styles.group}>
          {group.label && !collapsed ? <span style={styles.groupLabel}>{group.label}</span> : null}
          {group.items.map(item => <NavLink key={item.to} to={item.to} onClick={onCloseMobile} style={({ isActive }) => ({ ...styles.link, ...((item.match ? item.match(pathname) : isActive) ? styles.linkActive : {}) })} aria-current={item.match?.(pathname) ? "page" : undefined} title={collapsed ? item.label : undefined}>
            <item.icon size={18} aria-hidden="true" />
            {!collapsed ? <span>{item.label}</span> : null}
          </NavLink>)}
        </div>)}
      </nav>
      {!collapsed ? <a href="/" style={styles.storeLink}><Store size={16} aria-hidden="true" /> Voltar à loja</a> : null}
    </aside>
  </>;
}

const styles: Record<string, CSSProperties> = {
  mobileTrigger: { display: "inline-flex", position: "fixed", zIndex: 52, top: 15, left: 15, width: 40, height: 40, border: "1px solid rgba(255,255,255,.12)", borderRadius: 10, background: "#111", color: "#f8f4ec", alignItems: "center", justifyContent: "center", cursor: "pointer" },
  backdrop: { display: "block", position: "fixed", zIndex: 49, inset: 0, border: 0, background: "rgba(0,0,0,.58)" },
  sidebar: { position: "sticky", top: 0, zIndex: 50, width: 252, height: "100vh", flex: "0 0 252px", display: "flex", flexDirection: "column", padding: "18px 12px", borderRight: "1px solid rgba(255,255,255,.08)", background: "linear-gradient(180deg, #101010 0%, #090909 100%)", transition: "width .18s ease, flex-basis .18s ease" },
  sidebarCollapsed: { width: 76, flexBasis: 76, paddingInline: 11 },
  sidebarMobile: { position: "fixed", left: 0, transform: "translateX(-105%)", width: 274, height: "100dvh", transition: "transform .2s ease" },
  sidebarMobileOpen: { transform: "translateX(0)" },
  brandRow: { display: "flex", alignItems: "center", justifyContent: "space-between", minHeight: 46, gap: 8, marginBottom: 24 },
  brand: { display: "inline-flex", alignItems: "center", gap: 10, minWidth: 0, color: "#f8f4ec", textDecoration: "none" },
  brandMark: { display: "grid", placeItems: "center", width: 34, height: 34, flex: "0 0 34px", borderRadius: 9, background: "#c9222b", color: "#fff", fontWeight: 900, fontSize: 12, letterSpacing: ".04em" },
  brandName: { display: "block", fontSize: 14, letterSpacing: ".08em" },
  brandSubtitle: { display: "block", marginTop: 2, color: "#9ca3af", fontSize: 9, fontWeight: 800, letterSpacing: ".17em" },
  collapseButton: { display: "inline-grid", placeItems: "center", width: 32, height: 32, border: "1px solid rgba(255,255,255,.1)", borderRadius: 8, background: "transparent", color: "#b8bec7", cursor: "pointer" },
  navigation: { display: "grid", gap: 18, overflowY: "auto", paddingBottom: 12 },
  group: { display: "grid", gap: 5 },
  groupLabel: { padding: "0 10px 5px", color: "#727b89", fontSize: 10, fontWeight: 900, letterSpacing: ".12em", textTransform: "uppercase" },
  link: { display: "flex", alignItems: "center", gap: 11, minHeight: 42, padding: "0 11px", border: "1px solid transparent", borderRadius: 9, color: "#b8bec7", textDecoration: "none", fontSize: 13, fontWeight: 700 },
  linkActive: { borderColor: "rgba(201,34,43,.3)", background: "rgba(201,34,43,.13)", color: "#fff" },
  storeLink: { display: "flex", alignItems: "center", gap: 8, marginTop: "auto", minHeight: 40, padding: "0 10px", border: "1px solid rgba(255,255,255,.08)", borderRadius: 9, color: "#b8bec7", textDecoration: "none", fontSize: 12, fontWeight: 700 },
};
