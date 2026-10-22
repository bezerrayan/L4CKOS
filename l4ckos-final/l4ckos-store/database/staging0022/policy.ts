import { SchemaError } from "../schema/safety";
import { canonical, sha256 } from "../schema/fingerprint";

export const RC = "ce9e84946d2773cdadee61254fc3ba5592f05001";
export const TARGET = Object.freeze({
  projectId: "2bb90c8e-eb65-43ee-826b-f93750f0499c",
  environmentId: "15545eee-bc02-4b70-afc4-19a5db9e6f46",
  serviceId: "9f1c7705-f2f9-48cf-b957-8f63a6bba4db",
  mysqlServiceId: "bcda5d78-4a0d-4682-8659-8316847addb7",
  database: "l4ckos_staging",
});
export const NAME = "0022_preorder_manufacturing_schedule";
export const SQL_SHA =
  "f6f3ec21394b03da2920d88b163d3aa512a6fe74da4aea4a689dda4f828b26c1";
export const PRE =
  "6654c63ea42bbcb84af99e7640f24d3963581128a6a5387898b12b34cbbca93a";
export const POST =
  "a7c2774e783e83f34c0304e970a91278f4df9e8c2b0a1fd5576c2694c1b9011e";
export const APPLICATION_RC = "aa25a3fbdc9d1824529ed02c1c012262c88cd213";
export const NAME23 = "0023_asaas_webhook_inbox";
export const SQL_SHA23 = "b0b588463e5318fdc63761fd6a8261827478fe058f2152a8a630fa5fa87bae8a";
export const POST23 = "0ba16c9b19b698d4933d0abad9a5e4679052fd2aaf78800da42d480e396ef5d2";
export function migrationPhase(checksum: string) {
  if (checksum === SQL_SHA) return { name: NAME, checksum: SQL_SHA, pre: PRE, post: POST, source: RC };
  if (checksum === SQL_SHA23) return { name: NAME23, checksum: SQL_SHA23, pre: POST, post: POST23, source: APPLICATION_RC };
  return fail("MIGRATION_SCOPE_INVALID");
}
export const TTL = 15 * 60 * 1000;
export const digest = (v: unknown) => sha256(canonical(v));
export function exactKeys(value: unknown, keys: string[]) {
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    canonical(Object.keys(value).sort()) === canonical([...keys].sort())
  );
}
export function fail(code: string): never {
  throw new SchemaError(code);
}
export type TableEvidence = { columns: string[]; count: number; hash: string };
export type Snapshot = {
  at: string;
  fingerprint: string;
  governanceFingerprint: string;
  tables: Record<string, TableEvidence>;
  ledgerHash: string;
};
export type BackupProof = {
  version: 1;
  artifactSha256: string;
  bytes: number;
  createdAt: string;
  restoredAt: string;
  sourceBefore: Snapshot;
  sourceAfter: Snapshot;
  restored: Snapshot;
  foreignKeyChecks: number;
  orphans: 0;
};
export type WindowPlan = {
  version: 1;
  applicationCommit: string;
  sqlSourceCommit: typeof RC | typeof APPLICATION_RC;
  sqlChecksum: typeof SQL_SHA | typeof SQL_SHA23;
  target: typeof TARGET;
  deploymentId: string;
  serverUuid: string;
  endpointHash: string;
  backup: BackupProof;
  operator: string;
  approver: string;
  expiresAt: string;
};
export function snapshotDigest(s: Snapshot) {
  const { at: _at, ...content } = s;
  return digest(content);
}
export function assertProof(p: BackupProof, now = Date.now()) {
  if (
    !p ||
    !exactKeys(p, [
      "version",
      "artifactSha256",
      "bytes",
      "createdAt",
      "restoredAt",
      "sourceBefore",
      "sourceAfter",
      "restored",
      "foreignKeyChecks",
      "orphans",
    ]) ||
    p.version !== 1 ||
    !/^[a-f0-9]{64}$/.test(p.artifactSha256) ||
    !Number.isSafeInteger(p.bytes) ||
    p.bytes <= 0 ||
    p.orphans !== 0 ||
    !Number.isSafeInteger(p.foreignKeyChecks) ||
    p.foreignKeyChecks < 1
  )
    fail("BACKUP_PROOF_REQUIRED");
  const times = [
    p.sourceBefore?.at,
    p.createdAt,
    p.sourceAfter?.at,
    p.restoredAt,
  ].map(v => Date.parse(v));
  if (
    times.some(t => !Number.isFinite(t) || t > now || now - t >= TTL) ||
    times.some((t, i) => i > 0 && t < times[i - 1])
  )
    fail("BACKUP_EXPIRED_OR_UNORDERED");
  for (const s of [p.sourceBefore, p.sourceAfter, p.restored]) {
    if (
      !exactKeys(s, [
        "at",
        "fingerprint",
        "governanceFingerprint",
        "tables",
        "ledgerHash",
      ]) ||
      ![PRE, POST].includes(s.fingerprint) ||
      s.governanceFingerprint !==
        "47462fe9f093c89f83444b2b849ecf488ae7de04557a79e11286bf48484f693b" ||
      Object.keys(s.tables).length !== 30 ||
      !/^[a-f0-9]{64}$/.test(s.ledgerHash) ||
      Object.values(s.tables).some(
        t =>
          !exactKeys(t, ["columns", "count", "hash"]) ||
          !Number.isSafeInteger(t.count) ||
          t.count < 0 ||
          !/^[a-f0-9]{64}$/.test(t.hash) ||
          !t.columns.length ||
          t.columns.some(v => !/^[A-Za-z_][A-Za-z0-9_]*$/.test(v)) ||
          new Set(t.columns).size !== t.columns.length
      )
    )
      fail("BACKUP_INVENTORY_OR_SCHEMA_INVALID");
  }
  if (
    snapshotDigest(p.sourceBefore) !== snapshotDigest(p.sourceAfter) ||
    snapshotDigest(p.sourceAfter) !== snapshotDigest(p.restored)
  )
    fail("BACKUP_RESTORE_OR_SOURCE_CHANGED");
}
export function assertPlan(p: WindowPlan, now = Date.now()) {
  if (
    !p ||
    !exactKeys(p, [
      "version",
      "applicationCommit",
      "sqlSourceCommit",
      "sqlChecksum",
      "target",
      "deploymentId",
      "serverUuid",
      "endpointHash",
      "backup",
      "operator",
      "approver",
      "expiresAt",
    ]) ||
    p.version !== 1 ||
    !/^[a-f0-9]{40}$/.test(p.applicationCommit) ||
    p.sqlSourceCommit !== migrationPhase(p.sqlChecksum).source ||
    (p.sqlChecksum === SQL_SHA23 && p.applicationCommit !== APPLICATION_RC) ||
    digest(p.target) !== digest(TARGET) ||
    !/^[a-f0-9-]{36}$/.test(p.deploymentId) ||
    !/^[a-f0-9-]{36}$/.test(p.serverUuid) ||
    !/^[a-f0-9]{64}$/.test(p.endpointHash) ||
    !/^[A-Za-z0-9_-]{1,64}$/.test(p.operator) ||
    !/^[A-Za-z0-9_-]{1,64}$/.test(p.approver) ||
    p.operator === p.approver
  )
    fail("WINDOW_APPROVAL_OR_TARGET_INVALID");
  const expires = Date.parse(p.expiresAt);
  if (
    !Number.isFinite(expires) ||
    expires <= now ||
    expires > Date.parse(p.backup?.sourceBefore?.at) + TTL
  )
    fail("WINDOW_EXPIRED");
  assertProof(p.backup, now);
  if (p.backup.sourceAfter.fingerprint !== migrationPhase(p.sqlChecksum).pre)
    fail("BACKUP_WRONG_MIGRATION_PHASE");
}
