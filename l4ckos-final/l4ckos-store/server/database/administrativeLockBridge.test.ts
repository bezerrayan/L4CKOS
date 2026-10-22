import { EventEmitter } from "node:events";
import { PassThrough, Writable } from "node:stream";
import { afterEach, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({ failCount: false, child: undefined as any }));
vi.mock("node:child_process", () => ({ spawn: vi.fn((_cli: string, args: string[]) => {
  if (args.at(-1)?.startsWith("\'")) throw Error("PREQUOTED_ARGV");
  const nonce = /run_nonce='([a-f0-9-]{36})'/.exec(args.at(-1)!)![1];
  const child = new EventEmitter() as any;
  child.pid = 987654321;
  child.stdout = new PassThrough(); child.stderr = new PassThrough();
  child.stdin = new Writable({ write(chunk, _encoding, callback) {
    for (const command of chunk.toString().trim().split("\n")) {
      if (command === "QUIT") {
        child.stdout.write(`ROOTCHECK CLEANED=${nonce},1,2,77,1234\n`);
        queueMicrotask(() => child.emit("close", 0));
      } else if (command === "COUNT" && state.failCount) {
        queueMicrotask(() => child.emit("close", 1));
      } else child.stdout.write(`REPLY ${command} ${command === "IDENTITY" ? "77,92e96ae744d2112c5b4a430abc9a75d557a43d293652dd68369aa81786479f09,8.4.11,l4ckos_staging" : command === "COUNT" ? "1" : "OK"}\n`);
    }
    callback();
  }});
  queueMicrotask(() => child.stdout.write(`ROOTCHECK OWNERSHIP=${nonce},1,2,77,1234\nROOTCHECK READY=PASS\n`));
  state.child = child; return child;
}) }));
import { AdministrativeLockBridge } from "../../database/financialWindow/administrativeLockBridge";
const identity = "SELECT CONNECTION_ID() id,SHA2(@@server_uuid,256) uuidHash,CURRENT_USER() account,USER() login,VERSION() version,DATABASE() db";
const count = "SELECT COUNT(*) n FROM performance_schema.metadata_locks WHERE OBJECT_TYPE='BACKUP LOCK' AND LOCK_STATUS='GRANTED' AND OWNER_THREAD_ID=(SELECT THREAD_ID FROM performance_schema.threads WHERE PROCESSLIST_ID=CONNECTION_ID())";
afterEach(() => { state.failCount = false; vi.restoreAllMocks(); });
it("serializes fixed commands and confirms explicit unlock/remote cleanup", async () => {
  const bridge = new AdministrativeLockBridge("synthetic-cli", "run_nonce='__L4CKOS_RUN_NONCE__'; synthetic-script");
  const [rows] = await bridge.query(identity);
  expect((rows as any[])[0].id).toBe("77");
  await bridge.query("SET SESSION lock_wait_timeout=5");
  await bridge.query("LOCK INSTANCE FOR BACKUP");
  const [held] = await bridge.query(count);
  expect((held as any[])[0].n).toBe("1");
  await bridge.query("UNLOCK INSTANCE");
  await bridge.end();
});
it("rejects pending query after administrative session loss", async () => {
  const bridge = new AdministrativeLockBridge("synthetic-cli", "run_nonce='__L4CKOS_RUN_NONCE__'; synthetic-script");
  await bridge.query(identity); state.failCount = true;
  await expect(bridge.query(count)).rejects.toThrow("WINDOW_ADMIN_SESSION_LOST");
  await expect(bridge.query(identity)).rejects.toThrow("WINDOW_ADMIN_SESSION_LOST");
  expect(await bridge.cleanup()).toBe(false);
});
it("refuses arbitrary SQL rather than sending it to the administrative client", async () => {
  const bridge = new AdministrativeLockBridge("synthetic-cli", "run_nonce='__L4CKOS_RUN_NONCE__'; synthetic-script");
  await bridge.query(identity);
  await expect(bridge.query("SELECT * FROM users")).rejects.toThrow("WINDOW_ADMIN_SQL_NOT_ALLOWLISTED");
  await bridge.end();
});

it("retains sanitized phase and native category without message, SQL or credentials", async () => {
  const {inBackupPhase, backupFailureDetails, withBackupCleanup} = await import('../../database/financialWindow/backupCleanup');
  const primary = Object.assign(Error('sensitive synthetic message'), {code:'ER_TABLEACCESS_DENIED_ERROR',sql:'sensitive SQL'});
  try {
    await withBackupCleanup(() => inBackupPhase('PROTECTED_CAPTURE', async () => {throw primary}),
      [{name:'administrative',run:async()=>{throw Error('WINDOW_ADMIN_CLEANUP_UNPROVEN')}}]);
    expect.fail('must fail');
  } catch(error) {
    const details=backupFailureDetails(error);
    expect(details.primary).toEqual({code:'WINDOW_BACKUP_UNCLASSIFIED',category:'MYSQL_OR_TRANSPORT',causeCode:'ER_TABLEACCESS_DENIED_ERROR',phase:'PROTECTED_CAPTURE'});
    expect(details.cleanupErrors).toEqual([{step:'administrative',code:'WINDOW_ADMIN_CLEANUP_UNPROVEN'}]);
    expect(JSON.stringify(details)).not.toContain('sensitive');
  }
});
it("identifies the closed-reader consequence without persisting its raw exception", async () => {
  const {backupFailureDetails}=await import('../../database/financialWindow/backupCleanup');
  expect(backupFailureDetails(Error("Can't add new command when connection is in closed state")).primary?.code).toBe('WINDOW_BACKUP_CONNECTION_CLOSED');
});
