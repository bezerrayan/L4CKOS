import type { CSSProperties } from "react";
import { Link } from "react-router-dom";
import { AdminSurface } from "../../components/admin/AdminUI";

/** Composition hub: sensitive operations remain in their dedicated route modules. */
export function OperationsPage() {
  return <section aria-label="Operações administrativas"><AdminSurface title="Operações" description="Acesse as rotinas administrativas disponíveis no ambiente atual."><div style={styles.grid}><Link style={styles.card} to="/gestao/operacoes/auditoria"><strong>Auditoria</strong><span>Consulte a trilha de ações administrativas.</span></Link><Link style={styles.card} to="/gestao/operacoes/backup"><strong>Backup</strong><span>Crie ou restaure backups com confirmação explícita.</span></Link><Link style={styles.card} to="/gestao/operacoes/configuracoes"><strong>Configurações</strong><span>Veja os limites de operação seguros do painel.</span></Link></div></AdminSurface></section>;
}
const styles: Record<string, CSSProperties> = { grid: { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 12 }, card: { display: "grid", gap: 8, minHeight: 112, padding: 16, borderRadius: 14, border: "1px solid #2f2f2f", background: "#111111", color: "#f0ede8", textDecoration: "none" } };
