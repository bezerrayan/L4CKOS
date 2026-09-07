import type { CSSProperties } from "react";
import { Link, useLocation } from "react-router-dom";
import { getAdminBreadcrumbs } from "./adminNavigation";

export function AdminBreadcrumb() {
  const { pathname } = useLocation();
  const crumbs = getAdminBreadcrumbs(pathname);
  return <nav aria-label="Breadcrumb" style={styles.breadcrumb}>{crumbs.map((crumb, index) => <span key={`${crumb.label}-${index}`} style={styles.part}>{index > 0 ? <span aria-hidden="true" style={styles.separator}>/</span> : null}{crumb.to ? <Link to={crumb.to} style={styles.link}>{crumb.label}</Link> : <span aria-current="page">{crumb.label}</span>}</span>)}</nav>;
}

const styles: Record<string, CSSProperties> = {
  breadcrumb: { display: "flex", flexWrap: "wrap", gap: 7, color: "#88919f", fontSize: 12, fontWeight: 700 },
  part: { display: "inline-flex", gap: 7 },
  separator: { color: "#515862" },
  link: { color: "#aab1bc", textDecoration: "none" },
};
