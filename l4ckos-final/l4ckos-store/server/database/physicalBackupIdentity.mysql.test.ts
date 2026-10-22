import { beforeAll, beforeEach, afterEach, describe, it, expect } from "vitest";
import { createConnection, type Connection } from "mysql2/promise";
import { readFile, mkdir, rm } from "node:fs/promises";
import { randomUUID, randomBytes } from "node:crypto";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import {
  BACKUP_TARGET,
  assertBackupRailway,
  assertBackupReference,
  verifyPhysicalBackupIdentity,
  type PhysicalReference,
} from "../../database/financialWindow/backupIdentity";
import {
  takeFullBackup,
  writeEncryptedBackup,
  decryptBackup,
  restoreFullBackup,
} from "../../database/financialWindow/backup";
import { sha256, rows } from "../../database/schema/fingerprint";
import { setupWindowFixture } from "./financialWindow.fixture";
const socket = "/tmp/l4ckos-physical-backup-socket/mysqld.sock";
let root: Connection,
  db: string,
  password: string,
  ref: PhysicalReference,
  localUuidHash: string;
const env = () => ({
  RAILWAY_PROJECT_ID: BACKUP_TARGET.projectId,
  RAILWAY_ENVIRONMENT_ID: BACKUP_TARGET.environmentId,
  RAILWAY_SERVICE_ID: BACKUP_TARGET.mysqlServiceId,
  RAILWAY_DEPLOYMENT_ID: BACKUP_TARGET.mysqlDeploymentId,
});
describe("physical backup pre-connection guards", () => {
  it("does not depend on missing or malformed MYSQL_DATABASE", () =>
    expect(() =>
      assertBackupRailway({ ...env(), "MYSQL_DATABASE\n": "ignored" })
    ).not.toThrow());
  it.each(Object.keys(env()))("rejects divergent %s", key =>
    expect(() => assertBackupRailway({ ...env(), [key]: "wrong" })).toThrow(
      "WINDOW_BACKUP_RAILWAY_IDENTITY"
    )
  );
  it.each([null, {}, { target: BACKUP_TARGET, sources: [] }])(
    "rejects absent independent evidence",
    reference =>
      expect(() =>
        assertBackupReference(reference, "a".repeat(64), "a".repeat(64))
      ).toThrow("WINDOW_BACKUP_REFERENCE_INTEGRITY")
  );
  it("package rejects reference tampering before database connection", async () => {
    const dir = process.env.L4CKOS_PHYSICAL_PACKAGE_DIR!;
    const m = JSON.parse(await readFile(dir + "/manifest.json", "utf8"));
    const r = spawnSync(process.execPath, [dir + "/financial-backup.cjs"], {
      input: JSON.stringify({
        artifactHash: m.artifacts["financial-backup.cjs"],
        referenceHash: "a".repeat(64),
      }),
      encoding: "utf8",
      env: {
        ...env(),
        MYSQL_ROOT_PASSWORD: "synthetic",
        NODE_PATH: resolve("node_modules"),
      },
    });
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("WINDOW_BACKUP_REFERENCE_INTEGRITY");
    expect(r.stdout).toBe("");
  });
});
describe.skipIf(process.env.L4CKOS_PHYSICAL_BACKUP_TEST !== "1")(
  "isolated MySQL physical backup",
  () => {
    beforeAll(async () => {
      password = (
        await readFile(
          "/tmp/l4ckos-physical-backup-runtime/root-password",
          "utf8"
        )
      ).trim();
      // Independent local fixture file BEFORE any connection. Never enroll the UUID returned by SQL.
      const cfg = await readFile(
        "/tmp/l4ckos-physical-backup-runtime/data/auto.cnf",
        "utf8"
      );
      const uuid = /^server-uuid=([a-f0-9-]{36})$/m.exec(cfg)?.[1];
      if (!uuid) throw Error("LOCAL_REFERENCE_MISSING");
      localUuidHash = sha256(uuid);
    });
    beforeEach(async () => {
      db =
        "l4ckos_test_physical_" + randomUUID().replaceAll("-", "").slice(0, 12);
      root = await createConnection({
        user: "root",
        password,
        socketPath: socket,
        database: "mysql",
        dateStrings: true,
        jsonStrings: true,
        timezone: "Z",
        supportBigNumbers: true,
        bigNumberStrings: true,
        multipleStatements: false,
      });
      await root.query("CREATE DATABASE " + db);
      await root.changeUser({ database: db });
      await setupWindowFixture(root);
      await root.query(
        "INSERT INTO _l4ckos_schema_executions(operation,checksum,applicationCommit,state,preFingerprint,observedFingerprint,finishedAt) VALUES(?,? ,?,'COMPLETED',?,?,NOW())",
        [
          BACKUP_TARGET.migration,
          BACKUP_TARGET.migrationChecksum,
          "a".repeat(40),
          BACKUP_TARGET.schemaHash,
          BACKUP_TARGET.schemaHash,
        ]
      );
      ref = { ...BACKUP_TARGET, database: db, uuidHash: localUuidHash };
    }, 30000);
    afterEach(async () => {
      if (root) {
        await root.rollback();
        await root.query("DROP DATABASE " + db);
        await root.end();
      }
    });
    it("validates UUID, schema, governance, migrations and 31 tables", async () =>
      expect(verifyPhysicalBackupIdentity(root, ref)).resolves.toBeUndefined());
    it.each([
      "uuidHash",
      "database",
      "schemaHash",
      "governanceHash",
      "migrationChecksum",
    ])("rejects divergent %s before business row reads", async key => {
      const sql: string[] = [];
      const original = root.query.bind(root);
      root.query = ((s: any, ...a: any[]) => {
        sql.push(String(s));
        return original(s, ...(a as [any]));
      }) as any;
      await expect(
        takeFullBackup(root, () =>
          verifyPhysicalBackupIdentity(root, { ...ref, [key]: "wrong" })
        )
      ).rejects.toThrow();
      expect(sql.some(s => /SELECT \* FROM/.test(s))).toBe(false);
    });
    it("rejects missing 0023", async () => {
      await root.query("DELETE FROM _l4ckos_schema_migrations");
      await expect(verifyPhysicalBackupIdentity(root, ref)).rejects.toThrow(
        "WINDOW_BACKUP_MIGRATION_IDENTITY"
      );
    });
    it("rejects unfinished migration", async () => {
      await root.query("UPDATE _l4ckos_schema_executions SET state='STARTED'");
      await expect(verifyPhysicalBackupIdentity(root, ref)).rejects.toThrow(
        "WINDOW_BACKUP_MIGRATION_IDENTITY"
      );
    });
    it("classifies unavailable server_uuid", async () => {
      const original = root.query.bind(root);
      root.query = ((s: any, ...a: any[]) =>
        String(s).includes("@@server_uuid")
          ? Promise.reject(Error("synthetic"))
          : original(s, ...(a as [any]))) as any;
      await expect(verifyPhysicalBackupIdentity(root, ref)).rejects.toThrow(
        "WINDOW_BACKUP_PHYSICAL_IDENTITY_UNAVAILABLE"
      );
    });
    it("blocks local authentication failure", async () => {
      await expect(
        createConnection({
          user: "root",
          password: "synthetic_wrong",
          socketPath: socket,
        })
      ).rejects.toMatchObject({ code: "ER_ACCESS_DENIED_ERROR" });
    });
    it("blocks missing local socket", async () => {
      await expect(
        createConnection({
          user: "root",
          socketPath: "/tmp/l4ckos-physical-backup-socket/absent.sock",
        })
      ).rejects.toMatchObject({ code: "ENOENT" });
    });
    it("encrypts and restores 31 synthetic tables from one snapshot", async () => {
      const b = await takeFullBackup(root, () =>
        verifyPhysicalBackupIdentity(root, ref)
      );
      const dir = "/tmp/l4ckos-physical-cipher-" + randomUUID();
      await mkdir(dir, { mode: 0o700 });
      const key = randomBytes(32);
      const proof = await writeEncryptedBackup(b, dir + "/backup.enc", key);
      const bytes = await readFile(dir + "/backup.enc");
      expect(bytes.toString()).not.toContain("Fixture Admin");
      const restored = decryptBackup(bytes, key, proof.ciphertextSha256);
      expect(Object.keys(restored.tables)).toHaveLength(31);
      const clone =
        "l4ckos_test_restore_" + randomUUID().replaceAll("-", "").slice(0, 10);
      await root.query("CREATE DATABASE " + clone);
      const c = await createConnection({
        user: "root",
        password,
        socketPath: socket,
        database: clone,
        dateStrings: true,
        jsonStrings: true,
        timezone: "Z",
        supportBigNumbers: true,
        bigNumberStrings: true,
      });
      try {
        const result = await restoreFullBackup(c, restored, socket);
        expect(result.tables).toBe(31);
        expect(
          (await rows(c, "SELECT stock FROM products WHERE id=1"))[0].stock
        ).toBe(98);
        expect(
          Number(
            (
              await rows(c, "SELECT COUNT(*) n FROM _l4ckos_schema_migrations")
            )[0].n
          )
        ).toBe(1);
      } finally {
        await c.end();
        await root.query("DROP DATABASE " + clone);
        key.fill(0);
        await rm(dir, { recursive: true });
      }
    }, 30000);
    it("rolls back failed export and returns no artifact", async () => {
      let calls = 0;
      const identity = async () => {
        await verifyPhysicalBackupIdentity(root, ref);
        if (++calls === 2) throw Error("WINDOW_TEST_POST_SNAPSHOT_FAILURE");
      };
      await expect(takeFullBackup(root, identity)).rejects.toThrow(
        "WINDOW_TEST_POST_SNAPSHOT_FAILURE"
      );
      // MySQL rejects SET TRANSACTION during an active transaction; success proves rollback closed it.
      await expect(
        root.query("SET TRANSACTION READ ONLY")
      ).resolves.toBeDefined();
    });
  }
);

describe("offline manifest and transport preparation", () => {
  it("verifies independently supplied manifest hash and prepares four strict SSH guards", async () => {
    const { verifyPhysicalBackupPackage } = await import(
      "../../scripts/verify-physical-backup-package"
    );
    const dir = process.env.L4CKOS_PHYSICAL_PACKAGE_DIR!;
    const hash = sha256(await readFile(dir + "/manifest.json"));
    const proof = await verifyPhysicalBackupPackage(dir, hash);
    expect(proof.remoteExecuted).toBe(false);
    expect(proof.request.mode).toBe("dry-run");
    expect(proof.sshGuard).toContain("RAILWAY_DEPLOYMENT_ID");
    expect(proof.sshGuard).not.toContain("MYSQL_DATABASE");
    await expect(
      verifyPhysicalBackupPackage(dir, "a".repeat(64))
    ).rejects.toThrow("WINDOW_PACKAGE_MANIFEST_INTEGRITY");
  });
  it("rejects changed artifact without touching a connection", async () => {
    const { verifyPhysicalBackupPackage } = await import(
      "../../scripts/verify-physical-backup-package"
    );
    const { writeFile, copyFile } = await import("node:fs/promises");
    const source = process.env.L4CKOS_PHYSICAL_PACKAGE_DIR!;
    const dir = "/tmp/l4ckos-physical-backup-tamper-" + randomUUID();
    await mkdir(dir, { mode: 0o700 });
    try {
      for (const f of ["manifest.json", "reference.json"]) {
        await copyFile(source + "/" + f, dir + "/" + f);
        await (await import("node:fs/promises")).chmod(dir + "/" + f, 0o600);
      }
      await writeFile(dir + "/financial-backup.cjs", "synthetic_changed", {
        mode: 0o600,
      });
      await expect(
        verifyPhysicalBackupPackage(
          dir,
          sha256(await readFile(dir + "/manifest.json"))
        )
      ).rejects.toThrow("WINDOW_PACKAGE_ARTIFACT_INTEGRITY");
    } finally {
      await rm(dir, { recursive: true });
    }
  });
});
