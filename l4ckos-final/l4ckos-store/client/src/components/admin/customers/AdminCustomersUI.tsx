import type { ReactNode } from "react";

export function AdminCustomersUI({ children }: { children: ReactNode }) {
  return <section aria-label="Gestão de clientes">{children}</section>;
}
