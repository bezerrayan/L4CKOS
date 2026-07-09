import type { CSSProperties, ReactNode } from "react";
import { AdminStatusBadge, AdminTableWrapper } from "../AdminUI";

export type AuditLogView = {
  id: number;
  actorUserId?: number | string | null;
  action?: string | null;
  entity?: string | null;
  entityId?: string | null;
  metadata?: unknown;
  createdAt?: Date | string | null;
};

export function AdminCriticalAlert({
  title,
  description,
  tone = "warning",
}: {
  title: string;
  description: string;
  tone?: "warning" | "danger" | "info";
}) {
  return (
    <div
      style={{
        ...styles.alert,
        ...(tone === "danger" ? styles.alertDanger : tone === "info" ? styles.alertInfo : styles.alertWarning),
      }}
    >
      <strong style={styles.alertTitle}>{title}</strong>
      <span style={styles.alertDescription}>{description}</span>
    </div>
  );
}

export function ReportsExportCard({
  title,
  description,
  children,
  aside,
}: {
  title: string;
  description: string;
  children: ReactNode;
  aside?: ReactNode;
}) {
  return (
    <div style={styles.exportCard}>
      <div style={styles.exportHeader}>
        <div>
          <span style={styles.eyebrow}>Exportação</span>
          <h3 style={styles.cardTitle}>{title}</h3>
          <p style={styles.cardText}>{description}</p>
        </div>
        {aside ? <div style={styles.cardAside}>{aside}</div> : null}
      </div>
      <div style={styles.exportBody}>{children}</div>
    </div>
  );
}

export function SystemMetricCards({
  cards,
}: {
  cards: Array<{ label: string; value: string | number; tone?: "danger" | "warning" | "success" }>;
}) {
  return (
    <div style={styles.summaryGrid}>
      {cards.map(card => (
        <div
          key={card.label}
          style={{
            ...styles.summaryCard,
            ...(card.tone === "danger"
              ? styles.summaryCardDanger
              : card.tone === "warning"
                ? styles.summaryCardWarning
                : card.tone === "success"
                  ? styles.summaryCardSuccess
                  : {}),
          }}
        >
          <span style={styles.summaryLabel}>{card.label}</span>
          <strong style={styles.summaryValue}>{card.value}</strong>
        </div>
      ))}
    </div>
  );
}

export function AuditActionBadge({ action }: { action?: string | null }) {
  const value = String(action || "acao.desconhecida");
  const isCritical = value.includes("delete") || value.includes("restore") || value.includes("blocked");
  const isCreate = value.includes("create") || value.includes("manual");
  const isUpdate = value.includes("update") || value.includes("set");

  return (
    <AdminStatusBadge
      style={isCritical ? badgeTones.danger : isCreate ? badgeTones.success : isUpdate ? badgeTones.warning : badgeTones.neutral}
    >
      {value}
    </AdminStatusBadge>
  );
}

export function AuditLogTable({ logs }: { logs: AuditLogView[] }) {
  return (
    <AdminTableWrapper>
      <table style={styles.table}>
        <thead><tr><th>Quando</th><th>Admin</th><th>Ação</th><th>Entidade</th><th>ID afetado</th><th>Detalhes</th></tr></thead>
        <tbody>
          {logs.map(log => (
            <tr key={log.id}>
              <td>
                <div style={styles.dateCell}>
                  <strong>{formatDateTime(log.createdAt)}</strong>
                  <span>Log #{log.id}</span>
                </div>
              </td>
              <td>
                <span style={styles.primaryText}>Usuário #{log.actorUserId ?? "n/a"}</span>
              </td>
              <td><AuditActionBadge action={log.action} /></td>
              <td><span style={styles.entityBadge}>{log.entity || "sem entidade"}</span></td>
              <td><span style={styles.secondaryText}>{log.entityId || "-"}</span></td>
              <td><span style={styles.metadataText}>{formatMetadata(log.metadata)}</span></td>
            </tr>
          ))}
        </tbody>
      </table>
    </AdminTableWrapper>
  );
}

export function BackupInfoCard({
  title,
  description,
  children,
  tone = "neutral",
}: {
  title: string;
  description: string;
  children: ReactNode;
  tone?: "neutral" | "danger";
}) {
  return (
    <div style={{ ...styles.backupCard, ...(tone === "danger" ? styles.backupCardDanger : {}) }}>
      <div>
        <h3 style={styles.cardTitle}>{title}</h3>
        <p style={styles.cardText}>{description}</p>
      </div>
      {children}
    </div>
  );
}

export function BackupFileList({ files }: { files: string[] }) {
  return (
    <AdminTableWrapper>
      <table style={styles.table}>
        <thead><tr><th>Arquivo</th><th>Identificação</th></tr></thead>
        <tbody>
          {files.map(file => (
            <tr key={file}>
              <td><span style={styles.primaryText}>{file}</span></td>
              <td><span style={styles.secondaryText}>{formatBackupHint(file)}</span></td>
            </tr>
          ))}
        </tbody>
      </table>
    </AdminTableWrapper>
  );
}

function formatDateTime(value?: Date | string | null) {
  if (!value) return "Data não informada";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Data não informada";
  return date.toLocaleString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatMetadata(metadata: unknown) {
  if (!metadata) return "-";
  try {
    const raw = typeof metadata === "string" ? metadata : JSON.stringify(metadata);
    return raw.length > 140 ? `${raw.slice(0, 140)}...` : raw;
  } catch {
    return "Metadado indisponível";
  }
}

function formatBackupHint(file: string) {
  const match = file.match(/^backup-(.+)\.json$/);
  if (!match) return "Arquivo JSON de backup";
  const isoLike = match[1].replace(/-(\d{3})Z$/, ".$1Z").replace(/-/g, ":");
  return isoLike ? "Backup gerado pelo painel administrativo" : "Arquivo JSON de backup";
}

const badgeTones: Record<string, CSSProperties> = {
  danger: {
    background: "rgba(239,68,68,0.14)",
    border: "1px solid rgba(239,68,68,0.32)",
    color: "#fca5a5",
  },
  warning: {
    background: "rgba(245,158,11,0.14)",
    border: "1px solid rgba(245,158,11,0.30)",
    color: "#fbbf24",
  },
  success: {
    background: "rgba(34,197,94,0.12)",
    border: "1px solid rgba(34,197,94,0.28)",
    color: "#86efac",
  },
  neutral: {
    background: "rgba(148,163,184,0.09)",
    border: "1px solid rgba(148,163,184,0.16)",
    color: "#94a3b8",
  },
};

const styles: Record<string, CSSProperties> = {
  alert: {
    display: "grid",
    gap: 5,
    padding: "13px 15px",
    borderRadius: 14,
    border: "1px solid rgba(255,255,255,0.08)",
    background: "#090909",
    textAlign: "left",
  },
  alertWarning: {
    borderColor: "rgba(245,158,11,0.30)",
    background: "linear-gradient(180deg, rgba(245,158,11,0.08), rgba(245,158,11,0.02)), #090909",
  },
  alertDanger: {
    borderColor: "rgba(239,68,68,0.36)",
    background: "linear-gradient(180deg, rgba(239,68,68,0.11), rgba(239,68,68,0.025)), #090909",
  },
  alertInfo: {
    borderColor: "rgba(56,189,248,0.28)",
    background: "linear-gradient(180deg, rgba(56,189,248,0.08), rgba(56,189,248,0.02)), #090909",
  },
  alertTitle: {
    color: "#f8f4ec",
    fontSize: 13,
    fontWeight: 900,
    lineHeight: 1.3,
  },
  alertDescription: {
    color: "#9ca3af",
    fontSize: 12,
    lineHeight: 1.5,
  },
  exportCard: {
    display: "grid",
    gap: 16,
    padding: 18,
    borderRadius: 16,
    border: "1px solid rgba(255,255,255,0.08)",
    background: "linear-gradient(180deg, rgba(255,255,255,0.025), rgba(255,255,255,0.006)), #090909",
    textAlign: "left",
  },
  exportHeader: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "flex-start",
    gap: 14,
    flexWrap: "wrap",
  },
  exportBody: {
    display: "grid",
    gap: 12,
  },
  eyebrow: {
    color: "#ef4444",
    fontSize: 11,
    fontWeight: 900,
    letterSpacing: "0.12em",
    textTransform: "uppercase",
  },
  cardTitle: {
    margin: "4px 0 0 0",
    color: "#f8f4ec",
    fontSize: 18,
    lineHeight: 1.25,
    fontWeight: 900,
  },
  cardText: {
    margin: "6px 0 0 0",
    color: "#9ca3af",
    fontSize: 13,
    lineHeight: 1.6,
    maxWidth: 720,
  },
  cardAside: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    flexWrap: "wrap",
  },
  summaryGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(135px, 1fr))",
    gap: 10,
  },
  summaryCard: {
    display: "grid",
    gap: 8,
    padding: "14px 14px",
    borderRadius: 14,
    border: "1px solid rgba(255,255,255,0.075)",
    background: "#090909",
  },
  summaryCardWarning: {
    borderColor: "rgba(245,158,11,0.26)",
    background: "linear-gradient(180deg, rgba(245,158,11,0.075), rgba(245,158,11,0.02)), #090909",
  },
  summaryCardDanger: {
    borderColor: "rgba(239,68,68,0.34)",
    background: "linear-gradient(180deg, rgba(239,68,68,0.085), rgba(239,68,68,0.02)), #090909",
  },
  summaryCardSuccess: {
    borderColor: "rgba(34,197,94,0.24)",
    background: "linear-gradient(180deg, rgba(34,197,94,0.075), rgba(34,197,94,0.02)), #090909",
  },
  summaryLabel: {
    color: "#9ca3af",
    fontSize: 11,
    fontWeight: 800,
    letterSpacing: "0.10em",
    textTransform: "uppercase",
  },
  summaryValue: {
    color: "#f8f4ec",
    fontSize: 24,
    lineHeight: 1,
    fontWeight: 900,
  },
  table: {
    width: "100%",
    minWidth: 920,
    borderCollapse: "separate",
    borderSpacing: 0,
    fontSize: 14,
    lineHeight: 1.4,
    color: "#e5e7eb",
    textAlign: "left",
  },
  dateCell: {
    display: "flex",
    flexDirection: "column",
    gap: 4,
    minWidth: 150,
    color: "#f8f4ec",
    fontSize: 12,
  },
  primaryText: {
    color: "#f8f4ec",
    fontSize: 13,
    fontWeight: 800,
  },
  secondaryText: {
    color: "#9ca3af",
    fontSize: 12,
    lineHeight: 1.4,
  },
  entityBadge: {
    display: "inline-flex",
    alignItems: "center",
    minHeight: 28,
    padding: "0 10px",
    borderRadius: 999,
    border: "1px solid rgba(255,255,255,0.10)",
    background: "#111111",
    color: "#d1d5db",
    fontSize: 12,
    fontWeight: 800,
  },
  metadataText: {
    display: "block",
    maxWidth: 320,
    color: "#9ca3af",
    fontSize: 12,
    lineHeight: 1.45,
    overflowWrap: "anywhere",
  },
  backupCard: {
    display: "grid",
    gap: 14,
    padding: 18,
    borderRadius: 16,
    border: "1px solid rgba(255,255,255,0.08)",
    background: "#090909",
    textAlign: "left",
  },
  backupCardDanger: {
    borderColor: "rgba(239,68,68,0.34)",
    background: "linear-gradient(180deg, rgba(239,68,68,0.10), rgba(239,68,68,0.02)), #090909",
  },
};
