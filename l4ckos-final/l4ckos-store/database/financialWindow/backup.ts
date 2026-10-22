import type { Connection } from "mysql2/promise";
import { BackupCaptureProgress, observeCaptureQueries } from "./backupProgress";
import { withBackupCleanup } from "./backupCleanup";
import { randomBytes, createCipheriv, createDecipheriv } from "node:crypto";
import { readFile, writeFile, open, lstat } from "node:fs/promises";
import {
  rows,
  quote,
  canonical,
  sha256,
  readStructuralSchema,
  structuralHash,
} from "../schema/fingerprint";
import { TARGET } from "../financialRecovery/policy";
import { EXECUTOR_GRANTS } from "../financialIsolation/controller";
export type FullBackup = {
  version: 4;
  capturedAt: string;
  source: {
    database: string;
    uuidHash: string;
    mysqlVersion: string;
    schemaHash: string;
    governanceHash: string;
  };
  tables: Record<
    string,
    {
      ddl: string;
      ddlHash: string;
      rows: Record<string, unknown>[];
      rowHash: string;
    }
  >;
  bodyHash: string;
};
const expected = Object.keys(EXECUTOR_GRANTS).sort();
const rowHash = (r: Record<string, unknown>[]) =>
  sha256(canonical(r.map(canonical).sort()));
const normalize = (s: string) => s.replace(/ AUTO_INCREMENT=\d+/g, "");
function encode(v: unknown): unknown {
  if (Buffer.isBuffer(v)) return { binaryHex: v.toString("hex") };
  if (
    v === null ||
    typeof v === "string" ||
    (typeof v === "number" && Number.isSafeInteger(v))
  )
    return v;
  throw Error("WINDOW_BACKUP_PHYSICAL_TYPE");
}
function decode(v: unknown) {
  if (
    v &&
    typeof v === "object" &&
    Object.keys(v).length === 1 &&
    "binaryHex" in v &&
    typeof v.binaryHex === "string" &&
    /^(?:[a-f0-9]{2})*$/.test(v.binaryHex)
  )
    return Buffer.from(v.binaryHex, "hex");
  if (
    v === null ||
    typeof v === "string" ||
    (typeof v === "number" && Number.isSafeInteger(v))
  )
    return v;
  throw Error("WINDOW_BACKUP_PHYSICAL_TYPE");
}
async function tableRows(c: Connection, t: string) {
  return (await rows(c, "SELECT * FROM " + quote(t))).map(r =>
    Object.fromEntries(Object.entries(r).map(([k, v]) => [k, encode(v)]))
  );
}
async function inventory(c: Connection) {
  // This format covers tables, not executable database objects. Never omit them silently.
  for (const view of ["TRIGGERS", "ROUTINES", "EVENTS"]) {
    const column =
      view === "TRIGGERS"
        ? "TRIGGER_SCHEMA"
        : view === "ROUTINES"
          ? "ROUTINE_SCHEMA"
          : "EVENT_SCHEMA";
    if (
      Number(
        (
          await rows(
            c,
            "SELECT COUNT(*) n FROM information_schema." +
              view +
              " WHERE " +
              column +
              "=DATABASE()"
          )
        )[0].n
      )
    )
      throw Error("WINDOW_BACKUP_UNSUPPORTED_DATABASE_OBJECT");
  }
  const ts = await rows(
    c,
    "SELECT TABLE_NAME name,ENGINE engine,TABLE_TYPE type FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() ORDER BY TABLE_NAME"
  );
  if (
    canonical(ts.map(t => t.name)) !== canonical(expected) ||
    ts.some(t => t.engine !== "InnoDB" || t.type !== "BASE TABLE")
  )
    throw Error("WINDOW_BACKUP_TABLE_COVERAGE");
  const result: Record<string, string> = {};
  for (const t of expected) {
    const [r] = await rows(c, "SHOW CREATE TABLE " + quote(t));
    result[t] = normalize(String(r["Create Table"]));
  }
  return result;
}
export async function takeFullBackup(
  c: Connection,
  assertIdentity: () => Promise<void>,
  assertContinuity: () => Promise<void> = async () => {},
  progress = new BackupCaptureProgress()
): Promise<FullBackup> {
  c = observeCaptureQueries(c,progress);
  progress.phaseStarted("SOURCE_IDENTITY");
  await assertContinuity();
  progress.waitingFor("IDENTITY_CHECK"); await assertIdentity(); progress.workCompleted();
  const [id] = await rows(
    c,
    "SELECT DATABASE() db,SHA2(@@server_uuid,256) uuidHash,VERSION() version"
  );
  if (!String(id.version).startsWith("8.4."))
    throw Error("WINDOW_BACKUP_MYSQL_VERSION");
  progress.phaseStarted("STRUCTURE_BEFORE");
  const schemaHash = structuralHash(await readStructuralSchema(c)),
    governanceHash = structuralHash(await readStructuralSchema(c, true));
  if (schemaHash !== TARGET.schemaHash) throw Error("WINDOW_BACKUP_SCHEMA");
  const ddl = await inventory(c);
  progress.phaseStarted("SNAPSHOT_START");
  await c.query("SET SESSION time_zone='+00:00'");
  await c.query("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ");
  await c.query("SET TRANSACTION READ ONLY");
  await c.query("START TRANSACTION WITH CONSISTENT SNAPSHOT");
  try {
    const tables: FullBackup["tables"] = {};
    progress.phaseStarted("TABLE_DATA");
    for (const t of expected) {
      progress.tableStarted();
      await assertContinuity();
      const r = await tableRows(c, t);
      await assertContinuity();
      tables[t] = {
        ddl: ddl[t],
        ddlHash: sha256(ddl[t]),
        rows: r,
        rowHash: rowHash(r),
      };
      progress.tableCompleted(Buffer.byteLength(JSON.stringify(r),"utf8"));
    }
    progress.phaseStarted("STRUCTURE_AFTER");
    if (
      canonical(await inventory(c)) !== canonical(ddl) ||
      structuralHash(await readStructuralSchema(c)) !== schemaHash ||
      structuralHash(await readStructuralSchema(c, true)) !== governanceHash
    )
      throw Error("WINDOW_BACKUP_SCHEMA_CHANGED");
    progress.phaseStarted("VERIFY_FINAL");
    progress.waitingFor("IDENTITY_CHECK"); await assertIdentity(); progress.workCompleted();
    await assertContinuity();
    progress.phaseStarted("SNAPSHOT_COMMIT");
    await c.commit(); progress.workCompleted();
    const body = {
      version: 4 as const,
      capturedAt: new Date().toISOString(),
      source: {
        database: String(id.db),
        uuidHash: String(id.uuidHash),
        mysqlVersion: String(id.version),
        schemaHash,
        governanceHash,
      },
      tables,
    };
    return { ...body, bodyHash: sha256(canonical(body)) };
  } catch (e) {
    return withBackupCleanup(async () => {throw e}, [{name:"snapshot-rollback",run:async()=>{await c.rollback()}}]);
  }
}
export function validateFullBackup(b: FullBackup) {
  const { bodyHash, ...body } = b;
  if (
    b.version !== 4 ||
    b.source.schemaHash !== TARGET.schemaHash ||
    !String(b.source.mysqlVersion).startsWith("8.4.") ||
    canonical(Object.keys(b.tables).sort()) !== canonical(expected) ||
    sha256(canonical(body)) !== bodyHash
  )
    throw Error("WINDOW_BACKUP_INTEGRITY");
  for (const [t, v] of Object.entries(b.tables)) {
    if (
      !v.ddl.startsWith("CREATE TABLE " + quote(t) + " (") ||
      v.ddlHash !== sha256(v.ddl) ||
      v.rowHash !== rowHash(v.rows)
    )
      throw Error("WINDOW_BACKUP_TABLE_INTEGRITY");
    for (const r of v.rows) for (const cell of Object.values(r)) decode(cell);
  }
}
export async function restoreFullBackup(
  c: Connection,
  b: FullBackup,
  socket: string
) {
  if (
    !/^\/tmp\/l4ckos-[a-z0-9-]+\/mysqld\.sock$/.test(socket) ||
    c.config.socketPath !== socket ||
    !/^l4ckos_test_[a-z0-9_]+$/.test(String(c.config.database))
  )
    throw Error("WINDOW_RESTORE_LOCAL_ONLY");
  validateFullBackup(b);
  if (
    !String((await rows(c, "SELECT VERSION() version"))[0].version).startsWith(
      "8.4."
    ) ||
    (
      await rows(
        c,
        "SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE()"
      )
    ).length
  )
    throw Error("WINDOW_RESTORE_EMPTY_MYSQL84_REQUIRED");
  await c.query("SET SESSION time_zone='+00:00'");
  await c.query("SET FOREIGN_KEY_CHECKS=0");
  try {
    for (const t of expected) await c.query(b.tables[t].ddl);
    await c.beginTransaction();
    try {
      for (const t of expected) {
        const columns = await rows(c, "SHOW COLUMNS FROM " + quote(t));
        const names = columns
          .filter(
            x =>
              !/GENERATED/.test(String(x.Extra)) ||
              /DEFAULT_GENERATED/.test(String(x.Extra))
          )
          .map(x => String(x.Field));
        for (const row of b.tables[t].rows) {
          if (
            canonical(Object.keys(row).sort()) !==
            canonical(columns.map(x => String(x.Field)).sort())
          )
            throw Error("WINDOW_RESTORE_COLUMNS");
          await c.query(
            "INSERT INTO " +
              quote(t) +
              " (" +
              names.map(quote).join(",") +
              ") VALUES (" +
              names.map(() => "?").join(",") +
              ")",
            names.map(n => decode(row[n]))
          );
        }
      }
      for (const t of expected)
        if (rowHash(await tableRows(c, t)) !== b.tables[t].rowHash)
          throw Error("WINDOW_RESTORE_DATA_HASH");
      if (
        structuralHash(await readStructuralSchema(c)) !== b.source.schemaHash ||
        structuralHash(await readStructuralSchema(c, true)) !==
          b.source.governanceHash
      )
        throw Error("WINDOW_RESTORE_SCHEMA_HASH");
      const fks = await rows(
        c,
        "SELECT TABLE_NAME child,CONSTRAINT_NAME constraintName,COLUMN_NAME col,REFERENCED_TABLE_NAME parent,REFERENCED_COLUMN_NAME parentCol,REFERENCED_TABLE_SCHEMA parentSchema FROM information_schema.KEY_COLUMN_USAGE WHERE TABLE_SCHEMA=DATABASE() AND REFERENCED_TABLE_NAME IS NOT NULL ORDER BY TABLE_NAME,CONSTRAINT_NAME,ORDINAL_POSITION"
      );
      const groups = new Map<string, typeof fks>();
      for (const fk of fks) {
        if (fk.parentSchema !== c.config.database)
          throw Error("WINDOW_RESTORE_EXTERNAL_FK");
        const k = fk.child + ":" + fk.constraintName;
        groups.set(k, [...(groups.get(k) || []), fk]);
      }
      for (const g of groups.values()) {
        const join = g
            .map(k => "p." + quote(k.parentCol) + "=c." + quote(k.col))
            .join(" AND "),
          notnull = g
            .map(k => "c." + quote(k.col) + " IS NOT NULL")
            .join(" AND ");
        const [r] = await rows(
          c,
          "SELECT COUNT(*) n FROM " +
            quote(g[0].child) +
            " c WHERE " +
            notnull +
            " AND NOT EXISTS (SELECT 1 FROM " +
            quote(g[0].parent) +
            " p WHERE " +
            join +
            ")"
        );
        if (Number(r.n)) throw Error("WINDOW_RESTORE_ORPHAN");
      }
      await c.commit();
      return {
        status: "PASS",
        tables: expected.length,
        rowHashes: Object.fromEntries(
          expected.map(t => [t, b.tables[t].rowHash])
        ),
        bodyHash: b.bodyHash,
      };
    } catch (e) {
      await c.rollback();
      throw e;
    }
  } finally {
    await c.query("SET FOREIGN_KEY_CHECKS=1");
  }
}
export async function writeEncryptedBackup(
  b: FullBackup,
  path: string,
  key: Buffer
) {
  validateFullBackup(b);
  if (
    key.length !== 32 ||
    !/^\/tmp\/l4ckos-[a-z0-9-]+\/backup\.enc$/.test(path)
  )
    throw Error("WINDOW_BACKUP_PRIVATE_PATH_OR_KEY");
  const dir = path.slice(0, path.lastIndexOf("/")),
    st = await lstat(dir);
  if (
    !st.isDirectory() ||
    (st.mode & 0o777) !== 0o700 ||
    st.uid !== process.getuid?.()
  )
    throw Error("WINDOW_BACKUP_DIRECTORY");
  const iv = randomBytes(12),
    cipher = createCipheriv("aes-256-gcm", key, iv),
    data = Buffer.concat([
      cipher.update(JSON.stringify(b), "utf8"),
      cipher.final(),
    ]);
  const bytes = Buffer.from(
    JSON.stringify({
      version: 1,
      algorithm: "AES-256-GCM",
      iv: iv.toString("hex"),
      tag: cipher.getAuthTag().toString("hex"),
      data: data.toString("base64"),
    })
  );
  await writeFile(path, bytes, { flag: "wx", mode: 0o600 });
  const f = await open(path, "r");
  await f.sync();
  await f.close();
  if (sha256(await readFile(path)) !== sha256(bytes))
    throw Error("WINDOW_BACKUP_READBACK");
  return {
    ciphertextSha256: sha256(bytes),
    bodyHash: b.bodyHash,
    tables: expected.length,
    keyReference: sha256(key),
  };
}
export function decryptBackup(
  bytes: Buffer,
  key: Buffer,
  expectedHash: string
): FullBackup {
  if (sha256(bytes) !== expectedHash || key.length !== 32)
    throw Error("WINDOW_BACKUP_CIPHERTEXT_HASH");
  const v = JSON.parse(bytes.toString());
  if (v.version !== 1 || v.algorithm !== "AES-256-GCM")
    throw Error("WINDOW_BACKUP_ENCRYPTION_FORMAT");
  const d = createDecipheriv("aes-256-gcm", key, Buffer.from(v.iv, "hex"));
  d.setAuthTag(Buffer.from(v.tag, "hex"));
  const b = JSON.parse(
    Buffer.concat([
      d.update(Buffer.from(v.data, "base64")),
      d.final(),
    ]).toString()
  );
  validateFullBackup(b);
  return b;
}
