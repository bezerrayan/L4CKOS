import type { Connection } from "mysql2/promise";
import { performance } from "node:perf_hooks";
import {
  readOperationalManifest,
  loadLineage,
  validateHistory,
} from "../migrations/runner";
import {
  execution,
  completeExecution,
  insertLedger,
} from "../schema/governance";
import { canonical, rows, sha256 } from "../schema/fingerprint";
import { assertBarrier } from "./barrier";
import { verifyCapability, type Capability } from "./capability";
import { capture, validatePrior, foreignKeys } from "./evidence";
import {
  assertPlan,
  NAME,
  SQL_SHA,
  PRE,
  POST,
  RC,
  snapshotDigest,
  fail,
  type WindowPlan,
} from "./policy";

/** Separate local issuer verifies a real localhost/socket target; remote issuer binds UUID/runtime. */
export async function verifyMigrationScope() {
  const lineage = await loadLineage(await readOperationalManifest());
  const entry = lineage.entries[1];
  if (
    lineage.entries.length !== 2 ||
    !entry ||
    entry.name !== NAME ||
    entry.checksum !== SQL_SHA ||
    entry.expectedPreFingerprint !== PRE ||
    entry.expectedPostFingerprint !== POST ||
    entry.statements.length !== 3
  )
    fail("0022_SCOPE_INVALID");
  return { lineage, entry };
}
const running = new WeakSet<Connection>();
export async function execute0022(
  c: Connection,
  plan: WindowPlan,
  capability: Capability,
  log: (event: string) => void = () => {}
) {
  if (running.has(c)) fail("0022_EXECUTION_ALREADY_ACTIVE");
  running.add(c);
  try {
    return await run(c, plan, capability, log);
  } finally {
    running.delete(c);
  }
}
async function run(
  c: Connection,
  plan: WindowPlan,
  capability: Capability,
  log: (event: string) => void
) {
  const verifyIdentity = () => verifyCapability(c, plan, capability);
  assertPlan(plan);
  await verifyIdentity();
  await assertBarrier(c);
  const { lineage, entry } = await verifyMigrationScope();
  const lock = `l4ckos_schema_v2_${sha256(c.config.database!).slice(0, 32)}`;
  if (
    Number(
      (await rows(c, "SELECT GET_LOCK(?, ?) acquired", [lock, 1]))[0].acquired
    ) !== 1
  )
    fail("SCHEMA_LOCK_UNAVAILABLE");
  log("lock_acquired");
  try {
    await verifyIdentity();
    await assertBarrier(c);
    await validatePrior(c);
    const before = await capture(c);
    if (snapshotDigest(before) !== snapshotDigest(plan.backup.sourceAfter))
      fail("BACKUP_NO_LONGER_CURRENT");
    assertPlan(plan);
    await c.query("SET SESSION lock_wait_timeout=5");
    const startedAt = performance.now(),
      context = {
        applicationCommit: plan.applicationCommit,
        approvedFingerprint: POST,
      };
    log("migration_started");
    await execution(
      c,
      context,
      { name: NAME, checksum: SQL_SHA, preFingerprint: PRE },
      async (checkpoint, id) => {
        for (const sql of entry.statements) {
          await verifyIdentity();
          await assertBarrier(c);
          assertPlan(plan);
          // Client timeout cannot prove server-side rollback. Destroying the session
          // leaves STARTED/FAILED as a recovery gate, never permits automatic retry.
          const timer = setTimeout(() => c.destroy(), 45000);
          try {
            await c.query(sql);
          } finally {
            clearTimeout(timer);
          }
          await checkpoint();
          log("statement_completed");
        }
        const after = await capture(c, before);
        if (after.fingerprint !== POST) fail("0022_POST_SCHEMA_MISMATCH");
        for (const [name, t] of Object.entries(before.tables))
          if (
            !name.startsWith("_l4ckos_") &&
            canonical(after.tables[name]) !== canonical(t)
          )
            fail("0022_EXISTING_DATA_CHANGED");
        const oldDates = await rows(
          c,
          "SELECT COUNT(*) n FROM productionBatches WHERE estimatedManufacturingStart IS NOT NULL OR estimatedManufacturingEnd IS NOT NULL OR manufacturingScheduleRequired<>0"
        );
        const oldItems = await rows(
          c,
          "SELECT COUNT(*) n FROM orderItems WHERE estimatedManufacturingStartAtPurchase IS NOT NULL OR estimatedManufacturingEndAtPurchase IS NOT NULL"
        );
        if (Number(oldDates[0].n) !== 0 || Number(oldItems[0].n) !== 0)
          fail("0022_LEGACY_DEFAULTS_INVALID");
        await foreignKeys(c);
        await c.beginTransaction();
        try {
          await insertLedger(c, context, {
            ...entry,
            preFingerprint: PRE,
            postFingerprint: POST,
            manifestVersion: 2,
            startedAt,
          });
          await completeExecution(c, id, POST);
          await c.commit();
        } catch (error) {
          await c.rollback();
          throw error;
        }
      }
    );
    const history = await validateHistory(c, lineage);
    if (
      history.length !== 4 ||
      history[3].applicationCommit !== plan.applicationCommit
    )
      fail("RECOVERY_REQUIRED");
    log("migration_completed");
    return {
      status: "APPLIED",
      fingerprint: POST,
      applicationCommit: plan.applicationCommit,
      sqlSourceCommit: RC,
      migration: NAME,
    };
  } finally {
    if (
      Number(
        (await rows(c, "SELECT RELEASE_LOCK(?) released", [lock]))[0].released
      ) !== 1
    )
      fail("SCHEMA_LOCK_RELEASE_FAILED");
  }
}
