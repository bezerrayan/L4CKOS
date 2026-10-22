import { it, expect, vi } from "vitest";
// Synthetic fixed policy for contract fixtures; real approved-reference behavior is
// covered separately by tcpBackupPolicy.test.ts (no remote credentials).
vi.mock("../../database/financialWindow/tcpBackupPolicy", async () => {
  const { BACKUP_TARGET } = await import("../../database/financialWindow/backupIdentity");
  return {approvedTcpBackupPolicy:()=>Object.freeze({expectedLogin:"root",expectedCurrentUser:"root@localhost"}),
    tcpBackupReference:()=>({...BACKUP_TARGET,login:"root",account:"root@localhost"}),
    verifyTcpAuthenticatedIdentity:async()=>{}};
});
import { spawn } from "node:child_process";
import { BACKUP_TARGET } from "../../database/financialWindow/backupIdentity";
import {
  resolveTunnelService,
  tunnelArguments,
  parseTunnelOutput,
  validateTunnelEndpoint,
  captureTunnelProcess,
  PrivateMysqlTcpTunnel,
  type TunnelInventory,
} from "../../database/financialWindow/privateMysqlTunnel";
const inventory = (): TunnelInventory => ({
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
export const output = (port = 3307, password = "synthetic-secret") =>
  `mysql tunnel open — point an external client at:\n  Host:     127.0.0.1\n  Port:     ${port}\n  User:     root\n  Password: ${password}\n  Database: l4ckos_staging\n  URL:      mysql://root:${password}@127.0.0.1:${port}/l4ckos_staging\nPress Ctrl+C to close the tunnel.\n`;
it("constructs only full UUID scope and service resolved from UUID", () => {
  const args = tunnelArguments(inventory());
  expect(args).toEqual([
    "connect",
    "mysql",
    "--project",
    BACKUP_TARGET.projectId,
    "--environment",
    BACKUP_TARGET.environmentId,
    "--ssh",
    "--tunnel-only",
  ]);
});
it.each([
  "project",
  "environment",
  "deployment",
  "inactive",
  "duplicateUuid",
  "duplicateName",
  "stale",
  "future",
  "unsafeName",
  "missing",
])("rejects %s before tunnel start", async fault => {
  const i = inventory();
  if (fault === "project") i.projectId = "wrong";
  if (fault === "environment") i.environmentId = "production";
  if (fault === "deployment") i.services[0].deploymentId = "wrong";
  if (fault === "inactive") i.services[0].active = false;
  if (fault === "duplicateUuid") i.services.push({ ...i.services[0] });
  if (fault === "duplicateName")
    i.services.push({ ...i.services[0], id: "other" });
  if (fault === "stale") i.capturedAt -= 31000;
  if (fault === "future") i.capturedAt += 10000;
  if (fault === "unsafeName") i.services[0].name = "--no-ssh";
  if (fault === "missing") i.services = [];
  const start = vi.fn();
  const t = new PrivateMysqlTcpTunnel(async () => i, start);
  await expect(t.connectTcp()).rejects.toThrow("WINDOW_TUNNEL_");
  expect(start).not.toHaveBeenCalled();
});
it("parses private output without exposing credentials through errors", () => {
  const e = parseTunnelOutput(output());
  validateTunnelEndpoint(e, BACKUP_TARGET.database);
  expect(e.password).toBe("synthetic-secret");
});
it.each(["host", "url", "duplicate", "ansi", "overflow", "missing"])(
  "rejects unexpected private output %s",
  fault => {
    let s = output();
    if (fault === "host") s = s.replaceAll("127.0.0.1", "0.0.0.0");
    if (fault === "url") s = s.replace("mysql://", "https://");
    if (fault === "duplicate") s += "  Password: leaked\n";
    if (fault === "ansi") s += "\x1b[31m";
    if (fault === "overflow") s += "x".repeat(17000);
    if (fault === "missing") s = s.replace("  User:     root\n", "");
    try {
      validateTunnelEndpoint(parseTunnelOutput(s), BACKUP_TARGET.database);
      throw Error("accepted");
    } catch (e) {
      expect(String(e)).toMatch(/WINDOW_TUNNEL_/);
      expect(String(e)).not.toContain("synthetic-secret");
    }
  }
);
it("captures chunked child output privately and kills child on close", async () => {
  const log = vi.spyOn(console, "log");
  const err = vi.spyOn(console, "error");
  const child = spawn(
    process.execPath,
    [
      "-e",
      `const s=${JSON.stringify(output())};process.stdout.write(s.slice(0,30));setTimeout(()=>process.stdout.write(s.slice(30)),10);setInterval(()=>{},1000)`,
    ],
    { detached: true, stdio: ["ignore", "pipe", "pipe"] }
  );
  const p = captureTunnelProcess(child);
  expect((await p.ready).host).toBe("127.0.0.1");
  await p.close();
  expect(p.alive()).toBe(false);
  expect(child.exitCode !== null || child.signalCode !== null).toBe(true);
  expect(log).not.toHaveBeenCalled();
  expect(err).not.toHaveBeenCalled();
  log.mockRestore();
  err.mockRestore();
});
it.each(["exit", "timeout", "overflow"])(
  "sanitizes child %s and terminates",
  async fault => {
    const script =
      fault === "exit"
        ? "process.stderr.write('synthetic-secret');process.exit(1)"
        : fault === "overflow"
          ? "process.stdout.write('synthetic-secret'.repeat(3000));setInterval(()=>{},1000)"
          : "setInterval(()=>{},1000)";
    const child = spawn(process.execPath, ["-e", script], {
      detached: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const p = captureTunnelProcess(child, 100);
    await expect(p.ready).rejects.toThrow(
      fault === "exit"
        ? "WINDOW_TUNNEL_EXIT_BEFORE_READY"
        : fault === "overflow"
          ? "WINDOW_TUNNEL_OUTPUT_LIMIT"
          : "WINDOW_TUNNEL_READY_TIMEOUT"
    );
    await p.close();
    expect(p.alive()).toBe(false);
  }
);
it("rejects unexpected endpoint before mysql handshake and closes provider", async () => {
  const close = vi.fn(async () => {});
  const t = new PrivateMysqlTcpTunnel(
    async () => inventory(),
    () => ({
      ready: Promise.resolve({
        host: "external.invalid",
        port: 3307,
        user: "root",
        password: "synthetic-secret",
        database: BACKUP_TARGET.database,
      }),
      alive: () => true,
      onStop: () => {},
      close,
    })
  );
  await expect(t.connectTcp()).rejects.toThrow("WINDOW_TUNNEL_ENDPOINT_HOST");
  expect(close).toHaveBeenCalled();
});

it("rejects public fallback arguments before spawning any Railway process", async () => {
  const { startRailwayTunnel } = await import(
    "../../database/financialWindow/privateMysqlTunnel"
  );
  expect(() => startRailwayTunnel(["connect", "mysql", "--no-ssh"])).toThrow(
    "WINDOW_TUNNEL_ARGUMENTS"
  );
});
it("aborted request never opens a tunnel", async () => {
  const controller = new AbortController();
  controller.abort();
  const start = vi.fn();
  const t = new PrivateMysqlTcpTunnel(
    async () => inventory(),
    start,
    BACKUP_TARGET.database,
    controller.signal
  );
  await expect(t.connectTcp()).rejects.toThrow("WINDOW_TUNNEL_REUSE");
  expect(start).not.toHaveBeenCalled();
  await t.close();
});

it("read-only inspection never calls exporter, custody or storage and always closes on guard rejection", async () => {
  const { inspectPrivateBackupTransport } = await import(
    "../../database/financialWindow/externalBackup"
  );
  const close = vi.fn(async () => {}),
    connectTcp = vi.fn();
  await expect(
    inspectPrivateBackupTransport({
      kind: "tcp",
      attest: async () => ({
        authenticated: true,
        restricted: true,
        railway: {},
      }),
      connectTcp,
      close,
    })
  ).rejects.toThrow("WINDOW_BACKUP_INSPECTION_STOPPED");
  expect(connectTcp).not.toHaveBeenCalled();
  expect(close).toHaveBeenCalled();
});
it("terminates a stubborn process after interrupt deadline", async () => {
  const child = spawn(
    process.execPath,
    [
      "-e",
      `process.on('SIGINT',()=>{});process.stdout.write(${JSON.stringify(output())});setInterval(()=>{},1000)`,
    ],
    { detached: true, stdio: ["ignore", "pipe", "pipe"] }
  );
  const p = captureTunnelProcess(child);
  await p.ready;
  await p.close();
  expect(child.signalCode).toBe("SIGKILL");
}, 5000);

it("verifies real local binding and rejects wildcard listener", async () => {
  const { createServer } = await import("node:net");
  const { assertLoopbackListener } = await import(
    "../../database/financialWindow/privateMysqlTunnel"
  );
  for (const host of ["127.0.0.1", "0.0.0.0"]) {
    const server = createServer();
    await new Promise<void>(resolve => server.listen(0, host, resolve));
    try {
      const port = (server.address() as any).port;
      if (host === "127.0.0.1")
        await expect(assertLoopbackListener(port)).resolves.toBeUndefined();
      else
        await expect(assertLoopbackListener(port)).rejects.toThrow(
          "WINDOW_TUNNEL_BINDING"
        );
    } finally {
      await new Promise<void>(resolve => server.close(() => resolve()));
    }
  }
});
