import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { sha256 } from "../../database/schema/fingerprint";
const dir =
  process.env.L4CKOS_WINDOW_PACKAGE_DIR ??
  "/tmp/l4ckos-financial-window-v4-20261012";
describe("immutable private window package", () => {
  it("checks all byte hashes, candidate/operator preservation and absence of automatic application imports", () => {
    const m = JSON.parse(readFileSync(dir + "/manifest.json", "utf8"));
    for (const [file, hash] of Object.entries(m.artifacts))
      expect(sha256(readFileSync(dir + "/" + file))).toBe(hash);
    for (const [file, hash] of Object.entries(m.sourceHashes))
      expect(sha256(readFileSync(resolve(file)))).toBe(hash);
    expect(m.preservedFinancialOperatorHash).toBe(
      "c40e52f85eb4418910322693b184174576d6d4b430d4f266fb73900000fc07e7"
    );
    expect(m.remoteExecuted).toBe(false);
    for (const file of Object.keys(m.sourceHashes))
      expect(file).not.toMatch(/server\/(controllers|services|_core)/);
  });
  it.each([
    "financial-window.cjs",
    "financial-backup.cjs",
    "prepare-control-recovery.cjs",
  ])("%s rejects missing staging identity before database/network", file => {
    const r = spawnSync(process.execPath, [dir + "/" + file], {
      input: "{}",
      encoding: "utf8",
      env: { NODE_PATH: resolve("node_modules") },
    });
    expect(r.status).toBe(1);
    expect(r.stdout).toBe("");
    expect(r.stderr).toMatch(/STOPPED/);
    expect(r.stderr).not.toMatch(/password|access_token|DATABASE_URL|pay_dog/);
  });
});
