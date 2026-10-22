// Approved private reference. No env/stdin overrides, discovery adoption or credentials.
import { readFileSync, lstatSync } from "node:fs";
import type { Connection } from "mysql2/promise";
import { sha256, canonical } from "../schema/fingerprint";
import { BACKUP_TARGET } from "./backupIdentity";
export const TCP_BACKUP_POLICY_PATH =
  "/tmp/l4ckos-tcp-backup-policy-approved-20261014/policy.json";
export const TCP_BACKUP_POLICY_SHA256 =
  "d026481ce8b99b19949602dc7762d9a8eca1fc662589f222d06749cbd2144cf2";
export function approvedTcpBackupPolicy(): Readonly<{
  expectedLogin: string;
  expectedCurrentUser: string;
}> {
  try {
    const dir = lstatSync(
        TCP_BACKUP_POLICY_PATH.slice(0, TCP_BACKUP_POLICY_PATH.lastIndexOf("/"))
      ),
      file = lstatSync(TCP_BACKUP_POLICY_PATH);
    if (
      !dir.isDirectory() ||
      dir.isSymbolicLink() ||
      (dir.mode & 511) !== 448 ||
      dir.uid !== process.getuid?.() ||
      !file.isFile() ||
      file.isSymbolicLink() ||
      (file.mode & 511) !== 384 ||
      file.uid !== process.getuid?.()
    )
      throw Error();
    const bytes = readFileSync(TCP_BACKUP_POLICY_PATH);
    if (sha256(bytes) !== TCP_BACKUP_POLICY_SHA256) throw Error();
    const p = JSON.parse(bytes.toString());
    if (
      p.version !== 1 ||
      p.purpose !== "STAGING_TCP_BACKUP_ONLY" ||
      p.approval !== "FOUNDER_EXPLICIT_TCP_POLICY_20261014" ||
      p.sourceManifestSha256 !==
        "0db8cbc18cf2555fa26e13faa07538297b5ef05710aaf7b9cfa89ac814dbc667" ||
      p.retentionDays !== 90 ||
      canonical(p.target) !==
        canonical({
          projectId: BACKUP_TARGET.projectId,
          environmentId: BACKUP_TARGET.environmentId,
          mysqlServiceId: BACKUP_TARGET.mysqlServiceId,
          mysqlDeploymentId: BACKUP_TARGET.mysqlDeploymentId,
        }) ||
      typeof p.expectedLogin !== "string" ||
      !p.expectedLogin ||
      /[\r\n\0]/.test(p.expectedLogin) ||
      typeof p.expectedCurrentUser !== "string" ||
      !p.expectedCurrentUser.includes("@")
    )
      throw Error();
    return Object.freeze({
      expectedLogin: p.expectedLogin,
      expectedCurrentUser: p.expectedCurrentUser,
    });
  } catch {
    throw Error("WINDOW_BACKUP_TCP_POLICY_INTEGRITY");
  }
}
export function assertTcpAuthenticatedIdentity(
  id: { login?: unknown; account?: unknown },
  policy = approvedTcpBackupPolicy()
) {
  if (
    typeof id.login !== "string" ||
    id.login.lastIndexOf("@") < 1 ||
    id.login.slice(0, id.login.lastIndexOf("@")) !== policy.expectedLogin ||
    id.account !== policy.expectedCurrentUser
  )
    throw Error("WINDOW_BACKUP_TCP_ACCOUNT");
}
export async function verifyTcpAuthenticatedIdentity(c: Connection) {
  try {
    const [rows] = await c.query("SELECT USER() login,CURRENT_USER() account");
    if (!Array.isArray(rows) || rows.length !== 1) throw Error();
    assertTcpAuthenticatedIdentity(
      rows[0] as { login?: unknown; account?: unknown }
    );
  } catch {
    throw Error("WINDOW_BACKUP_TCP_ACCOUNT");
  }
}
export function tcpBackupReference() {
  const policy = approvedTcpBackupPolicy();
  return {
    ...BACKUP_TARGET,
    login: policy.expectedLogin,
    account: policy.expectedCurrentUser,
  };
}
