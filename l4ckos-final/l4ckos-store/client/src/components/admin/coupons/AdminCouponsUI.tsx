import type { CSSProperties } from "react";
import { AdminStatusBadge } from "../AdminUI";

export type CouponListFilter = "all" | "active" | "inactive" | "expired" | "future" | "percent" | "fixed" | "unlimited" | "limited";

export type CouponSummary = {
  total: number;
  active: number;
  inactive: number;
  expired: number;
  future: number;
  unlimited: number;
  limited: number;
  percent: number;
  fixed: number;
};

export type CouponAdminView = {
  id?: number | null;
  code?: string | null;
  type?: string | null;
  value?: number | string | null;
  maxUses?: number | string | null;
  usedCount?: number | string | null;
  startsAt?: Date | string | null;
  expiresAt?: Date | string | null;
  isActive?: boolean | number | null;
  createdAt?: Date | string | null;
};

type FilterOption = {
  key: CouponListFilter;
  label: string;
  count: number;
};

type CouponFormPreviewProps = {
  code: string;
  type: string;
  value: string;
  maxUses: string;
};

type OperationalAlert = {
  title: string;
  description: string;
  tone: "warning" | "danger" | "neutral";
};

export function CouponsSummaryCards({ summary }: { summary: CouponSummary }) {
  const cards: Array<{ label: string; value: number; tone?: "danger" | "warning" | "success" }> = [
    { label: "Total", value: summary.total },
    { label: "Ativos", value: summary.active, tone: "success" },
    { label: "Inativos", value: summary.inactive, tone: summary.inactive > 0 ? "warning" : undefined },
    { label: "Expirados", value: summary.expired, tone: summary.expired > 0 ? "danger" : undefined },
    { label: "Agendados", value: summary.future },
    { label: "Sem limite", value: summary.unlimited },
    { label: "Com limite", value: summary.limited },
    { label: "Percentual", value: summary.percent },
    { label: "Valor fixo", value: summary.fixed },
  ];

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

export function CouponsFilters({
  value,
  onChange,
  options,
}: {
  value: CouponListFilter;
  onChange: (value: CouponListFilter) => void;
  options: FilterOption[];
}) {
  return (
    <div style={styles.filterRow}>
      {options.map(option => (
        <button
          key={option.key}
          type="button"
          style={{ ...styles.filterButton, ...(value === option.key ? styles.filterButtonActive : {}) }}
          onClick={() => onChange(option.key)}
        >
          <span>{option.label}</span>
          <strong>{option.count}</strong>
        </button>
      ))}
    </div>
  );
}

export function CouponCodeCell({ coupon }: { coupon: CouponAdminView }) {
  return (
    <div style={styles.codeCell}>
      <strong style={styles.couponCode}>{coupon.code || "SEM-CODIGO"}</strong>
      <span style={styles.couponMeta}>ID #{coupon.id ?? "novo"}</span>
      {coupon.createdAt ? <span style={styles.couponMeta}>Criado em {formatDate(coupon.createdAt)}</span> : null}
    </div>
  );
}

export function CouponTypeBadge({ type }: { type?: string | null }) {
  if (type === "percent") return <AdminStatusBadge style={badgeTones.percent}>Percentual</AdminStatusBadge>;
  if (type === "fixed") return <AdminStatusBadge style={badgeTones.fixed}>Valor fixo</AdminStatusBadge>;
  return <AdminStatusBadge style={badgeTones.neutral}>Tipo desconhecido</AdminStatusBadge>;
}

export function CouponStatusBadge({ coupon }: { coupon: CouponAdminView }) {
  const status = getCouponStatus(coupon);
  if (status === "inactive") return <AdminStatusBadge style={badgeTones.inactive}>Inativo</AdminStatusBadge>;
  if (status === "expired") return <AdminStatusBadge style={badgeTones.danger}>Expirado</AdminStatusBadge>;
  if (status === "future") return <AdminStatusBadge style={badgeTones.warning}>Agendado</AdminStatusBadge>;
  if (status === "limitReached") return <AdminStatusBadge style={badgeTones.danger}>Limite atingido</AdminStatusBadge>;
  return <AdminStatusBadge style={badgeTones.active}>Ativo</AdminStatusBadge>;
}

export function CouponUsageBadge({ coupon }: { coupon: CouponAdminView }) {
  const maxUses = numericValue(coupon.maxUses);
  const usedCount = numericValue(coupon.usedCount);
  if (!maxUses) return <AdminStatusBadge style={badgeTones.neutral}>Sem limite</AdminStatusBadge>;
  const reached = usedCount >= maxUses;
  return (
    <AdminStatusBadge style={reached ? badgeTones.danger : badgeTones.limited}>
      {usedCount}/{maxUses} uso(s)
    </AdminStatusBadge>
  );
}

export function CouponValue({ coupon }: { coupon: CouponAdminView }) {
  return (
    <div style={styles.valueCell}>
      <strong style={styles.valueText}>{formatCouponValue(coupon.type, coupon.value)}</strong>
      <span style={styles.valueHint}>{coupon.type === "percent" ? "desconto percentual" : coupon.type === "fixed" ? "desconto em reais" : "tipo não informado"}</span>
    </div>
  );
}

export function CouponValidity({ coupon }: { coupon: CouponAdminView }) {
  return (
    <div style={styles.validityCell}>
      <span><strong>Início:</strong> {formatDate(coupon.startsAt)}</span>
      <span><strong>Fim:</strong> {formatDate(coupon.expiresAt)}</span>
    </div>
  );
}

export function CouponFormPreview({ code, type, value, maxUses }: CouponFormPreviewProps) {
  const previewCoupon: CouponAdminView = {
    code: code.trim().toUpperCase(),
    type,
    value,
    maxUses: maxUses.trim() ? maxUses : null,
    usedCount: 0,
    isActive: true,
  };

  return (
    <div style={styles.formPreview}>
      <span style={styles.previewEyebrow}>Prévia do cupom</span>
      <div style={styles.previewMain}>
        <strong style={styles.previewCode}>{previewCoupon.code || "CODIGO"}</strong>
        <CouponStatusBadge coupon={previewCoupon} />
      </div>
      <div style={styles.previewDetails}>
        <CouponTypeBadge type={type} />
        <strong style={styles.previewValue}>{formatCouponValue(type, value || 0)}</strong>
        <CouponUsageBadge coupon={previewCoupon} />
      </div>
      <span style={styles.previewHint}>A criação continua usando o mesmo payload atual do admin.</span>
    </div>
  );
}

export function CouponOperationalAlerts({ alerts }: { alerts: OperationalAlert[] }) {
  if (alerts.length === 0) return null;

  return (
    <div style={styles.alertList}>
      {alerts.map(alert => (
        <div
          key={alert.title}
          style={{
            ...styles.alertItem,
            ...(alert.tone === "danger" ? styles.alertDanger : alert.tone === "warning" ? styles.alertWarning : {}),
          }}
        >
          <strong style={styles.alertTitle}>{alert.title}</strong>
          <span style={styles.alertDescription}>{alert.description}</span>
        </div>
      ))}
    </div>
  );
}

export function getCouponStatus(coupon: CouponAdminView) {
  const now = Date.now();
  const startsAt = dateTime(coupon.startsAt);
  const expiresAt = dateTime(coupon.expiresAt);
  const maxUses = numericValue(coupon.maxUses);
  const usedCount = numericValue(coupon.usedCount);

  if (!Boolean(coupon.isActive)) return "inactive";
  if (expiresAt && expiresAt < now) return "expired";
  if (startsAt && startsAt > now) return "future";
  if (maxUses && usedCount >= maxUses) return "limitReached";
  return "active";
}

export function formatCouponValue(type?: string | null, value?: number | string | null) {
  const amount = numericValue(value);
  if (type === "percent") return `${amount}%`;
  if (type === "fixed") return amount.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
  return String(value ?? "0");
}

function formatDate(value?: Date | string | null) {
  if (!value) return "sem data";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "sem data";
  return date.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric" });
}

function dateTime(value?: Date | string | null) {
  if (!value) return 0;
  const time = new Date(value).getTime();
  return Number.isFinite(time) ? time : 0;
}

function numericValue(value?: number | string | null) {
  const numberValue = Number(value ?? 0);
  return Number.isFinite(numberValue) ? numberValue : 0;
}

const badgeTones: Record<string, CSSProperties> = {
  active: {
    background: "rgba(34,197,94,0.12)",
    border: "1px solid rgba(34,197,94,0.28)",
    color: "#86efac",
  },
  inactive: {
    background: "rgba(148,163,184,0.10)",
    border: "1px solid rgba(148,163,184,0.18)",
    color: "#cbd5e1",
  },
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
  percent: {
    background: "rgba(239,68,68,0.14)",
    border: "1px solid rgba(239,68,68,0.30)",
    color: "#f87171",
  },
  fixed: {
    background: "rgba(56,189,248,0.12)",
    border: "1px solid rgba(56,189,248,0.26)",
    color: "#7dd3fc",
  },
  limited: {
    background: "rgba(245,158,11,0.10)",
    border: "1px solid rgba(245,158,11,0.24)",
    color: "#fbbf24",
  },
  neutral: {
    background: "rgba(148,163,184,0.09)",
    border: "1px solid rgba(148,163,184,0.16)",
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
  codeCell: {
    display: "flex",
    flexDirection: "column",
    gap: 4,
    minWidth: 180,
    textAlign: "left",
  },
  couponCode: {
    color: "#f8f4ec",
    fontSize: 16,
    lineHeight: 1.2,
    fontWeight: 900,
    letterSpacing: "0.06em",
  },
  couponMeta: {
    color: "#9ca3af",
    fontSize: 11,
    lineHeight: 1.35,
  },
  valueCell: {
    display: "flex",
    flexDirection: "column",
    gap: 4,
    minWidth: 110,
  },
  valueText: {
    color: "#f8f4ec",
    fontSize: 18,
    lineHeight: 1,
    fontWeight: 900,
  },
  valueHint: {
    color: "#9ca3af",
    fontSize: 11,
    lineHeight: 1.35,
  },
  validityCell: {
    display: "flex",
    flexDirection: "column",
    gap: 4,
    minWidth: 155,
    color: "#9ca3af",
    fontSize: 12,
    lineHeight: 1.4,
  },
  formPreview: {
    display: "grid",
    gap: 12,
    padding: 16,
    borderRadius: 14,
    border: "1px solid rgba(239,68,68,0.20)",
    background: "radial-gradient(circle at top right, rgba(239,68,68,0.12), transparent 34%), #090909",
  },
  previewEyebrow: {
    color: "#9ca3af",
    fontSize: 11,
    fontWeight: 900,
    letterSpacing: "0.12em",
    textTransform: "uppercase",
  },
  previewMain: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 12,
    flexWrap: "wrap",
  },
  previewCode: {
    color: "#f8f4ec",
    fontSize: 24,
    lineHeight: 1,
    fontWeight: 900,
    letterSpacing: "0.08em",
  },
  previewDetails: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    flexWrap: "wrap",
  },
  previewValue: {
    color: "#f8f4ec",
    fontSize: 18,
    lineHeight: 1,
    fontWeight: 900,
  },
  previewHint: {
    color: "#9ca3af",
    fontSize: 12,
    lineHeight: 1.5,
  },
  alertList: {
    display: "grid",
    gap: 10,
  },
  alertItem: {
    display: "grid",
    gap: 4,
    padding: "12px 14px",
    borderRadius: 14,
    border: "1px solid rgba(255,255,255,0.075)",
    background: "#090909",
  },
  alertWarning: {
    borderColor: "rgba(245,158,11,0.28)",
    background: "linear-gradient(180deg, rgba(245,158,11,0.075), rgba(245,158,11,0.02)), #090909",
  },
  alertDanger: {
    borderColor: "rgba(239,68,68,0.34)",
    background: "linear-gradient(180deg, rgba(239,68,68,0.085), rgba(239,68,68,0.02)), #090909",
  },
  alertTitle: {
    color: "#f8f4ec",
    fontSize: 13,
    lineHeight: 1.35,
    fontWeight: 900,
  },
  alertDescription: {
    color: "#9ca3af",
    fontSize: 12,
    lineHeight: 1.45,
  },
};
