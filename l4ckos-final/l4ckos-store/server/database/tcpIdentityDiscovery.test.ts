import { it, expect, vi, beforeEach } from "vitest";
// Synthetic fixed policy for contract fixtures; real approved-reference behavior is
// covered separately by tcpBackupPolicy.test.ts (no remote credentials).
vi.mock("../../database/financialWindow/tcpBackupPolicy", async () => {
  const { BACKUP_TARGET } = await import("../../database/financialWindow/backupIdentity");
  return {approvedTcpBackupPolicy:()=>Object.freeze({expectedLogin:"root",expectedCurrentUser:"root@localhost"}),
    tcpBackupReference:()=>({...BACKUP_TARGET,login:"root",account:"root@localhost"}),
    verifyTcpAuthenticatedIdentity:async()=>{}};
});
import { spawn } from "node:child_process";
const mocks = vi.hoisted(() => ({ connect:vi.fn(), listener:vi.fn() }));
vi.mock("mysql2/promise", () => ({createConnection:mocks.connect}));
vi.mock("../../database/financialWindow/privateMysqlTunnel", async original => ({
  ...await original<object>(), assertLoopbackListener:mocks.listener
}));
vi.mock("../../database/schema/fingerprint", async original => {
  const actual = await original<any>();
  return {...actual, sha256:(b:Buffer) => b.toString() === "synthetic-approved-uuid"
    ? "92e96ae744d2112c5b4a430abc9a75d557a43d293652dd68369aa81786479f09" : actual.sha256(b)};
});
import { TcpIdentityDiscovery, DISCOVERY_SQL } from "../../database/financialWindow/tcpIdentityDiscovery";
import { BACKUP_TARGET } from "../../database/financialWindow/backupIdentity";
import { parseTunnelOutput, validateTunnelEndpoint, captureDiscoveryProcess } from "../../database/financialWindow/privateMysqlTunnel";
import { exportThroughPrivateTransport } from "../../database/financialWindow/externalBackup";
const inventory = () => ({projectId:BACKUP_TARGET.projectId,environmentId:BACKUP_TARGET.environmentId,
  capturedAt:Date.now(),services:[{id:BACKUP_TARGET.mysqlServiceId,name:"SyntheticMysql",
  deploymentId:BACKUP_TARGET.mysqlDeploymentId,active:true}]});
const fixture = (user="synthetic_reader", printed=user) => `\nMySQL tunnel open — point an external client at:\n\n  Host:     127.0.0.1\n  Port:     3307\n  User:     ${printed}\n  Password: synthetic%40secret\n  Database: ${BACKUP_TARGET.database}\n\n  URL:      mysql://${user}:synthetic%40secret@127.0.0.1:3307/${BACKUP_TARGET.database}\n\nPress Ctrl+C to close the tunnel.\n\n`;
let connection:any, handle:any, starter:any;
beforeEach(() => {
  vi.clearAllMocks(); mocks.listener.mockResolvedValue(undefined);
  connection={config:{password:"synthetic"},destroy:vi.fn(),query:vi.fn().mockResolvedValue([[{
    login:"synthetic_reader@synthetic_source",account:"synthetic_reader@%",
    version:BACKUP_TARGET.mysqlVersion,uuid:"synthetic-approved-uuid"}]])};
  mocks.connect.mockResolvedValue(connection);
  handle={ready:Promise.resolve(parseTunnelOutput(fixture())),alive:()=>true,onStop:vi.fn(),close:vi.fn().mockResolvedValue(undefined)};
  starter=vi.fn(()=>handle);
});
it("discovers distinct non-root identities using only fixed identity SQL and never approves backup",async()=>{
  const d=new TcpIdentityDiscovery(async()=>inventory(),starter);
  const r=await d.discoverIdentity();
  expect(r.declaredLogin).toBe("synthetic_reader"); expect(r.authenticatedAccount).toBe("synthetic_reader@%");
  expect(r.historicalAccountCompatible).toBe(false);expect(r.approvedForBackup).toBe(false);
  expect(connection.query.mock.calls).toEqual([[DISCOVERY_SQL]]);
  expect(mocks.connect.mock.calls[0][0].multipleStatements).toBe(false);
  expect(handle.close).toHaveBeenCalled();expect(connection.destroy).toHaveBeenCalled();
  expect(connection.config.password).toBe("");expect((await handle.ready).password).toBe("");
  expect((d as any).connectTcp).toBeUndefined();expect((d as any).attest).toBeUndefined();
});
it("cannot be passed to the backup exporter and never accesses custody",async()=>{
  const d=new TcpIdentityDiscovery(async()=>inventory(),starter);
  const custody={recoverKey:vi.fn(),putCiphertext:vi.fn(),readCiphertext:vi.fn()};
  await expect(exportThroughPrivateTransport(d as any,custody,{path:"/tmp/l4ckos-synthetic/backup.enc",keyReference:"synthetic"})).rejects.toThrow("WINDOW_BACKUP_FAILED");
  expect(custody.recoverKey).not.toHaveBeenCalled();expect(starter).not.toHaveBeenCalled();
});
it("strict backup validator still rejects the same non-root endpoint",()=>{
  expect(()=>validateTunnelEndpoint(parseTunnelOutput(fixture()),BACKUP_TARGET.database)).toThrow("WINDOW_TUNNEL_ENDPOINT_USER");
});
it.each(["projectId","environmentId","serviceId","deploymentId"])("rejects divergent Railway %s before starting",async key=>{
  const inv=inventory();if(key==="serviceId")inv.services[0].id="divergent";else if(key==="deploymentId")inv.services[0].deploymentId="divergent";else (inv as any)[key]="divergent";
  await expect(new TcpIdentityDiscovery(async()=>inv,starter).discoverIdentity()).rejects.toThrow("WINDOW_TUNNEL_");
  expect(starter).not.toHaveBeenCalled();expect(mocks.connect).not.toHaveBeenCalled();
});
it("rejects ambiguous service name before starting",async()=>{
  const inv=inventory();inv.services.push({...inv.services[0],id:"other"});
  await expect(new TcpIdentityDiscovery(async()=>inv,starter).discoverIdentity()).rejects.toThrow("WINDOW_TUNNEL_SERVICE_NAME");expect(starter).not.toHaveBeenCalled();
});
it("refuses reuse without a second tunnel or query",async()=>{
  const d=new TcpIdentityDiscovery(async()=>inventory(),starter);await d.discoverIdentity();
  await expect(d.discoverIdentity()).rejects.toThrow("WINDOW_DISCOVERY_REUSE");expect(starter).toHaveBeenCalledTimes(1);
});
it.each(["version","uuid"])("rejects divergent physical %s and closes",async key=>{
  const row={login:"synthetic",account:"synthetic@%",version:BACKUP_TARGET.mysqlVersion,uuid:"synthetic-approved-uuid"};row[key as "version"|"uuid"]="divergent";
  connection.query.mockResolvedValue([[row]]);
  await expect(new TcpIdentityDiscovery(async()=>inventory(),starter).discoverIdentity()).rejects.toThrow("WINDOW_DISCOVERY_PHYSICAL_IDENTITY");expect(handle.close).toHaveBeenCalled();
});
it("fails closed on listener validation before authentication",async()=>{
  mocks.listener.mockRejectedValue(Error("synthetic private detail"));
  await expect(new TcpIdentityDiscovery(async()=>inventory(),starter).discoverIdentity()).rejects.toThrow("WINDOW_TUNNEL_UNCLASSIFIED");expect(mocks.connect).not.toHaveBeenCalled();expect(handle.close).toHaveBeenCalled();
});
it("sanitizes incorrect authentication and closes",async()=>{
  mocks.connect.mockRejectedValue(Object.assign(Error("synthetic secret mysql://private"),{code:"ER_ACCESS_DENIED_ERROR"}));
  await expect(new TcpIdentityDiscovery(async()=>inventory(),starter).discoverIdentity()).rejects.toThrow("WINDOW_TUNNEL_MYSQL_AUTH_FAILED");expect(handle.close).toHaveBeenCalled();
});
it("interruption before authentication prevents a query",async()=>{
  handle.onStop.mockImplementation((fn:()=>void)=>fn());
  await expect(new TcpIdentityDiscovery(async()=>inventory(),starter).discoverIdentity()).rejects.toThrow("WINDOW_DISCOVERY_CLOSED");expect(mocks.connect).not.toHaveBeenCalled();expect(handle.close).toHaveBeenCalled();
});
it("cleanup failure prevents a successful discovery result",async()=>{
  handle.close.mockRejectedValue(Error("WINDOW_TUNNEL_CLEANUP_FAILED"));
  await expect(new TcpIdentityDiscovery(async()=>inventory(),starter).discoverIdentity()).rejects.toThrow("WINDOW_TUNNEL_CLEANUP_FAILED");
});
it("compares encoded fields strictly and decodes exactly once",()=>{
  expect(parseTunnelOutput(fixture("synthetic%40reader%252F")).user).toBe("synthetic@reader%2F");
  expect(()=>parseTunnelOutput(fixture("synthetic%40reader","synthetic@reader"))).toThrow("WINDOW_TUNNEL_ENDPOINT_USER");
  expect(()=>parseTunnelOutput(fixture("%ZZ"))).toThrow("WINDOW_TUNNEL_ENDPOINT_USER");
});
it("captures discovery stderr privately with no credential in diagnostics and closes child",async()=>{
  const child=spawn(process.execPath,["-e",`process.stderr.write(${JSON.stringify(fixture())});setInterval(()=>{},1000)`],{detached:true,stdio:["ignore","pipe","pipe"]});
  const p=captureDiscoveryProcess(child);
  try{expect((await p.ready).user).toBe("synthetic_reader");expect(JSON.stringify(p.diagnostic?.())).not.toMatch(/synthetic|secret|mysql:\/\//);}finally{await p.close();}
  expect(p.alive()).toBe(false);expect(p.diagnostic?.().shutdown).toBe("EXITED");
});
