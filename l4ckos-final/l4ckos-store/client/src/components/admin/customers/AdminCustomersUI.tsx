import type { CSSProperties, ReactNode } from "react";
import { AdminFilterPills, AdminMetricCards, AdminStatusBadge } from "../AdminUI";

export type CustomerListFilter = "all" | "admins" | "customers" | "vip" | "blocked" | "active" | "recent";

export type CustomerSummary = {
  total: number;
  admins: number;
  customers: number;
  vip: number;
  blocked: number;
  active: number;
  recent: number;
};

export type CustomerAdminView = {
  id: number;
  name?: string | null;
  email?: string | null;
  role?: string | null;
  isVip?: boolean | null;
  isBlocked?: boolean | null;
  ordersCount?: number | string | null;
  createdAt?: Date | string | null;
  lastSignedIn?: Date | string | null;
};

type FilterOption = {
  key: CustomerListFilter;
  label: string;
  count: number;
};

export function CustomersSummaryCards({ summary }: { summary: CustomerSummary }) {
  const cards: Array<{ label: string; value: number; tone?: "danger" | "warning" | "success" }> = [
    { label: "Total", value: summary.total },
    { label: "Admins", value: summary.admins, tone: summary.admins > 0 ? "warning" : undefined },
    { label: "Clientes", value: summary.customers },
    { label: "VIP", value: summary.vip, tone: "success" },
    { label: "Bloqueados", value: summary.blocked, tone: summary.blocked > 0 ? "danger" : undefined },
    { label: "Ativos", value: summary.active, tone: "success" },
    { label: "Recentes", value: summary.recent },
  ];

  return <AdminMetricCards cards={cards} />;
}

export function CustomersFilters({
  value,
  onChange,
  options,
}: {
  value: CustomerListFilter;
  onChange: (value: CustomerListFilter) => void;
  options: FilterOption[];
}) {
  return <AdminFilterPills value={value} onChange={onChange} options={options} />;
}

export function CustomerProfileCell({ customer }: { customer: CustomerAdminView }) {
  return (
    <div style={styles.profileCell}>
      <div style={styles.avatar}>{getInitials(customer.name, customer.email, customer.id)}</div>
      <div style={styles.profileBody}>
        <strong style={styles.profileName}>{customer.name || "Nome não informado"}</strong>
        <span style={styles.profileEmail}>{customer.email || "E-mail não informado"}</span>
        <span style={styles.profileMeta}>ID #{customer.id}</span>
      </div>
    </div>
  );
}

export function CustomerRoleBadge({ role }: { role?: string | null }) {
  const normalizedRole = String(role || "user").toLowerCase();
  if (normalizedRole === "admin") {
    return <AdminStatusBadge style={badgeTones.admin}>Admin</AdminStatusBadge>;
  }
  if (normalizedRole === "user") {
    return <AdminStatusBadge style={badgeTones.customer}>Cliente</AdminStatusBadge>;
  }
  return <AdminStatusBadge style={badgeTones.unknown}>Role: {normalizedRole}</AdminStatusBadge>;
}

export function CustomerStatusBadges({ customer }: { customer: CustomerAdminView }) {
  const isBlocked = Boolean(customer.isBlocked);
  const isVip = Boolean(customer.isVip);

  return (
    <div style={styles.badgeStack}>
      <AdminStatusBadge style={isBlocked ? badgeTones.blocked : badgeTones.active}>
        {isBlocked ? "Bloqueado" : "Ativo"}
      </AdminStatusBadge>
      <AdminStatusBadge style={isVip ? badgeTones.vip : badgeTones.neutral}>
        {isVip ? "VIP" : "Padrão"}
      </AdminStatusBadge>
    </div>
  );
}

export function CustomerDateMeta({
  createdAt,
  lastSignedIn,
}: {
  createdAt?: Date | string | null;
  lastSignedIn?: Date | string | null;
}) {
  return (
    <div style={styles.dateStack}>
      <DateLine label="Criado" value={createdAt} />
      <DateLine label="Acesso" value={lastSignedIn} />
    </div>
  );
}

export function CustomerOrdersCount({ value }: { value?: number | string | null }) {
  return (
    <div style={styles.ordersBox}>
      <strong style={styles.ordersValue}>{Number(value ?? 0)}</strong>
      <span style={styles.ordersLabel}>pedido(s)</span>
    </div>
  );
}

function DateLine({ label, value }: { label: string; value?: Date | string | null }) {
  return (
    <span style={styles.dateLine}>
      <strong>{label}:</strong> {formatDate(value)}
    </span>
  );
}

function formatDate(value?: Date | string | null) {
  if (!value) return "não informado";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "não informado";
  return date.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric" });
}

function getInitials(name?: string | null, email?: string | null, id?: number) {
  const source = (name || email || `#${id ?? ""}`).trim();
  if (!source) return "U";
  const parts = source.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
  return source.slice(0, 2).toUpperCase();
}

const badgeTones: Record<string, CSSProperties> = {
  admin: {
    background: "rgba(245,158,11,0.14)",
    border: "1px solid rgba(245,158,11,0.30)",
    color: "#fbbf24",
  },
  customer: {
    background: "rgba(148, 163, 184, 0.10)",
    border: "1px solid rgba(148, 163, 184, 0.18)",
    color: "#cbd5e1",
  },
  unknown: {
    background: "rgba(148, 163, 184, 0.10)",
    border: "1px solid rgba(148, 163, 184, 0.18)",
    color: "#d1d5db",
  },
  active: {
    background: "rgba(34,197,94,0.12)",
    border: "1px solid rgba(34,197,94,0.28)",
    color: "#86efac",
  },
  blocked: {
    background: "rgba(239,68,68,0.14)",
    border: "1px solid rgba(239,68,68,0.32)",
    color: "#fca5a5",
  },
  vip: {
    background: "rgba(239,68,68,0.14)",
    border: "1px solid rgba(239,68,68,0.30)",
    color: "#f87171",
  },
  neutral: {
    background: "rgba(148, 163, 184, 0.09)",
    border: "1px solid rgba(148, 163, 184, 0.16)",
    color: "#94a3b8",
  },
};

const styles: Record<string, CSSProperties> = {
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
  filterRow: {
    display: "flex",
    gap: 8,
    flexWrap: "wrap",
    alignItems: "center",
  },
  filterButton: {
    display: "inline-flex",
    alignItems: "center",
    gap: 8,
    minHeight: 38,
    padding: "0 12px",
    borderRadius: 999,
    border: "1px solid rgba(255,255,255,0.10)",
    background: "#101010",
    color: "#d1d5db",
    cursor: "pointer",
    fontSize: 12,
    fontWeight: 800,
  },
  filterButtonActive: {
    borderColor: "rgba(239,68,68,0.42)",
    background: "linear-gradient(180deg, rgba(239,68,68,0.16), rgba(127,29,29,0.12)), #141414",
    color: "#ffffff",
  },
  profileCell: {
    display: "flex",
    alignItems: "center",
    gap: 12,
    minWidth: 260,
    textAlign: "left",
  },
  avatar: {
    width: 42,
    height: 42,
    borderRadius: 12,
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    flex: "0 0 auto",
    border: "1px solid rgba(239,68,68,0.26)",
    background: "linear-gradient(135deg, rgba(239,68,68,0.16), rgba(255,255,255,0.035)), #090909",
    color: "#f8f4ec",
    fontSize: 13,
    fontWeight: 900,
  },
  profileBody: {
    display: "flex",
    flexDirection: "column",
    gap: 3,
    minWidth: 0,
  },
  profileName: {
    color: "#f8f4ec",
    fontSize: 14,
    lineHeight: 1.3,
    fontWeight: 900,
  },
  profileEmail: {
    color: "#d1d5db",
    fontSize: 12,
    lineHeight: 1.35,
    overflowWrap: "anywhere",
  },
  profileMeta: {
    color: "#7f8794",
    fontSize: 11,
    lineHeight: 1.3,
  },
  badgeStack: {
    display: "flex",
    alignItems: "center",
    gap: 6,
    flexWrap: "wrap",
    minWidth: 150,
  },
  dateStack: {
    display: "flex",
    flexDirection: "column",
    gap: 4,
    minWidth: 150,
  },
  dateLine: {
    color: "#9ca3af",
    fontSize: 12,
    lineHeight: 1.35,
  },
  ordersBox: {
    display: "inline-flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    minWidth: 82,
    padding: "8px 10px",
    borderRadius: 12,
    border: "1px solid rgba(255,255,255,0.08)",
    background: "#0b0b0b",
  },
  ordersValue: {
    color: "#f8f4ec",
    fontSize: 18,
    lineHeight: 1,
    fontWeight: 900,
  },
  ordersLabel: {
    color: "#9ca3af",
    fontSize: 11,
    lineHeight: 1.3,
  },
};
