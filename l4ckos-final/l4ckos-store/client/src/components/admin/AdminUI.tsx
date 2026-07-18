import type { CSSProperties, ReactNode } from "react";

type HeaderAction = {
  label: string;
  onClick: () => void;
};

type StatCardProps = {
  label: string;
  value: string;
  icon: ReactNode;
  tone?: "neutral" | "success" | "warning" | "info";
  hint?: string;
};

export type AdminMetricTone = "neutral" | "success" | "warning" | "danger";

const tones: Record<NonNullable<StatCardProps["tone"]>, { border: string; glow: string; iconBg: string; iconColor: string }> = {
  neutral: {
    border: "rgba(148, 163, 184, 0.16)",
    glow: "rgba(148, 163, 184, 0.10)",
    iconBg: "rgba(148, 163, 184, 0.12)",
    iconColor: "#e2e8f0",
  },
  success: {
    border: "rgba(34, 197, 94, 0.20)",
    glow: "rgba(34, 197, 94, 0.12)",
    iconBg: "rgba(34, 197, 94, 0.14)",
    iconColor: "#86efac",
  },
  warning: {
    border: "rgba(245, 158, 11, 0.22)",
    glow: "rgba(245, 158, 11, 0.14)",
    iconBg: "rgba(245, 158, 11, 0.14)",
    iconColor: "#fcd34d",
  },
  info: {
    border: "rgba(56, 189, 248, 0.22)",
    glow: "rgba(56, 189, 248, 0.14)",
    iconBg: "rgba(56, 189, 248, 0.14)",
    iconColor: "#7dd3fc",
  },
};

export function AdminPageHeader({
  title,
  subtitle,
  actions,
}: {
  title: string;
  subtitle: string;
  actions?: HeaderAction[];
}) {
  return (
    <div style={styles.headerShell}>
      <div style={styles.headerContent}>
        <span style={styles.headerEyebrow}>Admin</span>
        <h1 style={styles.headerTitle}>{title}</h1>
        <p style={styles.headerSubtitle}>{subtitle}</p>
      </div>
      {actions?.length ? (
        <div style={styles.headerActions}>
          {actions.map(action => (
            <button key={action.label} type="button" style={styles.headerActionBtn} onClick={action.onClick}>
              {action.label}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

export function AdminStatsGrid({ children, style }: { children: ReactNode; style?: CSSProperties }) {
  return <div style={{ ...styles.statsGrid, ...style }}>{children}</div>;
}

export function AdminStatCard({ label, value, icon, tone = "neutral", hint }: StatCardProps) {
  const palette = tones[tone];

  return (
    <div
      style={{
        ...styles.statCard,
        border: `1px solid ${palette.border}`,
        boxShadow: `inset 0 1px 0 ${palette.glow}`,
      }}
    >
      <div style={{ ...styles.statIconWrap, background: palette.iconBg, color: palette.iconColor }}>{icon}</div>
      <div style={styles.statBody}>
        <span style={styles.statLabel}>{label}</span>
        <strong style={styles.statValue}>{value}</strong>
        {hint ? <span style={styles.statHint}>{hint}</span> : null}
      </div>
    </div>
  );
}

export function AdminSurface({
  title,
  description,
  children,
  aside,
}: {
  title: string;
  description?: string;
  children: ReactNode;
  aside?: ReactNode;
}) {
  return (
    <section style={styles.surface}>
      <div style={styles.surfaceHeader}>
        <div style={styles.surfaceHeaderText}>
          <h2 style={styles.surfaceTitle}>{title}</h2>
          {description ? <p style={styles.surfaceDescription}>{description}</p> : null}
        </div>
        {aside ? <div style={styles.surfaceAside}>{aside}</div> : null}
      </div>
      {children}
    </section>
  );
}

export function AdminQuickActions({
  actions,
}: {
  actions: Array<{ label: string; caption: string; onClick: () => void }>;
}) {
  return (
    <div style={styles.quickActions}>
      {actions.map(action => (
        <button key={action.label} type="button" style={styles.quickActionCard} onClick={action.onClick}>
          <strong style={styles.quickActionTitle}>{action.label}</strong>
          <span style={styles.quickActionCaption}>{action.caption}</span>
        </button>
      ))}
    </div>
  );
}

export function AdminEmptyState({
  title,
  description,
}: {
  title: string;
  description: string;
}) {
  return (
    <div style={styles.emptyState}>
      <strong style={styles.emptyTitle}>{title}</strong>
      <p style={styles.emptyDescription}>{description}</p>
    </div>
  );
}

export function AdminLoadingState({ children }: { children: ReactNode }) {
  return <div style={styles.loadingState}>{children}</div>;
}

export function AdminSummaryPill({ children }: { children: ReactNode }) {
  return <div style={styles.summaryPill}>{children}</div>;
}

export function AdminMetricCards({
  cards,
}: {
  cards: Array<{ label: string; value: string | number; tone?: AdminMetricTone }>;
}) {
  return (
    <div style={styles.metricGrid}>
      {cards.map(card => (
        <div
          key={card.label}
          style={{
            ...styles.metricCard,
            ...(card.tone === "danger"
              ? styles.metricCardDanger
              : card.tone === "warning"
                ? styles.metricCardWarning
                : card.tone === "success"
                  ? styles.metricCardSuccess
                  : {}),
          }}
        >
          <span style={styles.metricLabel}>{card.label}</span>
          <strong style={styles.metricValue}>{card.value}</strong>
        </div>
      ))}
    </div>
  );
}

export function AdminFilterPills<T extends string>({
  value,
  onChange,
  options,
}: {
  value: T;
  onChange: (value: T) => void;
  options: Array<{ key: T; label: string; count: number }>;
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

export function AdminTableWrapper({ children, style }: { children: ReactNode; style?: CSSProperties }) {
  return <div style={{ ...styles.tableWrapper, ...style }}>{children}</div>;
}

export function AdminStatusBadge({ children, style }: { children: ReactNode; style?: CSSProperties }) {
  return <span style={{ ...styles.statusBadge, ...style }}>{children}</span>;
}

export function AdminImagePreview({
  src,
  alt,
  caption,
  emptyLabel = "Sem imagem",
  variant = "media",
}: {
  src?: string | null;
  alt: string;
  caption?: ReactNode;
  emptyLabel?: string;
  variant?: "media" | "thumb";
}) {
  if (variant === "thumb") {
    return src ? (
      <img className="l4-product-media-surface l4-product-media-surface--thumb l4-product-media-image" src={src} alt={alt} style={styles.imageThumb} />
    ) : (
      <div style={styles.imageThumbEmpty}>{emptyLabel}</div>
    );
  }

  if (!src) return null;

  return (
    <div style={styles.imagePreviewRow}>
      <img className="l4-product-media-surface l4-product-media-image" src={src} alt={alt} style={styles.imagePreviewMedia} />
      {caption ? <span style={styles.imagePreviewCaption}>{caption}</span> : null}
    </div>
  );
}

const styles: Record<string, CSSProperties> = {
  headerShell: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "flex-start",
    gap: 14,
    flexWrap: "wrap",
    padding: "20px 22px",
    borderRadius: 16,
    border: "1px solid rgba(255,255,255,0.07)",
    background:
      "linear-gradient(180deg, rgba(255,255,255,0.035), rgba(255,255,255,0.008)), #0b0b0b",
    boxShadow: "inset 0 1px 0 rgba(255,255,255,0.045), 0 16px 44px rgba(0,0,0,0.22)",
  },
  headerContent: {
    display: "grid",
    gap: 7,
    maxWidth: 720,
  },
  headerEyebrow: {
    fontSize: 11,
    letterSpacing: "0.16em",
    textTransform: "uppercase",
    color: "#ef4444",
    fontWeight: 800,
  },
  headerTitle: {
    margin: 0,
    color: "#f8f4ec",
    fontSize: 29,
    lineHeight: 1.1,
  },
  headerSubtitle: {
    margin: 0,
    color: "#a1a1aa",
    fontSize: 14,
    lineHeight: 1.6,
  },
  headerActions: {
    display: "flex",
    gap: 10,
    flexWrap: "wrap",
  },
  headerActionBtn: {
    minHeight: 38,
    padding: "0 14px",
    borderRadius: 9,
    border: "1px solid rgba(239,68,68,0.26)",
    background: "rgba(239,68,68,0.12)",
    color: "#f8f4ec",
    cursor: "pointer",
    fontWeight: 800,
    fontSize: 12,
  },
  statsGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 220px), 1fr))",
    gap: 14,
  },
  statCard: {
    display: "grid",
    gridTemplateColumns: "40px 1fr",
    gap: 12,
    padding: "16px",
    borderRadius: 14,
    background:
      "linear-gradient(180deg, rgba(255,255,255,0.028), rgba(255,255,255,0.006)), #0b0b0b",
    minHeight: 116,
  },
  statIconWrap: {
    width: 40,
    height: 40,
    borderRadius: 12,
    display: "grid",
    placeItems: "center",
  },
  statBody: {
    display: "grid",
    gap: 6,
  },
  statLabel: {
    color: "#9ca3af",
    fontSize: 11,
    letterSpacing: "0.075em",
    textTransform: "uppercase",
    fontWeight: 700,
  },
  statValue: {
    color: "#f8f4ec",
    fontSize: 27,
    lineHeight: 1.1,
  },
  statHint: {
    color: "#8b949e",
    fontSize: 12,
    lineHeight: 1.5,
  },
  surface: {
    display: "grid",
    gap: 16,
    padding: "20px",
    borderRadius: 16,
    border: "1px solid rgba(255,255,255,0.07)",
    background:
      "linear-gradient(180deg, rgba(255,255,255,0.022), rgba(255,255,255,0.006)), #0c0c0c",
    boxShadow: "inset 0 1px 0 rgba(255,255,255,0.035)",
  },
  surfaceHeader: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "flex-start",
    gap: 16,
    flexWrap: "wrap",
  },
  surfaceHeaderText: {
    display: "grid",
    gap: 8,
  },
  surfaceTitle: {
    margin: 0,
    color: "#f8f4ec",
    fontSize: 19,
  },
  surfaceDescription: {
    margin: 0,
    color: "#9ca3af",
    fontSize: 13,
    lineHeight: 1.6,
    maxWidth: 760,
  },
  surfaceAside: {
    display: "flex",
    gap: 10,
    flexWrap: "wrap",
  },
  quickActions: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 180px), 1fr))",
    gap: 10,
  },
  quickActionCard: {
    textAlign: "left",
    display: "grid",
    gap: 8,
    padding: "15px 14px",
    borderRadius: 12,
    border: "1px solid rgba(255,255,255,0.07)",
    background: "linear-gradient(180deg, rgba(255,255,255,0.026), rgba(255,255,255,0.006)), #0a0a0a",
    color: "#f8f4ec",
    cursor: "pointer",
  },
  quickActionTitle: {
    fontSize: 14,
    lineHeight: 1.3,
  },
  quickActionCaption: {
    color: "#9ca3af",
    fontSize: 12,
    lineHeight: 1.55,
  },
  emptyState: {
    display: "grid",
    gap: 8,
    padding: "22px 18px",
    borderRadius: 14,
    border: "1px dashed rgba(255,255,255,0.14)",
    background: "linear-gradient(180deg, rgba(255,255,255,0.025), rgba(255,255,255,0.008)), #090909",
    textAlign: "center",
  },
  emptyTitle: {
    color: "#f8f4ec",
    fontSize: 16,
  },
  emptyDescription: {
    margin: 0,
    color: "#9ca3af",
    fontSize: 14,
    lineHeight: 1.6,
  },
  loadingState: {
    padding: "28px 18px",
    borderRadius: 14,
    border: "1px dashed rgba(255,255,255,0.14)",
    background: "linear-gradient(180deg, rgba(255,255,255,0.025), rgba(255,255,255,0.008)), #090909",
    color: "#9ca3af",
    textAlign: "center",
  },
  summaryPill: {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    minHeight: 38,
    padding: "0 14px",
    borderRadius: 999,
    border: "1px solid #262626",
    background: "#121212",
    color: "#f0ede8",
    fontSize: 12,
    fontWeight: 700,
    maxWidth: "100%",
    minWidth: 0,
    textAlign: "center",
    whiteSpace: "normal",
    overflowWrap: "anywhere",
  },
  metricGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 135px), 1fr))",
    gap: 10,
  },
  metricCard: {
    display: "grid",
    gap: 8,
    padding: "14px 14px",
    borderRadius: 14,
    border: "1px solid rgba(255,255,255,0.075)",
    background: "#090909",
    minWidth: 0,
  },
  metricCardWarning: {
    borderColor: "rgba(245,158,11,0.26)",
    background: "linear-gradient(180deg, rgba(245,158,11,0.075), rgba(245,158,11,0.02)), #090909",
  },
  metricCardDanger: {
    borderColor: "rgba(239,68,68,0.34)",
    background: "linear-gradient(180deg, rgba(239,68,68,0.085), rgba(239,68,68,0.02)), #090909",
  },
  metricCardSuccess: {
    borderColor: "rgba(34,197,94,0.24)",
    background: "linear-gradient(180deg, rgba(34,197,94,0.075), rgba(34,197,94,0.02)), #090909",
  },
  metricLabel: {
    color: "#9ca3af",
    fontSize: 11,
    fontWeight: 800,
    letterSpacing: "0.10em",
    textTransform: "uppercase",
  },
  metricValue: {
    color: "#f8f4ec",
    fontSize: 24,
    lineHeight: 1,
    fontWeight: 900,
    minWidth: 0,
    overflowWrap: "anywhere",
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
  tableWrapper: {
    overflowX: "auto",
    WebkitOverflowScrolling: "touch",
    border: "1px solid rgba(255,255,255,0.075)",
    borderRadius: 14,
    background: "#090909",
    boxShadow: "inset 0 1px 0 rgba(255,255,255,0.035)",
  },
  statusBadge: {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    minHeight: 32,
    padding: "0 10px",
    borderRadius: 999,
    fontSize: 11,
    fontWeight: 700,
    letterSpacing: "0.02em",
    whiteSpace: "nowrap",
  },
  imagePreviewRow: {
    display: "flex",
    alignItems: "center",
    gap: 12,
    padding: 10,
    borderRadius: 10,
    border: "1px solid #2f2f2f",
    background: "#111111",
  },
  imagePreviewMedia: {
    width: 72,
    height: 90,
    objectFit: "contain",
    objectPosition: "center",
    borderRadius: 10,
    border: "1px solid rgba(255,255,255,0.10)",
    background: "#080808",
    flexShrink: 0,
  },
  imagePreviewCaption: {
    color: "#9ca3af",
    fontSize: 12,
    lineHeight: 1.5,
    textAlign: "left",
  },
  imageThumb: {
    width: 56,
    height: 70,
    objectFit: "contain",
    objectPosition: "center",
    borderRadius: 10,
    border: "1px solid rgba(255,255,255,0.10)",
    background: "#080808",
  },
  imageThumbEmpty: {
    width: 56,
    height: 70,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 10,
    border: "1px dashed rgba(255,255,255,0.16)",
    background: "#090909",
    color: "#9ca3af",
    fontSize: 10,
    textAlign: "center",
    padding: 4,
  },
};
