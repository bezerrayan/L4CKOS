import type { ReactNode } from "react";

export function AdminProductsUI({ children }: { children: ReactNode }) {
  return <section aria-label="Gestão de produtos">{children}</section>;
}
