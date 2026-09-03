import type { ReactNode } from "react";

export function AdminSystemUI({ children }: { children: ReactNode }) {
  return <section aria-label="Sistema e auditoria">{children}</section>;
}
