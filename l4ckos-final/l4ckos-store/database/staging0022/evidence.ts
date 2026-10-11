import type { Connection } from "mysql2/promise";
import { lstat, readFile, realpath, stat } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { gunzipSync } from "node:zlib";
import path from "node:path";
import {
  canonical,
  quote,
  rows,
  sha256,
  readStructuralSchema,
  structuralHash,
} from "../schema/fingerprint";
import {
  loadLineage,
  readOperationalManifest,
  validateHistory,
} from "../migrations/runner";
import {
  assertLocalSchemaTarget,
  verifyLocalConnection,
  type LocalTarget,
} from "../schema/safety";
import {
  assertProof,
  fail,
  type BackupProof,
  type Snapshot,
  type TableEvidence,
} from "./policy";

export async function capture(
  c: Connection,
  projection?: Snapshot
): Promise<Snapshot> {
  const schema = await readStructuralSchema(c),
    governance = await readStructuralSchema(c, true);
  const tables: Record<string, TableEvidence> = {};
  for (const t of [...schema.tables, ...governance.tables]) {
    if (t.engine !== "InnoDB" || t.type !== "BASE TABLE")
      fail("NON_TRANSACTIONAL_TABLE");
    const columns =
      projection?.tables[t.name]?.columns ?? t.columns.map(v => String(v.name));
    if (
      !columns.length ||
      columns.some(v => !t.columns.some(col => col.name === v))
    )
      fail("DATA_PROJECTION_INVALID");
    const data = await rows(
      c,
      `SELECT ${columns.map(quote).join(",")} FROM ${quote(t.name)}`
    );
    // Values stay in process memory; only hashes/counts leave the collector.
    tables[t.name] = {
      columns,
      count: data.length,
      hash: sha256(
        canonical(
          data
            .map(r =>
              canonical(
                Object.fromEntries(
                  Object.entries(r).map(([k, v]) => [
                    k,
                    Buffer.isBuffer(v) ? { hex: v.toString("hex") } : v,
                  ])
                )
              )
            )
            .sort()
        )
      ),
    };
  }
  if (
    projection &&
    canonical(Object.keys(tables).sort()) !==
      canonical(Object.keys(projection.tables).sort())
  )
    fail("DATA_INVENTORY_CHANGED");
  const ledger = await rows(
    c,
    "SELECT * FROM _l4ckos_schema_migrations ORDER BY id"
  );
  return {
    at: new Date().toISOString(),
    fingerprint: structuralHash(schema),
    governanceFingerprint: structuralHash(governance),
    tables,
    ledgerHash: sha256(canonical(ledger)),
  };
}
export async function foreignKeys(c: Connection) {
  let checks = 0;
  for (const table of [
    ...(await readStructuralSchema(c)).tables,
    ...(await readStructuralSchema(c, true)).tables,
  ])
    for (const fk of table.foreignKeys) {
      if (fk.parentSchema !== "$self") fail("EXTERNAL_FOREIGN_KEY");
      const predicates = fk.columns
        .map(col => `child.${quote(String(col.name))} IS NOT NULL`)
        .join(" AND ");
      const matches = fk.columns
        .map(
          col =>
            `parent.${quote(String(col.parentColumn))}=child.${quote(String(col.name))}`
        )
        .join(" AND ");
      const result = await rows(
        c,
        `SELECT COUNT(*) n FROM ${quote(table.name)} child WHERE ${predicates} AND NOT EXISTS (SELECT 1 FROM ${quote(String(fk.parent))} parent WHERE ${matches})`
      );
      if (Number(result[0].n) !== 0) fail("FOREIGN_KEY_ORPHANS");
      checks++;
    }
  return checks;
}
export async function validatePrior(c: Connection) {
  const history = await validateHistory(
    c,
    await loadLineage(await readOperationalManifest())
  );
  if (history.some(r => r.name === "0022_preorder_manufacturing_schedule"))
    fail("0022_ALREADY_APPLIED");
  if (
    canonical(history.map(r => r.name)) !==
    canonical([
      "0020_reconcile_asaas_webhook_events",
      "baseline-v1",
      "0021_preorder_production_batches",
    ])
  )
    fail("0022_PRIOR_HISTORY_REQUIRED");
}
export async function verifyPrivateGzip(file: string, repository: string) {
  const st = await lstat(file),
    actual = await realpath(file),
    root = await repositoryRoot(repository);
  if (
    !st.isFile() ||
    st.isSymbolicLink() ||
    (st.mode & 0o077) !== 0 ||
    (await stat(path.dirname(actual))).mode & 0o077 ||
    actual === root ||
    actual.startsWith(root + path.sep) ||
    st.size > 1024 * 1024 * 1024
  )
    fail("PRIVATE_EXTERNAL_BACKUP_REQUIRED");
  const data = await readFile(actual);
  try {
    if (!gunzipSync(data, { maxOutputLength: 1024 * 1024 * 1024 }).length)
      fail("EMPTY_BACKUP");
  } catch {
    fail("BACKUP_GZIP_INVALID");
  }
  return { artifactSha256: sha256(data), bytes: data.length };
}
export async function repositoryRoot(cwd: string) {
  return realpath(
    execFileSync("git", ["rev-parse", "--show-toplevel"], {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }).trim()
  );
}
/** Import must already have run into an isolated local MySQL; never restores a remote target. */
export async function proveRestore(
  c: Connection,
  local: LocalTarget,
  input: Omit<
    BackupProof,
    "version" | "restoredAt" | "restored" | "foreignKeyChecks" | "orphans"
  >
) {
  assertLocalSchemaTarget(local);
  await verifyLocalConnection(c, local);
  if (
    (await rows(c, "SELECT @@GLOBAL.event_scheduler scheduler"))[0]
      .scheduler !== "OFF"
  )
    fail("LOCAL_EVENT_SCHEDULER_REQUIRED_OFF");
  await validatePrior(c);
  const proof: BackupProof = {
    ...input,
    version: 1,
    restored: await capture(c),
    restoredAt: new Date().toISOString(),
    foreignKeyChecks: await foreignKeys(c),
    orphans: 0,
  };
  assertProof(proof);
  return proof;
}
