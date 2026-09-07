import { useEffect, useState } from "react";
import { Outlet } from "react-router-dom";
import type { CSSProperties } from "react";
import { useIsMobile } from "../../../hooks/useIsMobile";
import { AdminSidebar } from "./AdminSidebar";
import { AdminTopbar } from "./AdminTopbar";

export function AdminShell() {
  const isMobile = useIsMobile(768);
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const closeMobile = () => setMobileOpen(false);
  const toggleSidebar = () => isMobile ? setMobileOpen(open => !open) : setCollapsed(value => !value);

  useEffect(() => {
    if (!isMobile) setMobileOpen(false);
  }, [isMobile]);
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === "Escape") closeMobile(); };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  return <div style={styles.shell}>
    <AdminSidebar collapsed={isMobile ? false : collapsed} mobileOpen={mobileOpen} isMobile={isMobile} onToggleCollapsed={toggleSidebar} onCloseMobile={closeMobile} />
    <main style={styles.main}><AdminTopbar /><div style={styles.pageContainer}><Outlet /></div></main>
  </div>;
}

const styles: Record<string, CSSProperties> = {
  shell: { minHeight: "100vh", display: "flex", background: "radial-gradient(circle at 62% -8%, rgba(201,34,43,.07), transparent 27%), #070707", color: "#f8f4ec" },
  main: { minWidth: 0, flex: 1, display: "flex", flexDirection: "column" },
  pageContainer: { width: "100%", maxWidth: 1640, margin: "0 auto", padding: "clamp(18px, 3vw, 38px)" },
};
