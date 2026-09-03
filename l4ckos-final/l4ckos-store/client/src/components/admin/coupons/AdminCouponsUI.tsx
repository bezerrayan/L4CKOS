import type { ReactNode } from "react";

export function AdminCouponsUI({ children }: { children: ReactNode }) {
  return <section aria-label="Gestão de cupons">{children}</section>;
}
