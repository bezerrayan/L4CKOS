import { useMemo, useState } from "react";
import type { CSSProperties } from "react";
import { trpc } from "../../lib/trpc";
import { useToast } from "../../contexts/ToastContext";
import { AdminCustomersUI } from "../../components/admin/customers/AdminCustomersUI";
import { AdminEmptyState, AdminSurface } from "../../components/admin/AdminUI";

export function CustomersPage() {
  const { showToast } = useToast();
  const [search, setSearch] = useState("");
  const customersQuery = trpc.admin.usersList.useQuery();
  const setFlagsMutation = trpc.admin.userSetFlags.useMutation({
    onSuccess: () => { showToast({ message: "Cliente atualizado", duration: 2000 }); void customersQuery.refetch(); },
    onError: error => showToast({ message: error.message, duration: 2600 }),
  });
  const customers = useMemo(() => {
    const normalized = search.trim().toLowerCase();
    return [...(customersQuery.data ?? [])].filter(row => !normalized || [row.name, row.email, String(row.id)].some(value => String(value ?? "").toLowerCase().includes(normalized))).sort((a, b) => b.id - a.id);
  }, [customersQuery.data, search]);

  return <AdminCustomersUI><AdminSurface title="Clientes" description="Gerencie perfis, permissões e sinais operacionais dos usuários cadastrados.">
    <div style={styles.inlineRow}>
      <input style={{ ...styles.input, minWidth: 260 }} placeholder="Buscar por nome, e-mail ou ID" value={search} onChange={event => setSearch(event.target.value)} />
      <div style={styles.pill}>Total: {customers.length}</div><div style={styles.pill}>VIP: {customers.filter(row => row.isVip).length}</div><div style={styles.pill}>Bloqueados: {customers.filter(row => row.isBlocked).length}</div>
    </div>
    {customersQuery.isLoading ? <div style={styles.loading}>Carregando clientes...</div> : customers.length === 0 ? <AdminEmptyState title="Nenhum cliente encontrado" description="Quando houver usuários cadastrados, eles aparecerão aqui com seus indicadores principais." /> : <div style={styles.tableWrap}><table style={styles.table}><thead><tr><th>ID</th><th>Nome</th><th>Email</th><th>Role</th><th>Pedidos</th><th>VIP</th><th>Bloqueado</th><th>Ações</th></tr></thead><tbody>{customers.map(row => <tr key={row.id}><td>{row.id}</td><td>{row.name || "-"}</td><td>{row.email || "-"}</td><td>{row.role}</td><td>{row.ordersCount}</td><td>{row.isVip ? "Sim" : "Não"}</td><td>{row.isBlocked ? "Sim" : "Não"}</td><td style={styles.actions}><button style={styles.danger} onClick={() => setFlagsMutation.mutate({ userId: row.id, isBlocked: !row.isBlocked })}>{row.isBlocked ? "Desbloquear" : "Bloquear"}</button></td></tr>)}</tbody></table></div>}
  </AdminSurface></AdminCustomersUI>;
}

const styles: Record<string, CSSProperties> = {
  inlineRow: { display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center", justifyContent: "flex-start" },
  input: { border: "1px solid #27272a", background: "#111111", color: "#f0ede8", borderRadius: 12, padding: "12px 14px", minHeight: 46, boxSizing: "border-box" },
  pill: { display: "inline-flex", alignItems: "center", justifyContent: "center", minHeight: 38, padding: "0 14px", borderRadius: 999, border: "1px solid #262626", background: "#121212", color: "#f0ede8", fontSize: 12, fontWeight: 700, whiteSpace: "nowrap" },
  loading: { padding: "28px 18px", borderRadius: 16, border: "1px dashed #2f2f2f", background: "#0d0d0d", color: "#9ca3af", textAlign: "center" },
  tableWrap: { overflowX: "auto", border: "1px solid #2f2f2f", borderRadius: 10 }, table: { width: "100%", minWidth: 920, borderCollapse: "separate", borderSpacing: 0, fontSize: 14, lineHeight: 1.4, color: "#e5e7eb", textAlign: "center" },
  actions: { display: "flex", gap: 6, flexWrap: "wrap", justifyContent: "center", alignItems: "center" }, button: { border: "1px solid #2f2f2f", background: "#111111", color: "#f0ede8", borderRadius: 8, padding: "6px 10px", cursor: "pointer", fontWeight: 700, whiteSpace: "nowrap" }, danger: { border: "1px solid #dc2626", background: "#111111", color: "#dc2626", borderRadius: 8, padding: "6px 10px", cursor: "pointer" },
};
