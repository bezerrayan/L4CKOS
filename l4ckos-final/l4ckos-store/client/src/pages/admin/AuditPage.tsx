import type { CSSProperties } from "react";
import { trpc } from "../../lib/trpc";
import { AdminSystemUI } from "../../components/admin/system/AdminSystemUI";
import { AdminEmptyState, AdminSurface } from "../../components/admin/AdminUI";

export function AuditPage() {
  const query = trpc.admin.auditList.useQuery({ limit: 200 });
  return <AdminSystemUI><AdminSurface title="Logs de auditoria" description="Últimos registros administrativos para rastreabilidade, conferência e apoio à investigação.">{query.isLoading ? <div style={styles.loading}>Carregando auditoria...</div> : !(query.data ?? []).length ? <AdminEmptyState title="Sem logs disponíveis" description="Os registros administrativos aparecerão aqui conforme ações forem executadas no painel." /> : <div style={styles.tableWrap}><table style={styles.table}><thead><tr><th>Quando</th><th>Usuário</th><th>Ação</th><th>Entidade</th><th>ID</th><th>Meta</th></tr></thead><tbody>{(query.data ?? []).map(log => <tr key={log.id}><td>{new Date(log.createdAt).toLocaleString("pt-BR")}</td><td>{log.actorUserId}</td><td>{log.action}</td><td>{log.entity}</td><td>{log.entityId || "-"}</td><td>{log.metadata ? JSON.stringify(log.metadata).slice(0, 100) : "-"}</td></tr>)}</tbody></table></div>}</AdminSurface></AdminSystemUI>;
}
const styles: Record<string, CSSProperties> = { loading: { padding: "28px 18px", borderRadius: 16, border: "1px dashed #2f2f2f", background: "#0d0d0d", color: "#9ca3af", textAlign: "center" }, tableWrap: { overflowX: "auto", border: "1px solid #2f2f2f", borderRadius: 10 }, table: { width: "100%", minWidth: 720, borderCollapse: "separate", borderSpacing: 0, fontSize: 14, lineHeight: 1.4, color: "#e5e7eb", textAlign: "center" } };
