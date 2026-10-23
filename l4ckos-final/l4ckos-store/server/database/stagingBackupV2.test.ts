import { describe, expect, it } from "vitest";
import { assertReviewedRcCheckout, formatBackupDiagnostic, isValidBackupKeyHex, REMOTE_EXPORT, verifyCryptoCases } from "../../scripts/staging-backup-v2";

describe("staging encrypted backup v2", () => {
  it("runs only from the reviewed RC worktree and allowlisted files", () => {
    expect(() => assertReviewedRcCheckout()).not.toThrow();
  });
  it("authenticates valid ciphertext and rejects wrong key, tampering, truncation, and failed export", async () => {
    await expect(verifyCryptoCases()).resolves.toBeUndefined();
  });
  it("accepts only a 32-byte hexadecimal v2 key without exposing its value", () => {
    expect(isValidBackupKeyHex("ab".repeat(32))).toBe(true);
    expect(isValidBackupKeyHex("ab".repeat(31))).toBe(false);
    expect(isValidBackupKeyHex(`${"ab".repeat(32)}00`)).toBe(false);
    expect(isValidBackupKeyHex(`${"ab".repeat(31)}xz`)).toBe(false);
  });
  it("selects the fixed staging schema directly and emits sanitized failure diagnostics", () => {
    expect(REMOTE_EXPORT).not.toContain("MYSQL_DATABASE");
    expect(REMOTE_EXPORT).toContain("--database=l4ckos_staging");
    const diagnostic = formatBackupDiagnostic("remote_export_pipeline", "RAILWAY_CHILD_EXIT_1");
    expect(diagnostic).toBe('{"status":"STAGING_BACKUP_V2_FAILED","phase":"remote_export_pipeline","code":"RAILWAY_CHILD_EXIT_1"}');
    expect(diagnostic).not.toContain("ab".repeat(32));
  });
});
