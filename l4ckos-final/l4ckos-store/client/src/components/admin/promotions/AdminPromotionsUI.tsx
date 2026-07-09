import type { CSSProperties, ReactNode } from "react";
import { AdminStatusBadge } from "../AdminUI";

export type PromotionSummary = {
  total: number;
  active: number;
  inactive: number;
  withDesktopImage: number;
  withMobileImage: number;
  withoutImage: number;
};

export function PromotionsSummaryCards({ summary }: { summary: PromotionSummary }) {
  const cards: Array<{ label: string; value: number; tone?: "danger" | "warning" | "success" }> = [
    { label: "Total", value: summary.total },
    { label: "Ativos", value: summary.active, tone: "success" },
    { label: "Inativos", value: summary.inactive, tone: summary.inactive > 0 ? "warning" : undefined },
    { label: "Desktop ok", value: summary.withDesktopImage },
    { label: "Mobile dedicado", value: summary.withMobileImage },
    { label: "Sem imagem", value: summary.withoutImage, tone: summary.withoutImage > 0 ? "danger" : undefined },
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

export function PromotionStatusBadge({ active }: { active: boolean }) {
  return (
    <AdminStatusBadge style={active ? statusTones.active : statusTones.inactive}>
      {active ? "Ativo na home" : "Inativo"}
    </AdminStatusBadge>
  );
}

export function PromotionMediaBadge({
  children,
  tone = "neutral",
}: {
  children: ReactNode;
  tone?: "neutral" | "success" | "warning";
}) {
  return (
    <span
      style={{
        ...styles.mediaBadge,
        ...(tone === "success" ? styles.mediaBadgeSuccess : tone === "warning" ? styles.mediaBadgeWarning : {}),
      }}
    >
      {children}
    </span>
  );
}

export function PromotionBannerPreview({
  src,
  alt,
  label,
  variant = "desktop",
}: {
  src?: string | null;
  alt: string;
  label: string;
  variant?: "desktop" | "mobile";
}) {
  const isMobile = variant === "mobile";

  return (
    <div style={{ ...styles.previewCard, ...(isMobile ? styles.previewCardMobile : {}) }}>
      <div style={styles.previewHeader}>
        <span style={styles.previewLabel}>{label}</span>
        <span style={styles.previewRatio}>{isMobile ? "Mobile" : "16:9"}</span>
      </div>
      <div style={{ ...styles.previewFrame, ...(isMobile ? styles.previewFrameMobile : {}) }}>
        {src ? (
          <img src={src} alt={alt} style={styles.previewImage} />
        ) : (
          <div style={styles.previewEmpty}>Sem imagem</div>
        )}
      </div>
    </div>
  );
}

export function PromotionCampaignCell({
  title,
  description,
  badge,
}: {
  title?: string | null;
  description?: string | null;
  badge?: string | null;
}) {
  return (
    <div style={styles.campaignCell}>
      <span style={styles.campaignBadge}>{badge || "PROMOÇÃO"}</span>
      <strong style={styles.campaignTitle}>{title || "Banner sem título"}</strong>
      <span style={styles.campaignDescription}>{description || "Sem descrição cadastrada."}</span>
    </div>
  );
}

const statusTones: Record<string, CSSProperties> = {
  active: {
    background: "rgba(21, 128, 61, 0.14)",
    border: "1px solid rgba(21, 128, 61, 0.28)",
    color: "#86efac",
  },
  inactive: {
    background: "rgba(148, 163, 184, 0.10)",
    border: "1px solid rgba(148, 163, 184, 0.18)",
    color: "#cbd5e1",
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
  previewCard: {
    display: "grid",
    gap: 8,
    width: 210,
    maxWidth: "100%",
  },
  previewCardMobile: {
    width: 108,
  },
  previewHeader: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 8,
  },
  previewLabel: {
    color: "#d1d5db",
    fontSize: 11,
    fontWeight: 800,
    letterSpacing: "0.10em",
    textTransform: "uppercase",
  },
  previewRatio: {
    color: "#ef4444",
    fontSize: 10,
    fontWeight: 900,
    letterSpacing: "0.08em",
    textTransform: "uppercase",
  },
  previewFrame: {
    position: "relative",
    width: "100%",
    aspectRatio: "16 / 9",
    borderRadius: 12,
    overflow: "hidden",
    border: "1px solid rgba(239,68,68,0.24)",
    background: "radial-gradient(circle at center, rgba(239,68,68,0.10), transparent 58%), #080808",
    boxShadow: "inset 0 1px 0 rgba(255,255,255,0.05), 0 14px 34px rgba(0,0,0,0.28)",
  },
  previewFrameMobile: {
    aspectRatio: "4 / 5",
    borderRadius: 16,
  },
  previewImage: {
    width: "100%",
    height: "100%",
    objectFit: "cover",
    objectPosition: "center",
    display: "block",
  },
  previewEmpty: {
    width: "100%",
    height: "100%",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    color: "#9ca3af",
    fontSize: 12,
    fontWeight: 800,
    textAlign: "center",
  },
  mediaBadge: {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    minHeight: 26,
    padding: "0 9px",
    borderRadius: 999,
    border: "1px solid rgba(255,255,255,0.10)",
    background: "#111111",
    color: "#d1d5db",
    fontSize: 11,
    fontWeight: 800,
    whiteSpace: "nowrap",
  },
  mediaBadgeSuccess: {
    borderColor: "rgba(34,197,94,0.28)",
    background: "rgba(34,197,94,0.12)",
    color: "#86efac",
  },
  mediaBadgeWarning: {
    borderColor: "rgba(245,158,11,0.28)",
    background: "rgba(245,158,11,0.12)",
    color: "#fbbf24",
  },
  campaignCell: {
    display: "flex",
    flexDirection: "column",
    gap: 6,
    minWidth: 220,
    textAlign: "left",
  },
  campaignBadge: {
    alignSelf: "flex-start",
    color: "#ef4444",
    fontSize: 11,
    fontWeight: 900,
    letterSpacing: "0.10em",
    textTransform: "uppercase",
  },
  campaignTitle: {
    color: "#f8f4ec",
    fontSize: 15,
    lineHeight: 1.25,
    fontWeight: 900,
  },
  campaignDescription: {
    color: "#9ca3af",
    fontSize: 12,
    lineHeight: 1.45,
    maxWidth: 320,
  },
};
