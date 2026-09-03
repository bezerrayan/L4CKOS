import type { ReactNode } from "react";

/** Deliberately presentation-only: payment and fulfillment remain separate RC DTO fields. */
export function AdminOrdersUI({ children }: { children: ReactNode }) {
  return <section aria-label="Gestão de pedidos">{children}</section>;
}
