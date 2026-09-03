import type { ReactNode } from "react";

export function AdminSettingsUI({ children }: { children: ReactNode }) {
  return <section aria-label="Configurações administrativas">{children}</section>;
}
