import type { ReactNode } from "react";
import { AdminFilterPills, AdminMetricCards } from "../AdminUI";

export type ProductListFilter = "all" | "lowStock" | "outOfStock" | "withoutImage" | "withVariants";

export type ProductSummary = {
  total: number;
  withStock: number;
  outOfStock: number;
  lowStock: number;
  withoutImage: number;
  withVariants: number;
};

export function ProductsSummaryCards({ summary }: { summary: ProductSummary }) {
  return (
    <AdminMetricCards
      cards={[
        { label: "Total", value: summary.total },
        { label: "Com estoque", value: summary.withStock },
        { label: "Sem estoque", value: summary.outOfStock, tone: "danger" },
        { label: "Estoque baixo", value: summary.lowStock, tone: "warning" },
        { label: "Sem imagem", value: summary.withoutImage, tone: "warning" },
        { label: "Com variantes", value: summary.withVariants },
      ]}
    />
  );
}

export function ProductsFilters({
  value,
  onChange,
  options,
}: {
  value: ProductListFilter;
  onChange: (value: ProductListFilter) => void;
  options: Array<{ key: ProductListFilter; label: string; count: number }>;
}) {
  return <AdminFilterPills value={value} onChange={onChange} options={options} />;
}

export function AdminProductsUI({ children }: { children: ReactNode }) {
  return <section aria-label="Gestão de produtos">{children}</section>;
}
