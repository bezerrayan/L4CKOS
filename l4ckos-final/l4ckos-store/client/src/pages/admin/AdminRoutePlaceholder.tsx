import type { CSSProperties } from "react";
import { Link } from "react-router-dom";

export function AdminRoutePlaceholder({ title, description, returnTo, returnLabel }: { title: string; description: string; returnTo: string; returnLabel: string }) {
  return <section style={styles.card} aria-labelledby="admin-route-placeholder-title"><span style={styles.eyebrow}>Admin V2</span><h2 id="admin-route-placeholder-title" style={styles.title}>{title}</h2><p style={styles.description}>{description}</p><Link to={returnTo} style={styles.link}>{returnLabel}</Link></section>;
}

const styles: Record<string, CSSProperties> = {
  card: { maxWidth: 680, padding: 26, border: "1px solid rgba(255,255,255,.09)", borderRadius: 16, background: "linear-gradient(180deg, rgba(255,255,255,.025), rgba(255,255,255,.008)), #0c0c0c" },
  eyebrow: { color: "#ef4444", fontSize: 10, fontWeight: 900, letterSpacing: ".12em", textTransform: "uppercase" },
  title: { margin: "8px 0", color: "#f8f4ec" },
  description: { margin: 0, color: "#a5adba", lineHeight: 1.6 },
  link: { display: "inline-flex", marginTop: 18, color: "#fff", fontWeight: 800, textDecoration: "none", borderBottom: "1px solid rgba(239,68,68,.8)" },
};
