import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import { readReleaseContract } from "../../database/schema/artifacts";
import { loadLineage, readReleaseManifest } from "../../database/migrations/runner";

describe("release artifacts after the Home settings and variant identity migrations", () => {
  it("extends the immutable release lineage through migration 0025", async () => {
    const contract = await readReleaseContract();
    const manifest = await readReleaseManifest();
    const lineage = await loadLineage(manifest);

    expect(contract.version).toBe(6);
    expect(contract.schema.tables.some(table => table.name === "promoBanners")).toBe(true);
    expect(contract.schema.tables.filter(table => table.name === "homeHighlightSettings")).toHaveLength(1);
    const variantTable = contract.schema.tables.find(table => table.name === "productVariants");
    expect(variantTable?.columns.map(column => column.name)).toEqual(expect.arrayContaining(["size", "color", "optionKey", "isActive"]));
    expect(variantTable?.columns.find(column => column.name === "optionKey")).toMatchObject({ type: "varchar(191)", nullable: true });
    expect(variantTable?.indexes.some(index => index.unique && index.columns.map(column => column.name).join(",") === "productId,optionKey")).toBe(true);
    expect(variantTable?.checks.some(check => check.clause.includes("stock") && check.clause.includes(">= 0"))).toBe(true);
    expect(lineage.entries.map(entry => entry.name)).toEqual([
      "0021_preorder_production_batches",
      "0022_preorder_manufacturing_schedule",
      "0023_asaas_webhook_inbox",
      "0024_home_highlight_settings",
      "0025_product_variant_identity",
    ]);
    expect(lineage.entries.at(-1)).toMatchObject({
      expectedPreFingerprint: "7fe98896cff3da47b18a522c668fc429355e0397d74afa26c864585f102d649e",
      expectedPostFingerprint: contract.fingerprint,
    });
  });

  it("uses an additive, fail-closed availability column without rewriting product data", async () => {
    const sql = await readFile(new URL("../../database/migrations/0025_product_variant_identity.sql", import.meta.url), "utf8");
    expect(sql).toMatch(/ALTER TABLE `productVariants`[\s\S]*ADD COLUMN `isActive` tinyint NOT NULL DEFAULT 0/i);
    expect(sql).toMatch(/CHECK \(`isActive` IN \(0,1\)\)/i);
    expect(sql).not.toMatch(/\b(?:DROP|TRUNCATE|DELETE|UPDATE)\s+(?:TABLE\s+)?(?:productVariants|products|orderItems|stockReservations)\b/i);
  });

  it("uses an additive singleton table with only the approved seed and constraints", async () => {
    const sql = await readFile(new URL("../../database/migrations/0024_home_highlight_settings.sql", import.meta.url), "utf8");
    expect(sql).toMatch(/CREATE TABLE `homeHighlightSettings`/);
    expect(sql).toMatch(/CHECK \(`id` = 1\)/);
    expect(sql).toMatch(/CHECK \(`rotationIntervalSeconds` IN \(5, 8, 10\)\)/i);
    expect(sql).toMatch(/INSERT INTO `homeHighlightSettings`[\s\S]*VALUES \(1, 'single', 8\)/);
    expect(sql).not.toMatch(/\b(?:ALTER|DROP|TRUNCATE|DELETE|UPDATE)\s+(?:TABLE\s+)?(?:promoBanners|products|orders|payments)\b/i);
    expect(sql.match(/CREATE TABLE/gi)).toHaveLength(1);
  });
});
