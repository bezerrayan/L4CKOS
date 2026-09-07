import type { CSSProperties } from "react";
import { Link } from "react-router-dom";
import { AdminSurface } from "../../components/admin/AdminUI";

/** Composition hub: it deliberately owns no marketing mutation or duplicate data source. */
export function MarketingPage() {
  return <section aria-label="Marketing administrativo"><AdminSurface title="Marketing" description="Organize as campanhas disponíveis no painel."><div style={styles.grid}><Link style={styles.card} to="/gestao/marketing/promocoes"><strong>Promoções</strong><span>Crie, edite, ordene e publique banners promocionais.</span></Link><Link style={styles.card} to="/gestao/marketing/cupons"><strong>Cupons</strong><span>Gerencie descontos e o envio atual de lançamento para a waitlist.</span></Link><div style={{ ...styles.card, ...styles.muted }}><strong>Campanhas</strong><span>As operações disponíveis permanecem concentradas nos módulos compatíveis já expostos.</span></div></div></AdminSurface></section>;
}
const styles: Record<string, CSSProperties> = { grid: { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 12 }, card: { display: "grid", gap: 8, minHeight: 112, padding: 16, borderRadius: 14, border: "1px solid #2f2f2f", background: "#111111", color: "#f0ede8", textDecoration: "none" }, muted: { opacity: .72, cursor: "default" } };
