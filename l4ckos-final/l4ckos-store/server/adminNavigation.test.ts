import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { adminNavigation, getAdminBreadcrumbs, getAdminPageTitle } from "../client/src/components/admin/shell/adminNavigation";

describe("Admin V2 navigation configuration", () => {
  it("keeps the management root as the dashboard destination", () => {
    expect(getAdminPageTitle("/gestao")).toBe("Visão geral");
    expect(adminNavigation[0].items[0].to).toBe("/gestao");
  });

  it("maps operational catalog and orders routes to explicit navigation groups", () => {
    expect(getAdminBreadcrumbs("/gestao/pedidos").map(item => item.label)).toEqual(["Pedidos"]);
    expect(getAdminBreadcrumbs("/gestao/catalogo/produtos").map(item => item.label)).toEqual(["Catálogo", "Produtos"]);
    expect(adminNavigation.flatMap(group => group.items).find(item => item.label === "Pedidos")?.match?.("/gestao/pedidos/42")).toBe(true);
    expect(adminNavigation.flatMap(group => group.items).find(item => item.label === "Catálogo")?.match?.("/gestao/catalogo/produtos")).toBe(true);
  });

  it("preserves detail-route context after a refresh", () => {
    expect(getAdminBreadcrumbs("/gestao/pedidos/123").map(item => item.label)).toEqual(["Pedidos", "Pedido"]);
    expect(getAdminBreadcrumbs("/gestao/catalogo/produtos/19").map(item => item.label)).toEqual(["Catálogo", "Produtos", "Produto"]);
  });

  it("does not make backup a first-level sidebar item", () => {
    expect(adminNavigation.flatMap(group => group.items).some(item => item.label === "Backup")).toBe(false);
    expect(getAdminBreadcrumbs("/gestao/operacoes/backup").map(item => item.label)).toEqual(["Operações", "Backup"]);
  });

  it("mounts route-owned pages for every extracted admin area and keeps /admin as an alias", () => {
    const app = readFileSync(resolve(process.cwd(), "client/src/App.tsx"), "utf8");
    for (const page of ["DashboardPage", "CustomersPage", "OrdersPage", "ProductsPage", "PromotionsPage", "CouponsPage", "ReviewsPage", "ReportsPage", "AuditPage", "BackupPage", "SettingsPage"]) {
      expect(app).toContain(`element={<${page} />}`);
    }
    expect(app).toContain('<Route path="catalogo/produtos" element={<ProductsPage />} />');
    expect(app).toContain('<Route path="catalogo/produtos/novo" element={<ProductsPage />} />');
    expect(app).toContain('<Route path="/admin/*" element={<Navigate replace to="/gestao" />} />');
    expect(app).toContain('<Route path="marketing/campanhas" element={<Navigate replace to="/gestao/marketing/cupons" />} />');
    expect(app).not.toContain("LegacyAdminSectionPage");
  });
});
