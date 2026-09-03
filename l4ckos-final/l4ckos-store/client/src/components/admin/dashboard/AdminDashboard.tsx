import type { ReactNode } from "react";

/**
 * Presentation boundary for the dashboard. Data and actions stay in Admin.tsx
 * so the hardened RC query contract remains the single controller.
 */
export function AdminDashboard({ children }: { children: ReactNode }) {
  return <section aria-label="Visão geral administrativa">{children}</section>;
}
