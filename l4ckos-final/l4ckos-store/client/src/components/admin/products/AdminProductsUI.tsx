import type { CSSProperties, ReactNode } from "react";
import { AdminFilterPills, AdminMetricCards, AdminStatusBadge } from "../AdminUI";

export type ProductListFilter = "all" | "lowStock" | "outOfStock" | "withoutImage" | "withVariants";

export type ProductSummary = {
  total: number;
  withStock: number;
  outOfStock: number;
  lowStock: number;
  withoutImage: number;
  withVariants: number;
};

type FilterOption = {
  key: ProductListFilter;
  label: string;
  count: number;
};

export function ProductsSummaryCards({ summary }: { summary: ProductSummary }) {
  const cards: Array<{ label: string; value: number; tone?: "danger" | "warning" | "neutral" }> = [
    { label: "Total", value: summary.total },
    { label: "Com estoque", value: summary.withStock },
    { label: "Sem estoque", value: summary.outOfStock, tone: "danger" },
    { label: "Estoque baixo", value: summary.lowStock, tone: "warning" },
    { label: "Sem imagem", value: summary.withoutImage, tone: "warning" },
    { label: "Com variantes", value: summary.withVariants },
  ];

  return <AdminMetricCards cards={cards} />;
}

export function ProductsFilters({
  value,
  onChange,
  options,
}: {
  value: ProductListFilter;
  onChange: (value: ProductListFilter) => void;
  options: FilterOption[];
}) {
  return <AdminFilterPills value={value} onChange={onChange} options={options} />;
}

export function ProductStockBadge({ stock }: { stock: number }) {
  if (stock <= 0) {
    return <AdminStatusBadge style={stockTones.empty}>Sem estoque</AdminStatusBadge>;
  }
  if (stock <= 5) {
    return <AdminStatusBadge style={stockTones.low}>Estoque baixo</AdminStatusBadge>;
  }
  return <AdminStatusBadge style={stockTones.ok}>Estoque ok</AdminStatusBadge>;
}

export function ProductVisualMeta({ children }: { children: ReactNode }) {
  return <span style={styles.visualMeta}>{children}</span>;
}

export function ProductOptionPreview({ label, values }: { label: string; values: string[] }) {
  if (values.length === 0) return <span style={styles.optionMuted}>{label}: não informado</span>;
  return (
    <span style={styles.optionLine}>
      {label}: {values.slice(0, 3).join(", ")}
      {values.length > 3 ? ` +${values.length - 3}` : ""}
    </span>
  );
}

const stockTones: Record<string, CSSProperties> = {
  ok: {
    background: "rgba(21, 128, 61, 0.14)",
    border: "1px solid rgba(21, 128, 61, 0.28)",
    color: "#86efac",
  },
  low: {
    background: "rgba(180, 83, 9, 0.14)",
    border: "1px solid rgba(180, 83, 9, 0.28)",
    color: "#fbbf24",
  },
  empty: {
    background: "rgba(185, 28, 28, 0.14)",
    border: "1px solid rgba(185, 28, 28, 0.28)",
    color: "#fca5a5",
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
  visualMeta: {
    color: "#9ca3af",
    fontSize: 11,
    lineHeight: 1.3,
  },
  optionLine: {
    color: "#d1d5db",
    fontSize: 11,
    lineHeight: 1.35,
  },
  optionMuted: {
    color: "#7f8794",
    fontSize: 11,
    lineHeight: 1.35,
  },
};
