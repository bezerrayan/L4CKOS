import { EventEmitter } from "node:events";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import type { Connection } from "mysql2/promise";
import { BACKUP_TARGET } from "./backupIdentity";

const identitySql = "SELECT CONNECTION_ID() id,SHA2(@@server_uuid,256) uuidHash,CURRENT_USER() account,USER() login,VERSION() version,DATABASE() db";
const countSql = "SELECT COUNT(*) n FROM performance_schema.metadata_locks WHERE OBJECT_TYPE='BACKUP LOCK' AND LOCK_STATUS='GRANTED' AND OWNER_THREAD_ID=(SELECT THREAD_ID FROM performance_schema.threads WHERE PROCESSLIST_ID=CONNECTION_ID())";
type Ownership = { nonce: string; shellPid: number; clientPid: number; connectionId: number; clientStartTicks: string };
type ProcessIdentity = { pid: number; start: string };
type Reference = { database: string; uuidHash: string; mysqlVersion: string };
function processIdentity(pid: number): ProcessIdentity | undefined {
  try {
    const text = readFileSync(`/proc/${pid}/stat`, "utf8");
    return { pid, start: text.slice(text.lastIndexOf(")") + 2).split(" ")[19] };
  } catch { return undefined; }
}

/** Raw argv goes to Railway's own quoting. Only nonce-bound resources belong here. */
export class AdministrativeLockBridge extends EventEmitter {
  private child: ChildProcessWithoutNullStreams;
  private closed = false;
  private closing = false;
  private queue: Promise<unknown> = Promise.resolve();
  private waiter?: { command: string; resolve: (v: string) => void; reject: (e: Error) => void };
  private buffer = "";
  private ownership?: Ownership;
  private cleanupConfirmed = false;
  private exited: Promise<void>;
  private ready: Promise<void>;
  private owns = new Map<number, ProcessIdentity>();
  private audit: ReturnType<typeof setInterval>;
  private escalation?: ReturnType<typeof setTimeout>;
  private failureCode?: string;
  private exitCode: number | null = null;
  private commands: {command: string; state: string; at: string; granted?: number}[] = [];
  readonly nonce = randomUUID();
  private reference: Reference;
  constructor(cli: string, remoteScript: string, localRehearsal?: Reference) {
    super();
    if (localRehearsal && (!/^l4ckos_test_[a-z0-9_]+$/.test(localRehearsal.database) ||
      !/^\/tmp\/l4ckos-[a-z0-9-]+\/local-admin-bridge\.cjs$/.test(cli)))
      throw Error("WINDOW_LOCAL_FIXTURE_REQUIRED");
    this.reference = localRehearsal ?? BACKUP_TARGET;
    if (!remoteScript.includes("__L4CKOS_RUN_NONCE__")) throw Error("WINDOW_ADMIN_RUN_BINDING");
    const rendered = remoteScript.replaceAll("__L4CKOS_RUN_NONCE__", this.nonce);
    // Railway 5.64.1 quotes each argv itself; pre-quoting breaks bash -c.
    this.child = spawn(cli, ["ssh", "--project", BACKUP_TARGET.projectId,
      "--environment", BACKUP_TARGET.environmentId, "--service", BACKUP_TARGET.mysqlServiceId,
      "bash", "-c", rendered], { stdio: "pipe", detached: true });
    const owned = processIdentity(this.child.pid!);
    if (owned) this.owns.set(owned.pid, owned);
    this.audit = setInterval(() => this.observeChildren(), 50);
    this.ready = new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.failureCode ??= "WINDOW_ADMIN_READY_TIMEOUT";
        reject(Error(this.failureCode)); this.destroy();
      }, 15_000);
      this.once("ready", () => { clearTimeout(timeout); resolve(); });
      this.once("end", () => { clearTimeout(timeout); reject(Error(this.failureCode ?? "WINDOW_ADMIN_SESSION_LOST")); });
    });
    void this.ready.catch(() => {});
    this.child.stdout.on("data", b => {
      this.buffer += b.toString("utf8");
      if (this.buffer.length > 16_384) return this.fail("WINDOW_ADMIN_OUTPUT_LIMIT");
      let index: number;
      while ((index = this.buffer.indexOf("\n")) >= 0) {
        const line = this.buffer.slice(0, index).replace(/\r$/, "");
        this.buffer = this.buffer.slice(index + 1);
        if (line.startsWith("ROOTCHECK OWNERSHIP=")) {
          const m = /^ROOTCHECK OWNERSHIP=([a-f0-9-]{36}),([0-9]+),([0-9]+),([0-9]+),([0-9]+)$/.exec(line);
          if (!m || m[1] !== this.nonce || this.ownership) { this.fail("WINDOW_ADMIN_OWNERSHIP"); continue; }
          this.ownership = { nonce: m[1], shellPid: Number(m[2]), clientPid: Number(m[3]), connectionId: Number(m[4]), clientStartTicks: m[5] };
        } else if (line === "ROOTCHECK READY=PASS") {
          if (!this.ownership) this.fail("WINDOW_ADMIN_OWNERSHIP"); else this.emit("ready");
        } else if (line.startsWith("ROOTCHECK CLEANED=")) {
          const owner = this.ownership;
          this.cleanupConfirmed = !!owner && line === `ROOTCHECK CLEANED=${owner.nonce},${owner.shellPid},${owner.clientPid},${owner.connectionId},${owner.clientStartTicks}`;
          if (!this.cleanupConfirmed) this.failureCode ??= "WINDOW_ADMIN_CLEANUP_OWNER_MISMATCH";
        } else if (/^ROOTCHECK (FAILURE|CLEANUP)=/.test(line)) {
          const reason = line.split("=")[1];
          this.fail(reason === "INPUT_TIMEOUT_OR_EOF" ? "WINDOW_ADMIN_INPUT_TIMEOUT_OR_EOF" : "WINDOW_ADMIN_REMOTE_FAILURE");
        } else if (line.startsWith("REPLY ")) {
          const m = /^REPLY ([A-Z]+) ([a-zA-Z0-9_,.-]+)$/.exec(line);
          if (!m || m[1] !== this.waiter?.command) { this.fail("WINDOW_ADMIN_PROTOCOL"); continue; }
          this.waiter.resolve(m[2]); this.waiter = undefined;
        }
      }
    });
    // No raw stderr storage; retain only allowlisted diagnostic categories.
    this.child.stderr.on("data", b => {
      const s = b.toString("utf8");
      if (/Permission denied|Authentication failed/.test(s)) this.failureCode ??= "WINDOW_ADMIN_SSH_AUTHENTICATION";
      else if (/File name too long|command not found|No such file or directory/.test(s)) this.failureCode ??= "WINDOW_ADMIN_REMOTE_COMMAND";
    });
    this.child.stdin.on("error", () => this.fail("WINDOW_ADMIN_INPUT_CLOSED"));
    this.exited = new Promise(resolve => {
      this.child.once("error", () => this.fail("WINDOW_ADMIN_SPAWN_FAILED"));
      this.child.once("close", code => {
        this.exitCode = code;
        this.closed = true;
        clearInterval(this.audit); clearTimeout(this.escalation);
        this.waiter?.reject(Error(this.failureCode ?? "WINDOW_ADMIN_SESSION_LOST")); this.waiter = undefined;
        this.emit("end"); resolve();
      });
    });
  }
  private observeChildren() {
    // Expand only live, birth-time-verified descendants of this exact spawn.
    const live = new Set([...this.owns.values()].filter(x => processIdentity(x.pid)?.start === x.start).map(x => x.pid));
    for (const id of readdirSync("/proc").filter(x => /^\d+$/.test(x))) {
      try {
        const status = readFileSync(`/proc/${id}/status`, "utf8");
        const parent = Number(/^PPid:\s+(\d+)/m.exec(status)?.[1]);
        if (live.has(parent)) {
          const identity = processIdentity(Number(id));
          if (identity) { this.owns.set(identity.pid, identity); live.add(identity.pid); }
        }
      } catch {}
    }
  }
  private fail(code: string) { this.failureCode ??= code; this.destroy(); }
  asConnection(): Connection { return this as unknown as Connection; }
  query(input: string | { sql: string; timeout?: number }) {
    const sql = typeof input === "string" ? input : input.sql;
    const command = sql === identitySql ? "IDENTITY" : sql === countSql ? "COUNT" :
      sql === "SET SESSION lock_wait_timeout=5" ? "TIMEOUT" : sql === "LOCK INSTANCE FOR BACKUP" ? "ACQUIRE" :
      sql === "UNLOCK INSTANCE" ? "UNLOCK" : undefined;
    if (!command) return Promise.reject(Error("WINDOW_ADMIN_SQL_NOT_ALLOWLISTED"));
    const operation = async () => {
      await this.ready;
      if (this.closed || this.closing) throw Error(this.failureCode ?? "WINDOW_ADMIN_SESSION_LOST");
      const value = await new Promise<string>((resolve, reject) => {
        const timer = setTimeout(() => {
          this.failureCode ??= "WINDOW_ADMIN_QUERY_TIMEOUT";
          reject(Error(this.failureCode)); this.destroy();
        }, typeof input === "string" ? 3_000 : input.timeout ?? 3_000);
        this.waiter = { command, resolve: v => { clearTimeout(timer); resolve(v); }, reject: e => { clearTimeout(timer); reject(e); } };
        this.commands.push({command, state: "SENT", at: new Date().toISOString()});
        this.child.stdin.write(command + "\n");
      });
      this.commands.push({command, state: "REPLIED", at: new Date().toISOString(), ...(command === "COUNT" ? {granted:Number(value)} : {})});
      if (command === "IDENTITY") {
        const fields = value.split(",");
        if (fields.length !== 4 || Number(fields[0]) !== this.ownership?.connectionId || fields[1] !== this.reference.uuidHash ||
          fields[2] !== this.reference.mysqlVersion || fields[3] !== this.reference.database) {
          this.fail("WINDOW_ADMIN_PHYSICAL_IDENTITY"); throw Error("WINDOW_ADMIN_PHYSICAL_IDENTITY");
        }
        return [[{ id: fields[0], uuidHash: fields[1], version: fields[2], db: fields[3], account: "root@localhost", login: "root@localhost" }], []];
      }
      if ((command === "COUNT" && !/^[0-9]+$/.test(value)) || (command !== "COUNT" && value !== "OK")) {
        this.fail("WINDOW_ADMIN_PROTOCOL"); throw Error("WINDOW_ADMIN_PROTOCOL");
      }
      return [command === "COUNT" ? [{ n: value }] : [], []];
    };
    const result = this.queue.then(operation); this.queue = result.catch(() => {}); return result;
  }
  destroy() {
    if (this.closed || this.closing) return;
    this.closing = true;
    this.waiter?.reject(Error(this.failureCode ?? "WINDOW_ADMIN_SESSION_LOST")); this.waiter = undefined;
    this.child.stdin.end("QUIT\n");
    this.emit("end");
    this.escalation = setTimeout(() => {
      this.observeChildren();
      for (const owned of [...this.owns.values()].reverse()) {
        if (processIdentity(owned.pid)?.start === owned.start) { try { process.kill(owned.pid, "SIGTERM"); } catch {} }
      }
      this.escalation = setTimeout(() => {
        for (const owned of [...this.owns.values()].reverse()) {
          if (processIdentity(owned.pid)?.start === owned.start) { try { process.kill(owned.pid, "SIGKILL"); } catch {} }
        }
      }, 1_000);
    }, 3_000);
  }
  async end() { this.destroy(); await this.exited; if (!this.cleanupValid()) throw Error("WINDOW_ADMIN_CLEANUP_UNPROVEN"); if (this.exitCode !== 0) throw Error("WINDOW_ADMIN_UNEXPECTED_EXIT"); }
  private cleanupValid() {
    return this.closed && this.cleanupConfirmed && [...this.owns.values()].every(x => processIdentity(x.pid)?.start !== x.start);
  }
  async cleanup() { this.destroy(); await this.exited; return this.cleanupValid(); }
  diagnostic() {
    return { nonce: this.nonce, ownership: this.ownership ?? null, failureCode: this.failureCode ?? null,
      commands: this.commands, exitCode: this.exitCode, cleanupAcknowledged: this.cleanupConfirmed, cleanupVerified: this.cleanupValid(),
      processes: [...this.owns.values()].map(x => ({ ...x, exited: processIdentity(x.pid)?.start !== x.start })) };
  }
}
