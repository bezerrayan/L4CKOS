import { expect, it, vi, afterEach } from "vitest";
// Synthetic fixed policy for contract fixtures; real approved-reference behavior is
// covered separately by tcpBackupPolicy.test.ts (no remote credentials).
vi.mock("../../database/financialWindow/tcpBackupPolicy", async () => {
  const { BACKUP_TARGET } = await import("../../database/financialWindow/backupIdentity");
  return {approvedTcpBackupPolicy:()=>Object.freeze({expectedLogin:"root",expectedCurrentUser:"root@localhost"}),
    tcpBackupReference:()=>({...BACKUP_TARGET,login:"root",account:"root@localhost"}),
    verifyTcpAuthenticatedIdentity:async()=>{}};
});
import { parseTunnelOutput, validateTunnelEndpoint } from "../../database/financialWindow/privateMysqlTunnel";
import { BACKUP_TARGET } from "../../database/financialWindow/backupIdentity";

// Synthetic Railway 5.64.1 stderr contract: printed getters stay encoded.
function fixture(urlUser: string, printedUser = urlUser) {
  return `\nMySQL tunnel open — point an external client at:\n\n  Host:     127.0.0.1\n  Port:     3307\n  User:     ${printedUser}\n  Password: synthetic\n  Database: ${BACKUP_TARGET.database}\n\n  URL:      mysql://${urlUser}:synthetic@127.0.0.1:3307/${BACKUP_TARGET.database}\n\nPress Ctrl+C to close the tunnel.\n\n`;
}
afterEach(() => vi.unstubAllEnvs());
it("ignores MYSQL_USER and MYSQLUSER when the URL supplies the approved user", () => {
  vi.stubEnv("MYSQL_USER", "synthetic_other_account");
  vi.stubEnv("MYSQLUSER", "synthetic_other_account");
  vi.stubEnv("MYSQL_URL", `mysql://root:synthetic@127.0.0.1:3307/${BACKUP_TARGET.database}`);
  validateTunnelEndpoint(parseTunnelOutput(fixture("root")), BACKUP_TARGET.database);
});
it("parses a coherent distinct URL user but preserves independent approved-account rejection", () => {
  vi.stubEnv("MYSQL_USER", "root");
  vi.stubEnv("MYSQL_URL", `mysql://synthetic_other_account:synthetic@127.0.0.1:3307/${BACKUP_TARGET.database}`);
  const endpoint = parseTunnelOutput(fixture("synthetic_other_account"));
  expect(endpoint.user).toBe("synthetic_other_account");
  expect(() => validateTunnelEndpoint(endpoint, BACKUP_TARGET.database)).toThrow("WINDOW_TUNNEL_ENDPOINT_USER");
});
it("rejects disagreement between printed User and URL even when printed identity is approved", () => {
  expect(() => parseTunnelOutput(fixture("synthetic_other_account", "root"))).toThrow("WINDOW_TUNNEL_ENDPOINT_USER");
});
it("accepts coherent percent encoding with exactly one decode", () => {
  const endpoint = parseTunnelOutput(fixture("%72oot"));
  expect(endpoint.user).toBe("root");
  validateTunnelEndpoint(endpoint, BACKUP_TARGET.database);
});
it("rejects different serialized spelling between URL and printed User", () => {
  expect(() => parseTunnelOutput(fixture("%72oot", "root"))).toThrow("WINDOW_TUNNEL_ENDPOINT_USER");
});
it("does not decode a doubly encoded user twice to satisfy identity", () => {
  const endpoint = parseTunnelOutput(fixture("%2572oot"));
  expect(endpoint.user).toBe("%72oot");
  expect(() => validateTunnelEndpoint(endpoint, BACKUP_TARGET.database)).toThrow("WINDOW_TUNNEL_ENDPOINT_USER");
});
it("rejects malformed user encoding without disclosing its value", () => {
  let error: any;
  try { parseTunnelOutput(fixture("%ZZ")); } catch (e) { error = e; }
  expect(error.message).toBe("WINDOW_TUNNEL_ENDPOINT_USER");
  expect(JSON.stringify(error.diagnostic())).not.toContain("%ZZ");
  expect(error.diagnostic().field).toBe("USER");
});
