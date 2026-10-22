import { it, expect, vi } from "vitest";
import { spawn, type ChildProcess } from "node:child_process";
import { EventEmitter } from "node:events";
import { mkdir, writeFile, rm } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import {
  captureTunnelProcess,
  parseTunnelOutput,
  assertLoopbackListener,
  PrivateMysqlTcpTunnel,
} from "../../database/financialWindow/privateMysqlTunnel";
import {
  TunnelFailure,
  auditTunnelTemporaryArtifacts,
  reportedTunnelFailure,
} from "../../database/financialWindow/tunnelDiagnostics";
import { inspectPrivateBackupTransport } from "../../database/financialWindow/externalBackup";
import { BACKUP_TARGET } from "../../database/financialWindow/backupIdentity";
const output = () =>
  "  Host:     127.0.0.1\n  Port:     3307\n  User:     root\n  Password: synthetic-secret\n  Database: l4ckos_staging\n  URL:      mysql://root:synthetic-secret@127.0.0.1:3307/l4ckos_staging\nPress Ctrl+C to close the tunnel.\n";
const child = (script: string) =>
  spawn(process.execPath, ["-e", script], {
    detached: true,
    stdio: ["ignore", "pipe", "pipe"],
  });
it("uses exact CLI contract on stderr, no TTY, secret-free diagnostics", async () => {
  const c = child(
      `process.stderr.write(${JSON.stringify(output())});setInterval(()=>{},1000)`
    ),
    p = captureTunnelProcess(c);
  try {
    expect((await p.ready).user).toBe("root");
    expect(p.diagnostic!().readiness).toBe("ENDPOINT_VALIDATED");
    expect(JSON.stringify(p.diagnostic!())).not.toContain("synthetic-secret");
  } finally {
    await p.close();
  }
  expect(p.diagnostic!().shutdown).toBe("EXITED");
});
it.each(["stdout", "stderr"])(
  "classifies unknown format on %s without disclosing content",
  async channel => {
    const c = child(
        `process.${channel}.write('secret-url synthetic-secret\\nPress Ctrl+C to close the tunnel.\\n');setInterval(()=>{},1000)`
      ),
      p = captureTunnelProcess(c);
    try {
      await expect(p.ready).rejects.toThrow("WINDOW_TUNNEL_ENDPOINT_FORMAT");
    } finally {
      await p.close();
    }
    expect(p.diagnostic!().shutdown).toBe("EXITED");
  }
);
it("classifies exit-before-readiness and preserves numeric exit code", async () => {
  const p = captureTunnelProcess(
    child("process.stderr.write('synthetic-secret');process.exit(23)")
  );
  let error: any;
  try {
    await p.ready;
  } catch (e) {
    error = e;
  }
  await p.close();
  expect(error.code).toBe("WINDOW_TUNNEL_EXIT_BEFORE_READY");
  expect(error.diagnostic().exitCode).toBe(23);
  expect(JSON.stringify(error)).not.toContain("synthetic-secret");
});
it("classifies reported publickey rejection even fragmented, never from credential labels", async () => {
  expect(
    reportedTunnelFailure("  Password: Permission denied (publickey).")
  ).toBeUndefined();
  const p = captureTunnelProcess(
    child(
      "process.stderr.write('Permission denied ');setTimeout(()=>{process.stderr.write('(publickey).\\n');process.exit(1)},20)"
    )
  );
  await expect(p.ready).rejects.toThrow(
    "WINDOW_TUNNEL_SSH_AUTH_REJECTION_REPORTED"
  );
  await p.close();
});
it("classifies spawn failure and readiness deadline separately", async () => {
  const missing = spawn("/tmp/l4ckos-nonexistent-synthetic-program", [], {
      detached: true,
      stdio: ["ignore", "pipe", "pipe"],
    }),
    p = captureTunnelProcess(missing, 100);
  await expect(p.ready).rejects.toThrow("WINDOW_TUNNEL_SPAWN_FAILED");
  await p.close().catch(() => {});
  const timeout = captureTunnelProcess(child("setInterval(()=>{},1000)"), 30);
  await expect(timeout.ready).rejects.toThrow("WINDOW_TUNNEL_READY_TIMEOUT");
  await timeout.close();
  expect(timeout.diagnostic!().shutdown).toBe("EXITED");
});
it("preserves Gate B failure through transport and inspection catch boundaries", async () => {
  const p = captureTunnelProcess(child("process.exit(7)"));
  const inventory = async () => ({
    projectId: BACKUP_TARGET.projectId,
    environmentId: BACKUP_TARGET.environmentId,
    capturedAt: Date.now(),
    services: [
      {
        id: BACKUP_TARGET.mysqlServiceId,
        name: "mysql",
        deploymentId: BACKUP_TARGET.mysqlDeploymentId,
        active: true,
      },
    ],
  });
  const t = new PrivateMysqlTcpTunnel(inventory, () => p);
  await expect(inspectPrivateBackupTransport(t)).rejects.toThrow(
    "WINDOW_TUNNEL_EXIT_BEFORE_READY"
  );
  expect(p.diagnostic!().exitCode).toBe(7);
});
it("distinguishes listener absent from non-loopback", async () => {
  const { createServer } = await import("node:net");
  const server = createServer();
  await new Promise<void>(r => server.listen(0, "127.0.0.1", r));
  const port = (server.address() as any).port;
  await new Promise<void>(r => server.close(() => r()));
  await expect(assertLoopbackListener(port)).rejects.toThrow(
    "WINDOW_TUNNEL_LISTENER_ABSENT"
  );
  expect(() =>
    parseTunnelOutput(output().replaceAll("127.0.0.1", "8.8.8.8"))
  ).not.toThrow(); // parsing alone is not endpoint approval
});
it("reports cleanup failure without claiming shutdown", async () => {
  const fake = new EventEmitter() as any;
  fake.pid = undefined;
  fake.exitCode = null;
  fake.signalCode = null;
  fake.stdout = new EventEmitter();
  fake.stderr = new EventEmitter();
  const p = captureTunnelProcess(fake as ChildProcess, 20);
  await expect(p.ready).rejects.toThrow("WINDOW_TUNNEL_READY_TIMEOUT");
  await expect(p.close()).rejects.toThrow("WINDOW_TUNNEL_CLEANUP_FAILED");
  expect(p.diagnostic!().shutdown).toBe("FAILED");
}, 5000);
it("audits only file permissions/presence, never content or path names", async () => {
  const dir = "/tmp/l4ckos-tunnel-permissions-" + randomUUID();
  await mkdir(dir, { mode: 0o700 });
  const secret = dir + "/secret";
  try {
    await writeFile(secret, "synthetic-secret", { mode: 0o600 });
    expect(await auditTunnelTemporaryArtifacts([dir, secret])).toEqual({
      presence: "PRESENT",
      permissionsSafe: true,
    });
    await (await import("node:fs/promises")).chmod(secret, 0o644);
    let error: any;
    try {
      await auditTunnelTemporaryArtifacts([secret]);
    } catch (e) {
      error = e;
    }
    expect(error.code).toBe("WINDOW_TUNNEL_TEMP_UNSAFE");
    expect(JSON.stringify(error)).not.toContain(secret);
    expect(JSON.stringify(error)).not.toContain("synthetic-secret");
  } finally {
    await rm(dir, { recursive: true });
  }
});

it("fails readiness on unsafe temporary artifact before returning credentials", async () => {
  const dir = "/tmp/l4ckos-tunnel-unsafe-" + randomUUID();
  await mkdir(dir, { mode: 0o700 });
  await writeFile(dir + "/fixture", "synthetic-secret", { mode: 0o644 });
  const p = captureTunnelProcess(
    child(
      `process.stderr.write(${JSON.stringify(output())});setInterval(()=>{},1000)`
    ),
    1000,
    () => auditTunnelTemporaryArtifacts([dir + "/fixture"])
  );
  try {
    await expect(p.ready).rejects.toThrow("WINDOW_TUNNEL_TEMP_UNSAFE");
    await p.close();
    expect(p.diagnostic!().temporaryArtifacts).toEqual({
      presence: "PRESENT",
      permissionsSafe: false,
    });
  } finally {
    await p.close();
    await rm(dir, { recursive: true });
  }
});
it("preserves sanitized failures across independently bundled adapters and inspector", async () => {
  const { build } = await import("esbuild");
  const { runInNewContext } = await import("node:vm");
  const { createRequire } = await import("node:module");
  const req = createRequire(process.cwd() + "/package.json");
  async function library(entry: string) {
    const b = await build({
      entryPoints: [entry],
      write: false,
      bundle: true,
      platform: "node",
      format: "cjs",
      packages: "external",
    });
    const module = { exports: {} };
    runInNewContext(b.outputFiles[0].text, {
      require: req,
      module,
      exports: module.exports,
      process,
      performance,
      setInterval,
      clearInterval,
      setTimeout,
      clearTimeout,
      Buffer,
      console,
    });
    return module.exports as any;
  }
  const adapter = await library(
      "database/financialWindow/privateMysqlTunnel.ts"
    ),
    inspection = await library("database/financialWindow/externalBackup.ts");
  const p = adapter.captureTunnelProcess(child("process.exit(29)"));
  const inventory = async () => ({
    projectId: BACKUP_TARGET.projectId,
    environmentId: BACKUP_TARGET.environmentId,
    capturedAt: Date.now(),
    services: [
      {
        id: BACKUP_TARGET.mysqlServiceId,
        name: "mysql",
        deploymentId: BACKUP_TARGET.mysqlDeploymentId,
        active: true,
      },
    ],
  });
  const t = new adapter.PrivateMysqlTcpTunnel(inventory, () => p);
  let error: any;
  try {
    await inspection.inspectPrivateBackupTransport(t);
  } catch (e) {
    error = e;
  }
  expect(error.message).toBe("WINDOW_TUNNEL_EXIT_BEFORE_READY");
  expect(error.diagnostic().exitCode).toBe(29);
  expect(error.diagnostic().shutdown).toBe("EXITED");
});

it("does not mark detached SSH-like descendants as cleaned up when only Railway exits", async () => {
  let descendant: number | undefined;
  const c = child(
    `const {spawn}=require('child_process');const nested=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{detached:true,stdio:'ignore'});nested.unref();process.stdout.write('SYNTHETIC_CHILD='+nested.pid+'\\n');process.stderr.write(${JSON.stringify(output())});process.on('SIGINT',()=>{});setInterval(()=>{},1000)`
  );
  c.stdout!.on("data", b => {
    descendant = Number(/SYNTHETIC_CHILD=(\d+)/.exec(b.toString())?.[1]);
  });
  const p = captureTunnelProcess(c);
  try {
    await p.ready;
    await expect(p.close()).rejects.toThrow("WINDOW_TUNNEL_CLEANUP_FAILED");
    expect(p.diagnostic!().shutdown).toBe("FAILED");
  } finally {
    if (descendant)
      try {
        process.kill(-descendant, "SIGKILL");
      } catch {}
  }
}, 5000);
it("records safe state even when a CLI-looking error appears inside a credential", async () => {
  const text = output().replaceAll(
    "synthetic-secret",
    "Permission%20denied%20%28publickey%29."
  );
  expect(reportedTunnelFailure(text)).toBeUndefined();
});

it("classifies only reported known failures, preserving unknown causes as unknown", () => {
  expect(reportedTunnelFailure("Error: No registered SSH keys found.")).toBe(
    "WINDOW_TUNNEL_SSH_KEY_MISSING_REPORTED"
  );
  expect(
    reportedTunnelFailure(
      "Error: SSH tunnel exited before it was ready (exit status: 255)"
    )
  ).toBe("WINDOW_TUNNEL_SSH_EXIT_REPORTED");
  expect(
    reportedTunnelFailure("synthetic-secret random failure")
  ).toBeUndefined();
  expect(reportedTunnelFailure("Error: something different")).toBeUndefined();
});
it("cleanup failure cannot overwrite an earlier readiness failure in inspection", async () => {
  const diagnostic = () => ({
    ...new TunnelFailure("WINDOW_TUNNEL_READY_TIMEOUT").diagnostic(),
    shutdown: "FAILED" as const,
  });
  const close = vi.fn(async () => {
    throw new TunnelFailure("WINDOW_TUNNEL_CLEANUP_FAILED");
  });
  const railway = {
    RAILWAY_PROJECT_ID: BACKUP_TARGET.projectId,
    RAILWAY_ENVIRONMENT_ID: BACKUP_TARGET.environmentId,
    RAILWAY_SERVICE_ID: BACKUP_TARGET.mysqlServiceId,
    RAILWAY_DEPLOYMENT_ID: BACKUP_TARGET.mysqlDeploymentId,
  };
  let error: any;
  try {
    await inspectPrivateBackupTransport({
      kind: "tcp",
      attest: async () => ({ authenticated: true, restricted: true, railway }),
      connectTcp: async () => {
        throw new TunnelFailure("WINDOW_TUNNEL_READY_TIMEOUT", diagnostic);
      },
      close,
    });
  } catch (e) {
    error = e;
  }
  expect(error.message).toBe("WINDOW_TUNNEL_READY_TIMEOUT");
  expect(error.diagnostic().shutdown).toBe("FAILED");
  expect(close).toHaveBeenCalled();
});

it("serializes exactly the diagnostic allowlist even with hostile extra fields", () => {
  const error = new TunnelFailure(
    "WINDOW_TUNNEL_READY_TIMEOUT",
    () =>
      ({
        phase: "synthetic-secret",
        category: "synthetic-secret",
        code: "WINDOW_TUNNEL_READY_TIMEOUT",
        exitCode: 2,
        durationMs: 10,
        readiness: "FAILED",
        shutdown: "EXITED",
        password: "synthetic-secret",
        temporaryArtifacts: {
          presence: "PRESENT",
          permissionsSafe: true,
          content: "synthetic-secret",
        },
      }) as any
  );
  expect(JSON.stringify(error)).not.toContain("synthetic-secret");
  expect(Object.keys(error.diagnostic()).sort()).toEqual(
    [
      "phase",
      "category",
      "code",
      "exitCode",
      "durationMs",
      "readiness",
      "shutdown",
      "temporaryArtifacts",
    ].sort()
  );
});
