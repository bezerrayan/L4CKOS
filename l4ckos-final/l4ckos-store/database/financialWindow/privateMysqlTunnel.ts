import {
  approvedTcpBackupPolicy,
  verifyTcpAuthenticatedIdentity,
} from "./tcpBackupPolicy";
import {
  TunnelFailure,
  isTunnelFailure,
  TUNNEL_CODES,
  sanitizeTunnelDiagnostic,
  createTunnelTemporaryAudit,
  tunnelFailure,
  reportedTunnelFailure,
  initialDiagnostic,
  type TunnelDiagnostic,
  type TunnelCode,
} from "./tunnelDiagnostics";
import { readFile } from "node:fs/promises";
import { readFileSync, readdirSync } from "node:fs";
import { sha256 } from "../schema/fingerprint";
export const RAILWAY_CLI_SHA256 =
  "47869b61196e463670bbe870f2c8c5053a09ddbe5dffc0833396c2355857d747";
import { StringDecoder } from "node:string_decoder";
import { spawn, type ChildProcess } from "node:child_process";
import { createConnection, type Connection } from "mysql2/promise";
import { BACKUP_TARGET, assertBackupRailway } from "./backupIdentity";
import type { PrivateBackupTransport } from "./externalBackup";

export type TunnelInventory = {
  projectId: string;
  environmentId: string;
  capturedAt: number;
  services: {
    id: string;
    name: string;
    deploymentId: string;
    active: boolean;
  }[];
};
export type TunnelEndpoint = {
  host: string;
  port: number;
  user: string;
  password: string;
  database: string;
};
export interface TunnelProcess {
  ready: Promise<TunnelEndpoint>;
  alive(): boolean;
  onStop(callback: () => void): void;
  close(): Promise<void>;
  diagnostic?(): TunnelDiagnostic;
  markListenerValidated?(): void;
}
export type TunnelStarter = (args: readonly string[]) => TunnelProcess;
const fail = (code: string): never => {
  throw new TunnelFailure(("WINDOW_TUNNEL_" + code) as TunnelCode);
};
export function resolveTunnelService(
  inventory: TunnelInventory,
  now = Date.now()
) {
  if (
    inventory.projectId !== BACKUP_TARGET.projectId ||
    inventory.environmentId !== BACKUP_TARGET.environmentId ||
    !Number.isFinite(inventory.capturedAt) ||
    now - inventory.capturedAt < 0 ||
    now - inventory.capturedAt > 30000
  )
    fail("IDENTITY");
  const services = inventory.services.filter(
    s => s.id === BACKUP_TARGET.mysqlServiceId
  );
  if (services.length !== 1) fail("AMBIGUOUS");
  const service = services[0];
  if (
    service.deploymentId !== BACKUP_TARGET.mysqlDeploymentId ||
    service.active !== true
  )
    fail("DEPLOYMENT");
  if (
    !/^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(service.name) ||
    inventory.services.filter(s => s.name === service.name).length !== 1
  )
    fail("SERVICE_NAME");
  return service;
}
export function tunnelArguments(inventory: TunnelInventory) {
  const service = resolveTunnelService(inventory);
  return [
    "connect",
    service.name,
    "--project",
    BACKUP_TARGET.projectId,
    "--environment",
    BACKUP_TARGET.environmentId,
    "--ssh",
    "--tunnel-only",
  ];
}
// Fields are derived from url::Url getters in Railway 5.64.1; those getters
// preserve percent encoding. Check the printed fields against the URL BEFORE decoding.
function endpointFailure(
  field:
    | "HOST"
    | "PORT"
    | "URL_SCHEME"
    | "URL_HOST"
    | "URL_PORT"
    | "DATABASE"
    | "USER"
    | "FORMAT"
): never {
  throw new TunnelFailure(("WINDOW_TUNNEL_ENDPOINT_" + field) as TunnelCode);
}
export function validateTunnelEndpoint(e: TunnelEndpoint, database: string) {
  validateDiscoveryEndpoint(e, database);
  if (e.user !== approvedTcpBackupPolicy().expectedLogin)
    endpointFailure("USER");
}
// Discovery-only policy; backup transport always applies the strict wrapper above.
export function validateDiscoveryEndpoint(e: TunnelEndpoint, database: string) {
  if (
    !e ||
    typeof e !== "object" ||
    Object.keys(e).sort().join(",") !== "database,host,password,port,user"
  )
    endpointFailure("FORMAT");
  if (e.host !== "127.0.0.1") endpointFailure("HOST");
  if (!Number.isInteger(e.port) || e.port < 1024 || e.port > 65535)
    endpointFailure("PORT");
  if (
    typeof e.user !== "string" ||
    !e.user.length ||
    e.user.length > 256 ||
    /[\r\n\0]/.test(e.user)
  )
    endpointFailure("USER");
  if (
    typeof e.password !== "string" ||
    !e.password.length ||
    e.password.length > 4096 ||
    /[\r\n\0]/.test(e.password)
  )
    endpointFailure("FORMAT");
  if (e.database !== database) endpointFailure("DATABASE");
}
export function parseTunnelOutput(output: string): TunnelEndpoint {
  if (Buffer.byteLength(output) > 16384 || /\x1b/.test(output))
    endpointFailure("FORMAT");
  const field = (name: string) => {
    const matches = [
      ...output.matchAll(
        new RegExp("^  " + name + ": +([^\\r\\n]+)\\r?$", "gm")
      ),
    ];
    if (matches.length !== 1) endpointFailure("FORMAT");
    return matches[0][1];
  };
  const port = field("Port");
  if (!/^\d{1,5}$/.test(port)) endpointFailure("PORT");
  const e = {
    host: field("Host"),
    port: Number(port),
    user: field("User"),
    password: field("Password"),
    database: field("Database"),
  };
  let url: URL;
  try {
    url = new URL(field("URL"));
  } catch {
    endpointFailure("FORMAT");
  }
  if (url!.protocol !== "mysql:") endpointFailure("URL_SCHEME");
  if (url!.hostname !== e.host) endpointFailure("URL_HOST");
  if (Number(url!.port) !== e.port) endpointFailure("URL_PORT");
  if (url!.username !== e.user) endpointFailure("USER");
  if (url!.password !== e.password || url!.search || url!.hash)
    endpointFailure("FORMAT");
  if (url!.pathname.replace(/^\/+/, "") !== e.database)
    endpointFailure("DATABASE");
  if (e.password.length > 4096) endpointFailure("FORMAT");
  // One decode only; literal + stays +. No normalization or fallback of identities.
  try {
    e.user = decodeURIComponent(e.user);
  } catch {
    endpointFailure("USER");
  }
  try {
    e.password = decodeURIComponent(e.password);
  } catch {
    endpointFailure("FORMAT");
  }
  try {
    e.database = decodeURIComponent(e.database);
  } catch {
    endpointFailure("DATABASE");
  }
  return e;
}
// Never called on import. Pipes only; raw output is never logged or persisted.
export function startRailwayTunnel(args: readonly string[]): TunnelProcess {
  return startWithPolicy(args, validateTunnelEndpoint);
}
export function startDiscoveryRailwayTunnel(
  args: readonly string[]
): TunnelProcess {
  return startWithPolicy(args, validateDiscoveryEndpoint);
}
function startWithPolicy(
  args: readonly string[],
  validate: typeof validateTunnelEndpoint
): TunnelProcess {
  if (
    args.length !== 8 ||
    args[0] !== "connect" ||
    !/^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(args[1]) ||
    args[2] !== "--project" ||
    args[3] !== BACKUP_TARGET.projectId ||
    args[4] !== "--environment" ||
    args[5] !== BACKUP_TARGET.environmentId ||
    args[6] !== "--ssh" ||
    args[7] !== "--tunnel-only"
  )
    fail("ARGUMENTS");
  if (
    sha256(readFileSync("/home/yan/.railway/bin/railway")) !==
    RAILWAY_CLI_SHA256
  )
    fail("CLI_VERSION");
  const audit = createTunnelTemporaryAudit();
  const child = spawn("/home/yan/.railway/bin/railway", [...args], {
    shell: false,
    detached: true,
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, NO_COLOR: "1", CLICOLOR: "0", TERM: "dumb" },
  });
  const processHandle = captureWithPolicy(child, 15000, audit, validate);
  const ready = processHandle.ready.then(async endpoint => {
    try {
      validate(endpoint, BACKUP_TARGET.database);
      await assertLoopbackListener(endpoint.port);
      processHandle.markListenerValidated?.();
      return endpoint;
    } catch (error) {
      endpoint.password = "";
      try {
        await processHandle.close();
      } catch {}
      throw tunnelFailure(
        error,
        "WINDOW_TUNNEL_BINDING",
        processHandle.diagnostic
      );
    }
  });
  return { ...processHandle, ready };
}
export function captureTunnelProcess(
  child: ChildProcess,
  timeoutMs = 15000,
  audit?: () => Promise<TunnelDiagnostic["temporaryArtifacts"]>
): TunnelProcess {
  return captureWithPolicy(child, timeoutMs, audit, validateTunnelEndpoint);
}
export function captureDiscoveryProcess(
  child: ChildProcess,
  timeoutMs = 15000
): TunnelProcess {
  return captureWithPolicy(
    child,
    timeoutMs,
    undefined,
    validateDiscoveryEndpoint
  );
}
function captureWithPolicy(
  child: ChildProcess,
  timeoutMs: number,
  audit: (() => Promise<TunnelDiagnostic["temporaryArtifacts"]>) | undefined,
  validate: typeof validateTunnelEndpoint
): TunnelProcess {
  const started = performance.now(),
    state = initialDiagnostic();
  let stopped = false,
    closing: Promise<void> | undefined,
    stdout = "",
    stderr = "",
    size = 0,
    finished: number | undefined,
    done = false;
  const decoderOut = new StringDecoder("utf8"),
    decoderErr = new StringDecoder("utf8");
  const snapshot = (): TunnelDiagnostic =>
    sanitizeTunnelDiagnostic({
      ...state,
      durationMs: Math.round((finished ?? performance.now()) - started),
      phase: TUNNEL_CODES[state.code][0],
      category: TUNNEL_CODES[state.code][1],
      temporaryArtifacts: {
        presence: state.temporaryArtifacts.presence,
        permissionsSafe: state.temporaryArtifacts.permissionsSafe,
      },
    });
  // SSH can create a separate process group. Observe descendants by PID + start time;
  // never claim complete cleanup solely from the Railway parent's exit.
  const descendants = new Map<number, string>();
  let processAuditFailed = false;
  const processInfo = (pid: number) => {
    try {
      const text = readFileSync("/proc/" + pid + "/stat", "utf8"),
        f = text
          .slice(text.lastIndexOf(")") + 2)
          .trim()
          .split(/\s+/);
      return { ppid: Number(f[1]), start: f[19] };
    } catch {
      return undefined;
    }
  };
  const observeDescendants = () => {
    if (!child.pid) return;
    let names: string[];
    try {
      names = readdirSync("/proc");
    } catch {
      processAuditFailed = true;
      return;
    }
    const all = names
      .filter(x => /^\d+$/.test(x))
      .map(x => ({ pid: Number(x), info: processInfo(Number(x)) }));
    const parents = new Set([child.pid, ...descendants.keys()]);
    let changed = true;
    while (changed) {
      changed = false;
      for (const p of all)
        if (p.info && parents.has(p.info.ppid) && !parents.has(p.pid)) {
          parents.add(p.pid);
          descendants.set(p.pid, p.info.start);
          changed = true;
        }
    }
  };
  const observer = setInterval(observeDescendants, 100);
  const listeners = new Set<() => void>();
  const stop = () => {
    if (!stopped) {
      stopped = true;
      for (const fn of listeners) fn();
    }
  };
  const signal = (sig: NodeJS.Signals) => {
    if (child.pid) {
      try {
        process.kill(-child.pid, sig);
      } catch {
        child.kill(sig);
      }
    }
  };
  let rejectReady: (e: TunnelFailure) => void,
    resolveReady: (e: TunnelEndpoint) => void;
  const ready = new Promise<TunnelEndpoint>((resolve, reject) => {
    resolveReady = resolve;
    rejectReady = reject;
  });
  const clearOutput = () => {
    stdout = "";
    stderr = "";
  };
  const rejectSafe = (code: TunnelCode) => {
    if (
      state.code === "WINDOW_TUNNEL_READY" ||
      state.code === "WINDOW_TUNNEL_PENDING"
    )
      state.code = code;
    state.readiness = "FAILED";
    stop();
    clearOutput();
    clearTimeout(timer);
    if (!done) {
      done = true;
      rejectReady!(new TunnelFailure(code, snapshot));
    }
    void close().catch(() => {});
  };
  const close = () =>
    (closing ??= (async () => {
      observeDescendants();
      state.shutdown = "PENDING";
      stop();
      clearOutput();
      clearTimeout(timer);
      if (!done) {
        done = true;
        rejectReady!(new TunnelFailure("WINDOW_TUNNEL_CLOSED", snapshot));
      }
      signal("SIGINT");
      const exited = await new Promise<boolean>(resolve => {
        if (
          (!child.pid && child.spawnfile !== undefined) ||
          child.exitCode !== null ||
          child.signalCode !== null
        )
          return resolve(true);
        const kill = setTimeout(() => signal("SIGKILL"), 1000);
        const deadline = setTimeout(() => {
          clearTimeout(kill);
          resolve(false);
        }, 2000);
        child.once("exit", () => {
          signal("SIGKILL");
          clearTimeout(kill);
          clearTimeout(deadline);
          resolve(true);
        });
      });
      clearInterval(observer);
      const descendantsExited = [...descendants].every(
        ([pid, start]) => processInfo(pid)?.start !== start
      );
      finished = performance.now();
      state.exitCode = child.exitCode;
      state.shutdown =
        exited && descendantsExited && !processAuditFailed
          ? "EXITED"
          : "FAILED";
      if (!exited || !descendantsExited || processAuditFailed)
        throw new TunnelFailure("WINDOW_TUNNEL_CLEANUP_FAILED", snapshot);
    })());
  const timer = setTimeout(
    () => rejectSafe("WINDOW_TUNNEL_READY_TIMEOUT"),
    timeoutMs
  );
  child.once("error", () => rejectSafe("WINDOW_TUNNEL_SPAWN_FAILED"));
  child.once("exit", code => {
    state.exitCode = code;
    if (state.shutdown !== "NOT_REQUESTED") return;
    rejectSafe(
      reportedTunnelFailure(stdout + "\n" + stderr) ??
        (done
          ? "WINDOW_TUNNEL_EXIT_AFTER_READY"
          : "WINDOW_TUNNEL_EXIT_BEFORE_READY")
    );
  });
  const consume = (channel: "stdout" | "stderr", b: Buffer) => {
    observeDescendants();
    size += b.length;
    if (size > 16384) return rejectSafe("WINDOW_TUNNEL_OUTPUT_LIMIT");
    if (done) return;
    if (channel === "stdout") stdout += decoderOut.write(b);
    else stderr += decoderErr.write(b);
    const combined = stdout + "\n" + stderr;
    const reported = reportedTunnelFailure(combined);
    if (reported) return rejectSafe(reported);
    if (!combined.includes("Press Ctrl+C to close the tunnel.")) return;
    done = true;
    clearTimeout(timer);
    let endpoint: TunnelEndpoint;
    try {
      endpoint = parseTunnelOutput(combined);
      validate(endpoint, BACKUP_TARGET.database);
      state.readiness = "ENDPOINT_VALIDATED";
      state.code = "WINDOW_TUNNEL_READY";
    } catch (error) {
      done = false;
      return rejectSafe(
        tunnelFailure(error, "WINDOW_TUNNEL_OUTPUT_FORMAT").code
      );
    }
    clearOutput();
    // No probing or reconnection: preserve the existing listener check in the starter.
    Promise.resolve()
      .then(async () => {
        if (audit) state.temporaryArtifacts = await audit();
        if (stopped) throw new TunnelFailure("WINDOW_TUNNEL_CLOSED", snapshot);
        resolveReady!(endpoint);
      })
      .catch(error => {
        if (isTunnelFailure(error))
          state.temporaryArtifacts = error.diagnostic().temporaryArtifacts;
        endpoint.password = "";
        done = false;
        rejectSafe(
          tunnelFailure(error, "WINDOW_TUNNEL_TEMP_AUDIT_FAILED").code
        );
      });
  };
  child.stdout?.on("data", (b: Buffer) => consume("stdout", b));
  child.stderr?.on("data", (b: Buffer) => consume("stderr", b));
  return {
    ready,
    alive: () => !stopped,
    onStop: fn => {
      listeners.add(fn);
      if (stopped) fn();
    },
    close,
    diagnostic: snapshot,
    markListenerValidated: () => {
      state.readiness = "LISTENER_VALIDATED";
    },
  };
}
export class PrivateMysqlTcpTunnel implements PrivateBackupTransport {
  readonly kind = "tcp" as const;
  private process?: TunnelProcess;
  private connection?: Connection;
  private closed = false;
  private name?: string;
  private closing?: Promise<void>;
  private failure?: TunnelFailure;
  private abort = () => {
    void this.close().catch(() => {});
  };
  constructor(
    private inventory: () => Promise<TunnelInventory>,
    private start: TunnelStarter,
    private database = BACKUP_TARGET.database,
    private abortSignal?: AbortSignal
  ) {
    if (
      database !== BACKUP_TARGET.database &&
      !/^l4ckos_test_[a-z0-9_]+$/.test(database)
    )
      fail("DATABASE");
    abortSignal?.addEventListener("abort", this.abort, { once: true });
    if (abortSignal?.aborted) this.closed = true;
  }
  async attest() {
    if (this.closed || (this.process && !this.process.alive())) fail("CLOSED");
    let service;
    try {
      service = resolveTunnelService(await this.inventory());
    } catch (error) {
      throw tunnelFailure(error, "WINDOW_TUNNEL_IDENTITY");
    }
    if (this.name && this.name !== service!.name) fail("IDENTITY");
    const railway = {
      RAILWAY_PROJECT_ID: BACKUP_TARGET.projectId,
      RAILWAY_ENVIRONMENT_ID: BACKUP_TARGET.environmentId,
      RAILWAY_SERVICE_ID: service!.id,
      RAILWAY_DEPLOYMENT_ID: service!.deploymentId,
    };
    assertBackupRailway(railway);
    return { authenticated: true, restricted: true, railway };
  }
  async connectTcp(): Promise<Connection> {
    if (this.process || this.closed) fail("REUSE");
    let credentials: TunnelEndpoint | undefined;
    let mysqlStarted = false;
    try {
      const inventory = await this.inventory();
      if (this.closed) fail("CLOSED");
      this.name = resolveTunnelService(inventory).name;
      this.process = this.start(tunnelArguments(inventory));
      credentials = await this.process.ready;
      validateTunnelEndpoint(credentials, this.database);
      await this.attest();
      // Stop/disconnect during handshake destroys the eventual connection as well.
      let interrupted = false;
      this.process.onStop(() => {
        interrupted = true;
        this.connection?.destroy();
      });
      mysqlStarted = true;
      this.connection = await createConnection({
        host: "127.0.0.1",
        port: credentials.port,
        user: credentials.user,
        password: credentials.password,
        database: this.database,
        dateStrings: true,
        jsonStrings: true,
        timezone: "Z",
        supportBigNumbers: true,
        bigNumberStrings: true,
        multipleStatements: false,
        connectTimeout: 10000,
        enableKeepAlive: true,
      });
      this.connection.config.password = "";
      if (this.closed || interrupted || !this.process.alive()) {
        this.connection.destroy();
        fail("CLOSED");
      }
      await this.attest();
      await verifyTcpAuthenticatedIdentity(this.connection);
      if (this.closed || interrupted || !this.process.alive()) fail("CLOSED");
      return this.connection;
    } catch (error) {
      const fallback = !mysqlStarted
        ? "WINDOW_TUNNEL_UNCLASSIFIED"
        : (error as { code?: string })?.code === "ER_ACCESS_DENIED_ERROR"
          ? "WINDOW_TUNNEL_MYSQL_AUTH_FAILED"
          : "WINDOW_TUNNEL_CONNECTION";
      const failure = (this.failure = tunnelFailure(
        error,
        fallback,
        this.process?.diagnostic
      ));
      try {
        await this.close();
      } catch {}
      throw failure;
    } finally {
      if (credentials) credentials.password = "";
    }
  }
  diagnostic(): TunnelDiagnostic {
    return (
      this.failure?.diagnostic() ??
      this.process?.diagnostic?.() ??
      initialDiagnostic()
    );
  }
  close(): Promise<void> {
    return (this.closing ??= (async () => {
      this.closed = true;
      this.abortSignal?.removeEventListener("abort", this.abort);
      if (this.connection) this.connection.config.password = "";
      this.connection?.destroy();
      await this.process?.close();
    })());
  }
}

// Linux proof of actual binding, not merely the host announced by the CLI.
export async function assertLoopbackListener(port: number) {
  const listeners: string[] = [];
  for (const file of ["/proc/net/tcp", "/proc/net/tcp6"]) {
    const text = await readFile(file, "utf8").catch(() =>
      fail("LISTENER_CHECK_FAILED")
    );
    for (const line of text.trim().split("\n").slice(1)) {
      const fields = line.trim().split(/\s+/),
        [address, p] = fields[1].split(":");
      if (parseInt(p, 16) === port && fields[3] === "0A")
        listeners.push(address);
    }
  }
  if (listeners.length === 0) fail("LISTENER_ABSENT");
  if (listeners.length !== 1 || listeners[0] !== "0100007F") fail("BINDING");
}
