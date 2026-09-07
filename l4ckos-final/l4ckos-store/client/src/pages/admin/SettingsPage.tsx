import type { CSSProperties } from "react";
import { useNavigate } from "react-router-dom";
import { AdminSettingsUI } from "../../components/admin/settings/AdminSettingsUI";
import { AdminSurface } from "../../components/admin/AdminUI";

export function SettingsPage() {
  const navigate = useNavigate();
  return <AdminSettingsUI><AdminSurface title="Configurações" description="Central informativa. Configurações de infraestrutura, credenciais e pagamentos permanecem exclusivamente no ambiente seguro."><div style={styles.columns}><div style={styles.list}><strong style={styles.title}>Operação disponível no painel</strong><button style={styles.button} onClick={() => navigate("/gestao/catalogo/produtos")}>Catálogo, estoque e variantes</button><button style={styles.button} onClick={() => navigate("/gestao/marketing/promocoes")}>Banners e promoções</button><button style={styles.button} onClick={() => navigate("/gestao/marketing/cupons")}>Cupons</button><button style={styles.button} onClick={() => navigate("/gestao/pedidos")}>Pedidos e rastreio</button></div><div style={styles.list}><strong style={styles.title}>Limites de segurança</strong><span style={styles.muted}>Pagamentos, webhooks, credenciais, banco, OAuth e e-mail não são editáveis pelo painel.</span><span style={styles.muted}>Ações administrativas continuam registradas em auditoria; confirmação manual de pagamento não é exposta na UI.</span></div></div></AdminSurface></AdminSettingsUI>;
}
const styles: Record<string, CSSProperties> = { columns: { display: "grid", gridTemplateColumns: "minmax(0, 1.4fr) minmax(280px, .8fr)", gap: 18 }, list: { display: "grid", gap: 12 }, title: { color: "#f0ede8", fontSize: 18 }, muted: { color: "#a1a1aa", fontSize: 13, lineHeight: 1.6 }, button: { border: "1px solid #2f2f2f", background: "#111111", color: "#f0ede8", borderRadius: 8, padding: "6px 10px", cursor: "pointer", fontWeight: 700, textAlign: "left" } };
