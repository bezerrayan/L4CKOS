import { tcpBackupReference } from "./tcpBackupPolicy";
import { withBackupLock } from "./backupLock";
import { isTunnelFailure, tunnelFailure } from "./tunnelDiagnostics";
// Library only: no SSH implementation, endpoint, environment loading or automatic retry.
import type { Connection } from "mysql2/promise";
import { readFile } from "node:fs/promises";
import {
  assertBackupRailway,
  verifyPhysicalBackupIdentity,
  BACKUP_TARGET,
  type PhysicalReference,
} from "./backupIdentity";
import { takeFullBackup, writeEncryptedBackup, decryptBackup } from "./backup";
import { sha256 } from "../schema/fingerprint";

export interface PrivateBackupTransport {
  // Trusted adapter obtains these from guarded runtime or fresh authenticated provider metadata, never self-declared local env.
  attest(): Promise<{
    authenticated: boolean;
    restricted: boolean;
    railway: Record<string, string | undefined>;
  }>;
  // TCP is explicit, never a fallback from UNIX socket.
  kind?: "tcp";
  connectSocket?(): Promise<Connection>;
  connectTcp?(): Promise<Connection>;
  connectBackupLock?(): Promise<Connection>;
  close(): Promise<void>;
}
export interface BackupCustody {
  recoverKey(reference: string): Promise<Buffer>;
  putCiphertext(bytes: Buffer, hash: string): Promise<void>;
  readCiphertext(hash: string): Promise<Buffer>;
}
export async function exportThroughPrivateTransport(
  transport: PrivateBackupTransport,
  custody: BackupCustody,
  config: { path: string; keyReference: string }
) {
  return run(
    transport,
    custody,
    config,
    transport.kind === "tcp" ? tcpBackupReference() : BACKUP_TARGET
  );
}
// Separately exported only for isolated synthetic rehearsals. No production CLI override exists.
export async function rehearseExternalBackup(
  transport: PrivateBackupTransport,
  custody: BackupCustody,
  config: { path: string; keyReference: string },
  ref: PhysicalReference
) {
  if (!/^l4ckos_test_[a-z0-9_]+$/.test(ref.database))
    throw Error("WINDOW_LOCAL_FIXTURE_REQUIRED");
  return run(transport, custody, config, ref);
}
async function run(
  transport: PrivateBackupTransport,
  custody: BackupCustody,
  config: { path: string; keyReference: string },
  ref: PhysicalReference
) {
  let c: Connection | undefined,
    key: Buffer | undefined,
    recovered: Buffer | undefined;
  try {
    if (
      Object.keys(config).sort().join(",") !== "keyReference,path" ||
      !/^[a-z0-9-]{1,80}$/.test(config.keyReference) ||
      !/^\/tmp\/l4ckos-[a-z0-9-]+\/backup\.enc$/.test(config.path)
    )
      throw Error("WINDOW_BACKUP_CONFIGURATION");
    const attest = async () => {
      const a = await transport.attest();
      if (a.authenticated !== true || a.restricted !== true)
        throw Error("WINDOW_BACKUP_TRANSPORT");
      assertBackupRailway(a.railway);
    };
    await attest();
    key = await custody.recoverKey(config.keyReference);
    if (key.length !== 32) throw Error("WINDOW_BACKUP_KEY_CUSTODY");
    if (transport.kind === "tcp") {
      if (!transport.connectTcp || transport.connectSocket)
        throw Error("WINDOW_BACKUP_TRANSPORT");
      c = await transport.connectTcp();
    } else {
      if (!transport.connectSocket || transport.connectTcp)
        throw Error("WINDOW_BACKUP_TRANSPORT");
      c = await transport.connectSocket();
    }
    const identity = async () => {
      await attest();
      await verifyPhysicalBackupIdentity(c!, ref);
    };
    if (!transport.connectBackupLock)
      throw Error("WINDOW_BACKUP_DEDICATED_LOCK_REQUIRED");
    const lock = await transport.connectBackupLock();
    const { proof, bytes } = await withBackupLock(
      lock,
      c,
      async connection => {
        await attest();
        await verifyPhysicalBackupIdentity(connection, ref);
      },
      async (continuity, progress) => {
        const backup = await takeFullBackup(c!, identity, continuity, progress);
        await continuity();
        const proof = await writeEncryptedBackup(backup, config.path, key!);
        const bytes = await readFile(config.path);
        decryptBackup(bytes, key!, proof.ciphertextSha256);
        await continuity();
        return { proof, bytes };
      }
    );
    // Authenticate locally BEFORE storage receives any bytes; key provider is separate from storage.
    decryptBackup(bytes, key, proof.ciphertextSha256);
    await custody.putCiphertext(bytes, proof.ciphertextSha256);
    const copy = await custody.readCiphertext(proof.ciphertextSha256);
    if (sha256(copy) !== proof.ciphertextSha256)
      throw Error("WINDOW_BACKUP_DURABLE_READBACK");
    recovered = await custody.recoverKey(config.keyReference);
    decryptBackup(copy, recovered, proof.ciphertextSha256);
    return {
      status: "ENCRYPTED_COPY_VERIFIED",
      ciphertextSha256: proof.ciphertextSha256,
      bodyHash: proof.bodyHash,
      tables: proof.tables,
      restore: "NOT_PROVEN",
    };
  } catch (error) {
    if (isTunnelFailure(error)) throw tunnelFailure(error);
    throw Error(
      error instanceof Error && /^WINDOW_[A-Z_]+$/.test(error.message)
        ? error.message
        : "WINDOW_BACKUP_FAILED"
    );
  } finally {
    key?.fill(0);
    recovered?.fill(0);
    try {
      await c?.end().catch(() => {});
    } finally {
      try {
        await transport.close();
      } catch (error) {
        if (isTunnelFailure(error)) throw tunnelFailure(error);
        throw Error("WINDOW_BACKUP_TRANSPORT_CLOSE");
      }
    }
  }
}

// Future read-only proof: metadata/identity only, no business rows or export/key/storage.
export async function inspectPrivateBackupTransport(
  transport: PrivateBackupTransport
) {
  let c: Connection | undefined;
  let failed = false;
  try {
    const a = await transport.attest();
    if (a.authenticated !== true || a.restricted !== true)
      throw Error("WINDOW_BACKUP_TRANSPORT");
    assertBackupRailway(a.railway);
    if (transport.kind === "tcp") {
      if (!transport.connectTcp || transport.connectSocket)
        throw Error("WINDOW_BACKUP_TRANSPORT");
      c = await transport.connectTcp();
    } else {
      if (!transport.connectSocket || transport.connectTcp)
        throw Error("WINDOW_BACKUP_TRANSPORT");
      c = await transport.connectSocket();
    }
    await c.query("SET TRANSACTION READ ONLY");
    await c.query("START TRANSACTION READ ONLY");
    await verifyPhysicalBackupIdentity(
      c,
      transport.kind === "tcp" ? tcpBackupReference() : BACKUP_TARGET
    );
    const post = await transport.attest();
    if (post.authenticated !== true || post.restricted !== true)
      throw Error("WINDOW_BACKUP_TRANSPORT");
    assertBackupRailway(post.railway);
    await c.rollback();
    return {
      status: "READ_ONLY_IDENTITY_VERIFIED",
      businessRowsRead: false,
      backupCreated: false,
      tables: BACKUP_TARGET.tableCount,
    };
  } catch (error) {
    failed = true;
    if (isTunnelFailure(error)) throw tunnelFailure(error);
    throw Error("WINDOW_BACKUP_INSPECTION_STOPPED");
  } finally {
    try {
      if (c) {
        await c.rollback().catch(() => {});
        await c.end().catch(() => {});
      }
    } finally {
      try {
        await transport.close();
      } catch (error) {
        if (!failed) {
          if (isTunnelFailure(error)) throw tunnelFailure(error);
          throw Error("WINDOW_BACKUP_TRANSPORT_CLOSE");
        }
      }
    }
  }
}
