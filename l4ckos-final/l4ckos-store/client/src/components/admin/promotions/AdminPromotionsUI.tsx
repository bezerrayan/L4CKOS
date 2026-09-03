import type { ReactNode } from "react";

export function AdminPromotionsUI({ children }: { children: ReactNode }) {
  return <section aria-label="Gestão de promoções">{children}</section>;
}
