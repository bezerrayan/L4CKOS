import { execFileSync, spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { gunzipSync } from "node:zlib";
import { openBackupConnection } from "../../server/database/backupRestore";
import { assertLocalSchemaTarget, type LocalTarget } from "../schema/safety";
import { rows } from "../schema/fingerprint";
import { proveRestore, verifyPrivateGzip } from "./evidence";
import { fail, type BackupProof } from "./policy";

/** Fixed local Docker daemon/container only. Cannot import into Railway or TCP. */
export async function restoreAndProve(
  local: LocalTarget,
  artifact: string,
  repository: string,
  source: Pick<BackupProof, "sourceBefore" | "sourceAfter" | "createdAt">
) {
  assertLocalSchemaTarget(local);
  if (!local.socketPath) fail("LOCAL_RESTORE_SOCKET_REQUIRED");
  const client = ["--host", "unix:///var/run/docker.sock"],
    container = "l4ckos-0022-local-test";
  const inspect = JSON.parse(
    execFileSync(
      "docker",
      [
        ...client,
        "inspect",
        "--format",
        "{{json .HostConfig.NetworkMode}}|{{json .Mounts}}",
        container,
      ],
      { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }
    ).split("|")[0]
  );
  const mounts = JSON.parse(
    execFileSync(
      "docker",
      [...client, "inspect", "--format", "{{json .Mounts}}", container],
      { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }
    )
  );
  if (
    inspect !== "none" ||
    !mounts.some(
      (m: { Source: string; Destination: string }) =>
        m.Source === path.dirname(local.socketPath!) &&
        m.Destination === "/var/run/mysqld"
    )
  )
    fail("ISOLATED_LOCAL_CONTAINER_REQUIRED");
  const file = await verifyPrivateGzip(artifact, repository),
    c = await openBackupConnection(local.url, local.socketPath);
  try {
    if (
      Number(
        (
          await rows(
            c,
            "SELECT COUNT(*) n FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE()"
          )
        )[0].n
      ) !== 0
    )
      fail("EMPTY_LOCAL_RESTORE_REQUIRED");
    const content = gunzipSync(await readFile(artifact), {
      maxOutputLength: 1024 * 1024 * 1024,
    });
    const result = spawnSync(
      "docker",
      [
        ...client,
        "exec",
        "-i",
        container,
        "mysql",
        "--socket=/var/run/mysqld/mysqld.sock",
        "-uroot",
        `--database=${c.config.database}`,
      ],
      {
        input: content,
        stdio: ["pipe", "pipe", "pipe"],
        timeout: 120000,
        maxBuffer: 1024 * 1024,
      }
    );
    if (result.status !== 0 || result.error) fail("LOCAL_SQL_IMPORT_FAILED");
    return await proveRestore(c, local, { ...source, ...file });
  } finally {
    await c.end();
  }
}
