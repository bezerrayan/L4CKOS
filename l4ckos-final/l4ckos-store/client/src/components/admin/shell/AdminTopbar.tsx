import type { CSSProperties } from "react";
import { useLocation } from "react-router-dom";
import { useIsMobile } from "../../../hooks/useIsMobile";
import { getAdminPageTitle } from "./adminNavigation";
import { AdminBreadcrumb } from "./AdminBreadcrumb";

export function AdminTopbar() {
  const { pathname } = useLocation();
  const isMobile = useIsMobile(768);
  return <header style={{ ...styles.topbar, ...(isMobile ? styles.topbarMobile : {}) }}>
    <div>
      <AdminBreadcrumb />
      <h1 style={styles.title}>{getAdminPageTitle(pathname)}</h1>
    </div>
    <span style={styles.identity}>Área administrativa</span>
  </header>;
}

const styles: Record<string, CSSProperties> = {
  topbar: { minHeight: 92, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 18, padding: "20px clamp(20px, 3vw, 38px)", borderBottom: "1px solid rgba(255,255,255,.07)", background: "linear-gradient(180deg, rgba(255,255,255,.018), transparent)" },
  topbarMobile: { minHeight: 82, paddingLeft: 70 },
  title: { margin: "7px 0 0", color: "#f8f4ec", fontSize: 24, lineHeight: 1.15, letterSpacing: "-.02em" },
  identity: { padding: "7px 10px", border: "1px solid rgba(201,34,43,.24)", borderRadius: 999, color: "#f4b0b4", background: "rgba(201,34,43,.08)", fontSize: 11, fontWeight: 800, letterSpacing: ".04em", whiteSpace: "nowrap" },
};
