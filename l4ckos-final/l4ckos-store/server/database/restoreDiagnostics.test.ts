import { describe, it, expect, vi } from "vitest";
import { readFile, lstat } from "node:fs/promises";
import { compatibleSchema } from "./backupRestore";
import { restoreDiagnostic } from "../../database/staging/restoreDiagnostics";
import { prepareStaging } from "../../database/staging/executor";
import { TARGET, PRE } from "../../database/staging/policy";
import { REQUIRED_TABLES } from "./tableManifest";
import { sha256 } from "../../database/schema/fingerprint";
describe("restore evidence and semantic DDL comparison", () => {
  it("normalizes only the charset implied by the exact collation, preserving all quoted text", () => {
    expect(compatibleSchema("`name` varchar(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL")).toBe("`name` varchar(64) COLLATE utf8mb4_unicode_ci NOT NULL");
    for (const text of ["COMMENT 'CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci'", "enum('CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci')", "`CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`", "CHARACTER SET utf8mb4 COLLATE utf8mb4_bin", "CHARACTER SET latin1 COLLATE latin1_bin"]) expect(compatibleSchema(text)).toBe(text);
    expect(compatibleSchema("varchar(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci")).not.toBe(compatibleSchema("varchar(65) COLLATE utf8mb4_unicode_ci"));
    expect(compatibleSchema("varchar(64) COLLATE utf8mb4_unicode_ci")).not.toBe(compatibleSchema("varchar(64) COLLATE utf8mb4_bin"));
  });
  it("emits allowlisted diagnostics without messages, SQL, values or arbitrary fields", () => {
    const d = restoreDiagnostic({ code: "RESTORE_FAILED_ROLLED_BACK", message: "secret", diagnostic: { table: "users", mysqlCode: "ER_NO_REFERENCED_ROW_2", errno: 1452, sqlState: "23000", rolledBack: true, sql: "secret", password: "secret", row: { email: "secret" } } });
    expect(d).toMatchObject({ detail: "RESTORE_FK_FAILED", table: "users", errno: 1452, rolledBack: true });
    expect(JSON.stringify(d)).not.toContain("secret");
  });
  it("persists a private verified backup before proof, preserving it on failure without a plan", async () => {
    const bytes = Buffer.from(JSON.stringify({ tables: Object.fromEntries(REQUIRED_TABLES.map(table => [table, { rowCount: 0 }])) }));
    const logs = vi.spyOn(console, "log").mockImplementation(() => {});
    let savedPath = "";
    const inspect = async () => ({ fingerprint: PRE, secondFingerprint: PRE, webhook: false, internalTables: [] });
    const adapter = { source: async () => "a".repeat(40), identity: async () => ({ ...TARGET, deploymentId: "11111111-1111-1111-1111-111111111111", connectionHash: "a".repeat(64) }), health: async () => ({ status: 200 }), inspect, backup: async () => ({ bytes, originSha256: sha256(bytes) }), restoreProof: async () => {
      const event = logs.mock.calls.map(c => JSON.parse(String(c[0]))).find(e => e.event === "backup_copied"); savedPath = event.path;
      expect(await readFile(savedPath)).toEqual(bytes);
      const stat = await lstat(savedPath); expect(stat.isFile()).toBe(true); expect(stat.isSymbolicLink()).toBe(false); expect(stat.mode & 0o777).toBe(0o600); expect(stat.uid).toBe(process.getuid?.());
      throw Error("SYNTHETIC_RESTORE_FAILURE");
    }, reconcile: async () => { throw Error("APPLY_NOT_ALLOWED"); } };
    try {
      await expect(prepareStaging(adapter, "a".repeat(40))).rejects.toThrow("SYNTHETIC_RESTORE_FAILURE");
      expect(await readFile(savedPath)).toEqual(bytes);
      await expect(lstat(savedPath.replace("backup.json", "plan.json"))).rejects.toHaveProperty("code", "ENOENT");
    } finally { logs.mockRestore(); }
  });
});
