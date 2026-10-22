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
import {
  parseTunnelOutput,
  validateTunnelEndpoint,
  captureTunnelProcess,
} from "../../database/financialWindow/privateMysqlTunnel";
import { TunnelFailure } from "../../database/financialWindow/tunnelDiagnostics";
import { BACKUP_TARGET } from "../../database/financialWindow/backupIdentity";
// Exact print_tunnel_info formatting; url::Url getters expose percent-encoded
// username/password/path. All values are synthetic; never from a real CLI run.
function fixture(
  password = "synthetic%40with%3Areserved%252F+plus",
  database = BACKUP_TARGET.database,
  user = "root",
  port = 3307
) {
  return `\nMySQL tunnel open — point an external client at:\n\n  Host:     127.0.0.1\n  Port:     ${port}\n  User:     ${user}\n  Password: ${password}\n  Database: ${database}\n\n  URL:      mysql://${user}:${password}@127.0.0.1:${port}/${database}\n\nPress Ctrl+C to close the tunnel.\n\n`;
}
it("matches Railway encoded getters to serialized URL and decodes credentials once", () => {
  const e = parseTunnelOutput(fixture());
  validateTunnelEndpoint(e, BACKUP_TARGET.database);
  expect(e.password).toBe("synthetic@with:reserved%2F+plus");
  expect(e.database).toBe(BACKUP_TARGET.database);
});
it("accepts percent-encoded spelling only when decoded database/user match fixed identities", () => {
  const e = parseTunnelOutput(
    fixture("synthetic", "%6C4ckos_staging", "%72oot")
  );
  validateTunnelEndpoint(e, BACKUP_TARGET.database);
  expect(e.user).toBe("root");
  expect(e.database).toBe(BACKUP_TARGET.database);
});
it("captures actual contract on stderr fragmented without logs or diagnostic values", async () => {
  const text = fixture();
  const c = spawn(
    process.execPath,
    [
      "-e",
      `const s=${JSON.stringify(text)};process.stderr.write(s.slice(0,110));setTimeout(()=>process.stderr.write(s.slice(110)),10);setInterval(()=>{},1000)`,
    ],
    { detached: true, stdio: ["ignore", "pipe", "pipe"] }
  );
  const p = captureTunnelProcess(c);
  try {
    const e = await p.ready;
    validateTunnelEndpoint(e, BACKUP_TARGET.database);
    expect(JSON.stringify(p.diagnostic!())).not.toContain("synthetic");
  } finally {
    await p.close();
  }
});
it.each([
  "HOST",
  "PORT",
  "URL_SCHEME",
  "URL_HOST",
  "URL_PORT",
  "DATABASE",
  "USER",
  "FORMAT",
] as const)("identifies %s with no received value in diagnostic", field => {
  let text = fixture();
  if (field === "HOST") text = text.replaceAll("127.0.0.1", "external.invalid");
  if (field === "PORT") text = fixture(undefined, undefined, undefined, 0);
  if (field === "URL_SCHEME") text = text.replace("mysql://", "https://");
  if (field === "URL_HOST")
    text = text.replace("@127.0.0.1", "@external.invalid");
  if (field === "URL_PORT") text = text.replace(":3307/", ":3308/");
  if (field === "DATABASE") text = fixture(undefined, "wrong_database");
  if (field === "USER") text = fixture(undefined, undefined, "wrong_user");
  if (field === "FORMAT") text = text.replace("  Password:", "  Unexpected:");
  let error: any;
  try {
    validateTunnelEndpoint(parseTunnelOutput(text), BACKUP_TARGET.database);
  } catch (e) {
    error = e;
  }
  expect(error).toBeInstanceOf(TunnelFailure);
  expect(error.message).toBe("WINDOW_TUNNEL_ENDPOINT_" + field);
  expect(error.diagnostic().field).toBe(field);
  const diagnostic = JSON.stringify(error);
  for (const forbidden of [
    "synthetic",
    "external.invalid",
    "wrong_database",
    "wrong_user",
    "mysql://",
    "Password:",
  ])
    expect(diagnostic).not.toContain(forbidden);
});
it.each(["%ZZ", "%00", "%0A", ""])(
  "rejects invalid/control/empty credential without exposing it",
  password => {
    expect(() =>
      validateTunnelEndpoint(
        parseTunnelOutput(fixture(password)),
        BACKUP_TARGET.database
      )
    ).toThrow("WINDOW_TUNNEL_ENDPOINT_FORMAT");
  }
);
it("rejects tampered password field even with otherwise consistent endpoint", () => {
  const text = fixture().replace(
    "  Password: synthetic",
    "  Password: changed"
  );
  expect(() => parseTunnelOutput(text)).toThrow(
    "WINDOW_TUNNEL_ENDPOINT_FORMAT"
  );
});
it("keeps ASCII and CRLF contract compatibility", () => {
  validateTunnelEndpoint(
    parseTunnelOutput(fixture("synthetic").replaceAll("\n", "\r\n")),
    BACKUP_TARGET.database
  );
});
