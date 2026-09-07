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
});
