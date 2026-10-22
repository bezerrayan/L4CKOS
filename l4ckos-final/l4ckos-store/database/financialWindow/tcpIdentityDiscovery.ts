// One-shot identity capability. Deliberately does not implement PrivateBackupTransport
// and never exposes a Connection, arbitrary SQL, custody, storage or export method.
import { createConnection, type Connection } from "mysql2/promise";
import { BACKUP_TARGET } from "./backupIdentity";
import { sha256 } from "../schema/fingerprint";
import { resolveTunnelService, tunnelArguments, validateDiscoveryEndpoint,
  assertLoopbackListener, startDiscoveryRailwayTunnel,
  type TunnelInventory, type TunnelStarter, type TunnelProcess } from "./privateMysqlTunnel";
import { tunnelFailure } from "./tunnelDiagnostics";

export const DISCOVERY_SQL = "SELECT USER() login, CURRENT_USER() account, @@version version, @@server_uuid uuid";
export class TcpIdentityDiscovery {
  readonly purpose = "IDENTITY_DISCOVERY_ONLY";
  #process?: TunnelProcess;
  #connection?: Connection;
  #used = false;
  #closed = false;
  constructor(private inventory: () => Promise<TunnelInventory>,
    private start: TunnelStarter = startDiscoveryRailwayTunnel) {}
  async discoverIdentity() {
    if (this.#used || this.#closed) throw Error("WINDOW_DISCOVERY_REUSE");
    this.#used = true;
    let endpoint;
    let mysqlStarted = false;
    try {
      const initial = await this.inventory();
      const service = resolveTunnelService(initial);
      this.#process = this.start(tunnelArguments(initial));
      endpoint = await this.#process.ready;
      validateDiscoveryEndpoint(endpoint, BACKUP_TARGET.database);
      await assertLoopbackListener(endpoint.port);
      if (resolveTunnelService(await this.inventory()).name !== service.name)
        throw Error("WINDOW_DISCOVERY_IDENTITY");
      let interrupted = false;
      this.#process.onStop(() => { interrupted = true; this.#connection?.destroy(); });
      if (this.#closed || interrupted) throw Error("WINDOW_DISCOVERY_CLOSED");
      mysqlStarted = true;
      this.#connection = await createConnection({host:"127.0.0.1", port:endpoint.port,
        user:endpoint.user, password:endpoint.password, database:BACKUP_TARGET.database,
        multipleStatements:false, connectTimeout:10000});
      this.#connection.config.password = "";
      if (this.#closed || interrupted || !this.#process.alive()) throw Error("WINDOW_DISCOVERY_CLOSED");
      const [rows] = await this.#connection.query(DISCOVERY_SQL);
      if (this.#closed || interrupted || !this.#process.alive()) throw Error("WINDOW_DISCOVERY_CLOSED");
      const result = rows as {login:string; account:string; version:string; uuid:string}[];
      if (result.length !== 1 || Object.values(result[0]).some(v => typeof v !== "string" || !v || v.length > 512))
        throw Error("WINDOW_DISCOVERY_FORMAT");
      const id = result[0];
      if (id.version !== BACKUP_TARGET.mysqlVersion || sha256(Buffer.from(id.uuid)) !== BACKUP_TARGET.uuidHash)
        throw Error("WINDOW_DISCOVERY_PHYSICAL_IDENTITY");
      // No identity is approved here. Caller may persist this ONLY as private evidence.
      return {declaredLogin:endpoint.user, authenticatedLogin:id.login,
        authenticatedAccount:id.account, historicalAccountCompatible:id.account === "root@localhost",
        serverIdentityMatches:true, approvedForBackup:false as const};
    } catch (error) {
      if (error instanceof Error && /^WINDOW_DISCOVERY_[A-Z_]+$/.test(error.message)) throw error;
      throw tunnelFailure(error, mysqlStarted
        ? (error as {code?:string})?.code === "ER_ACCESS_DENIED_ERROR"
          ? "WINDOW_TUNNEL_MYSQL_AUTH_FAILED" : "WINDOW_TUNNEL_CONNECTION"
        : "WINDOW_TUNNEL_UNCLASSIFIED", this.#process?.diagnostic);
    } finally {
      if (endpoint) endpoint.password = "";
      await this.close();
    }
  }
  diagnostic() { return this.#process?.diagnostic?.(); }
  async close() {
    this.#closed = true;
    if (this.#connection) { this.#connection.config.password = ""; this.#connection.destroy(); }
    await this.#process?.close();
  }
}
