import { useState } from "react";
import type { CSSProperties } from "react";
import { trpc } from "../../lib/trpc";
import { useToast } from "../../contexts/ToastContext";
import { AdminSettingsUI } from "../../components/admin/settings/AdminSettingsUI";
import { AdminSurface } from "../../components/admin/AdminUI";

export function ReportsPage() {
  const { showToast } = useToast();
  const utils = trpc.useUtils();
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const query = trpc.admin.reportsSalesCsv.useQuery({ from: from || new Date(Date.now() - 7 * 86400000).toISOString(), to: to || new Date().toISOString() }, { enabled: false });
  const download = async () => {
    try {
      const fromIso = from ? new Date(from).toISOString() : new Date(Date.now() - 7 * 86400000).toISOString();
      const toIso = to ? new Date(to).toISOString() : new Date().toISOString();
      const data = await query.refetch({ throwOnError: true });
      const csv = data.data ?? await utils.admin.reportsSalesCsv.fetch({ from: fromIso, to: toIso });
      const blob = new Blob([csv.csv], { type: "text/csv;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a"); anchor.href = url; anchor.download = csv.fileName; anchor.click(); URL.revokeObjectURL(url);
      showToast({ message: "Relatório CSV gerado", duration: 2200 });
    } catch (error: any) { showToast({ message: error?.message || "Não foi possível gerar o relatório", duration: 2800 }); }
  };
  return <AdminSettingsUI><AdminSurface title="Relatórios" description="Exporte um CSV de vendas para o intervalo selecionado."><div style={styles.row}><input type="datetime-local" style={styles.input} value={from} onChange={event => setFrom(event.target.value)} /><input type="datetime-local" style={styles.input} value={to} onChange={event => setTo(event.target.value)} /><button style={styles.primary} disabled={query.isFetching} onClick={download}>{query.isFetching ? "Gerando..." : "Baixar CSV"}</button></div></AdminSurface></AdminSettingsUI>;
}
const styles: Record<string, CSSProperties> = { row: { display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }, input: { border: "1px solid #27272a", background: "#111111", color: "#f0ede8", borderRadius: 12, padding: "12px 14px", minHeight: 46 }, primary: { border: "1px solid #3a3a3a", background: "linear-gradient(135deg, #1a1a1a 0%, #3a3a3a 100%)", color: "#fff", borderRadius: 8, padding: "12px 16px", cursor: "pointer", minWidth: 180, fontWeight: 800 } };
