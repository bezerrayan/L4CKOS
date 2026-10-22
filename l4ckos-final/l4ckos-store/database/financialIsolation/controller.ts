import type { Connection } from "mysql2/promise";
import { rows } from "../schema/fingerprint";
import { TABLES } from "../financialRecovery/evidence";
import {
  TARGET,
  assertEnvironment,
  assertApproval,
  requestSchema,
  type Environment,
} from "../financialRecovery/policy";

function fail(code: string): never {
  throw new Error(code);
}
const LOCK = "l4ckos-financial-isolation-v4";
export type AdmissionEvidence = {
  httpBlocked: boolean;
  workersBlocked: boolean;
  dispatchersDrained: boolean;
  externalJobsInventoried: boolean;
  observedAt: number;
};
export type IsolationApproval = {
  operation: "isolate" | "release";
  reference: string;
  expiresAt: number;
  projectId: string;
  environmentId: string;
  mysqlServiceId: string;
};
export type RecoveryInventory = {
  accounts: { user: string; host: string; locked: string }[];
  readOnly: number;
  scheduler: string;
  controllerId: number;
  rescueId: number;
  executorIds: number[];
};
export type Guards = {
  identity: () => Promise<void>;
  evidence: () => Promise<AdmissionEvidence>;
  persist: (event: string, state: RecoveryInventory) => Promise<void>;
};
function approval(
  a: IsolationApproval,
  operation: IsolationApproval["operation"]
) {
  if (
    a.operation !== operation ||
    !/^[-a-zA-Z0-9_]{8,80}$/.test(a.reference) ||
    a.expiresAt <= Date.now() ||
    a.expiresAt > Date.now() + 900000 ||
    a.projectId !== TARGET.projectId ||
    a.environmentId !== TARGET.environmentId ||
    a.mysqlServiceId !== "bcda5d78-4a0d-4682-8659-8316847addb7"
  )
    fail("ISOLATION_APPROVAL_REQUIRED");
}
/** No CLI, startup hook or environment-based identity override. Provisioning is separate.
 * identity must verify server UUID/schema/bundle via the pinned adapter; all sessions
 * must already exist before account locking. A rescue session survives account lock.
 */
export class FinancialIsolation {
  private state?: RecoveryInventory;
  private phase: "idle" | "quarantined" | "exclusive" | "revoked" | "incident" =
    "idle";
  private leased = false;
  private preflightLeased = false;
  private cursor = 0;
  constructor(
    private control: Connection,
    private rescue: Connection,
    private executors: Connection[],
    private g: Guards
  ) {}
  async inspect() {
    await this.g.identity();
    return {
      phase: this.phase,
      state: this.state ? structuredClone(this.state) : undefined,
    };
  }
  private async evidence() {
    const e = await this.g.evidence();
    if (
      !e.httpBlocked ||
      !e.workersBlocked ||
      !e.dispatchersDrained ||
      !e.externalJobsInventoried ||
      Date.now() - e.observedAt > 30000 ||
      e.observedAt > Date.now()
    )
      fail("ISOLATION_ADMISSION_NOT_PROVEN");
  }
  async activate(a: IsolationApproval) {
    approval(a, "isolate");
    if (this.phase !== "idle") fail("ISOLATION_ALREADY_ACTIVE");
    await this.g.identity();
    await this.evidence();
    const [lock] = await rows(this.control, "SELECT GET_LOCK(?,0) acquired", [
      LOCK,
    ]);
    if (Number(lock.acquired) !== 1) fail("ISOLATION_CONTROLLER_CONCURRENT");
    const id = async (c: Connection) =>
      Number((await rows(c, "SELECT CONNECTION_ID() id"))[0].id);
    try {
      const [mode] = await rows(
        this.control,
        "SELECT @@GLOBAL.read_only ro,@@GLOBAL.super_read_only sro,@@GLOBAL.event_scheduler scheduler,CURRENT_USER() account"
      );
      if (
        mode.account !== "root@localhost" ||
        Number(mode.ro) !== 0 ||
        Number(mode.sro) !== 0
      )
        fail("ISOLATION_CONTROL_REQUIRED");
      if (
        (await rows(this.rescue, "SELECT CURRENT_USER() account"))[0]
          .account !== "root@localhost"
      )
        fail("ISOLATION_RESCUE_REQUIRED");
      for (const c of this.executors) {
        const [u] = await rows(c, "SELECT CURRENT_USER() account");
        if (u.account !== "l4ckos_financial_window@localhost")
          fail("ISOLATION_EXECUTOR_IDENTITY");
        await assertExecutorGrants(this.control, c);
      }
      for (const sql of [
        "SELECT COUNT(*) n FROM information_schema.EVENTS",
        "SELECT COUNT(*) n FROM mysql.role_edges",
        "SELECT COUNT(*) n FROM performance_schema.replication_connection_configuration",
        "SELECT COUNT(*) n FROM performance_schema.replication_group_members",
      ])
        if (Number((await rows(this.control, sql))[0].n) !== 0)
          fail("ISOLATION_UNSUPPORTED_WRITER");
      if ((await rows(this.control, "SHOW REPLICA STATUS")).length)
        fail("ISOLATION_UNSUPPORTED_WRITER");
      const accounts = await rows(
        this.control,
        "SELECT User user,Host host,account_locked locked FROM mysql.user ORDER BY User,Host"
      );
      this.state = {
        accounts: accounts.map(x => ({
          user: String(x.user),
          host: String(x.host),
          locked: String(x.locked),
        })),
        readOnly: Number(mode.ro),
        scheduler: String(mode.scheduler),
        controllerId: await id(this.control),
        rescueId: await id(this.rescue),
        executorIds: await Promise.all(this.executors.map(id)),
      };
      await this.g.persist("before-isolation", structuredClone(this.state));
      this.phase = "quarantined";
      await this.control.query("SET GLOBAL read_only=ON");
      await this.control.query("SET GLOBAL event_scheduler=OFF");
      // Includes root@localhost: both retained control sessions survive; no new root admission.
      for (const x of this.state.accounts.filter(x => x.locked === "N"))
        await this.control.query("ALTER USER ?@? ACCOUNT LOCK", [
          x.user,
          x.host,
        ]);
      // INNODB_TRX is a cached observation; admission is already closed. Allow refresh
      // before inspecting and never infer drainage from an immediate cached zero.
      await new Promise(resolve => setTimeout(resolve, 250));
      const allowed = [
        this.state.controllerId,
        this.state.rescueId,
        ...this.state.executorIds,
      ];
      if (
        Number(
          (
            await rows(
              this.control,
              "SELECT COUNT(*) n FROM information_schema.innodb_trx"
            )
          )[0].n
        ) !== 0
      )
        fail("ISOLATION_TRANSACTIONS_NOT_DRAINED");
      for (const s of await rows(
        this.control,
        "SELECT ID id FROM information_schema.PROCESSLIST WHERE ID<>CONNECTION_ID() AND USER NOT IN ('system user','event_scheduler')"
      )) {
        const n = Number(s.id);
        if (!Number.isSafeInteger(n)) fail("ISOLATION_SESSION_INVALID");
        if (!allowed.includes(n))
          await this.control.query(`KILL CONNECTION ${n}`);
      }
      await this.assertExclusive(true);
      await this.g.persist("quarantine-proven", structuredClone(this.state));
      await this.control.query("SET GLOBAL read_only=OFF");
      this.phase = "exclusive";
      await this.assertExclusive();
      await this.g.persist("exclusive-ready", structuredClone(this.state));
    } catch (e) {
      if (this.state && this.phase !== "idle") {
        this.phase = "incident";
        await this.control.query("SET GLOBAL read_only=ON").catch(() => {});
      } else {
        this.state = undefined;
        await this.control.query("SELECT RELEASE_LOCK(?)", [LOCK]);
      }
      throw e;
    }
  }
  async assertExclusive(readOnly = false) {
    if (!this.state || !["exclusive", "quarantined"].includes(this.phase))
      fail("ISOLATION_NOT_READY");
    await this.g.identity();
    await this.evidence();
    const [m] = await rows(
      this.control,
      "SELECT @@GLOBAL.read_only ro,@@GLOBAL.super_read_only sro,@@GLOBAL.event_scheduler scheduler,IS_USED_LOCK(?) owner",
      [LOCK]
    );
    if (
      Number(m.owner) !== this.state.controllerId ||
      Number(m.ro) !== Number(readOnly) ||
      Number(m.sro) !== 0 ||
      m.scheduler !== "OFF"
    )
      fail("ISOLATION_BARRIER_LOST");
    if (
      Number(
        (
          await rows(
            this.control,
            "SELECT COUNT(*) n FROM mysql.user WHERE account_locked='N'"
          )
        )[0].n
      ) !== 0
    )
      fail("ISOLATION_ADMISSION_LOST");
    await this.rescue.query("SELECT 1");
    const ids = [
      this.state.controllerId,
      this.state.rescueId,
      ...this.state.executorIds,
    ];
    if (
      (
        await rows(
          this.control,
          "SELECT ID id FROM information_schema.PROCESSLIST WHERE USER NOT IN ('system user','event_scheduler')"
        )
      ).some(x => !ids.includes(Number(x.id)))
    )
      fail("ISOLATION_FOREIGN_SESSION");
    if (
      Number(
        (
          await rows(
            this.control,
            "SELECT COUNT(*) n FROM information_schema.innodb_trx"
          )
        )[0].n
      ) !== 0
    )
      fail("ISOLATION_TRANSACTIONS_NOT_DRAINED");
    for (const c of this.executors) await assertExecutorGrants(this.control, c);
  }
  /** A single orchestrator invocation, never an arbitrary public SQL callback/HTTP path. */
  async lease(input: unknown, artifactHash: string) {
    const request = requestSchema.parse(input);
    if (request.operation !== "financial-b" || request.mode !== "execute")
      fail("ISOLATION_SPECIFIC_FINANCIAL_APPROVAL");
    assertApproval(request, artifactHash);
    if (this.leased) fail("ISOLATION_LEASE_ALREADY_USED");
    await this.assertExclusive();
    this.leased = true;
    return this.sessionFactory();
  }
  async readLease(input: unknown) {
    const request = requestSchema.parse(input);
    if (
      request.operation !== "financial-b" ||
      request.mode !== "dry-run" ||
      this.preflightLeased ||
      this.leased
    )
      fail("ISOLATION_PREFLIGHT_SCOPE");
    await this.assertExclusive();
    this.preflightLeased = true;
    return this.sessionFactory();
  }
  private sessionFactory() {
    const sessions = this.executors;
    return async () => {
      await this.assertExclusive();
      if (this.phase !== "exclusive" || this.cursor >= sessions.length)
        fail("ISOLATION_CHANNEL_REVOKED");
      return sessions[this.cursor++];
    };
  }
  async revoke() {
    if (!this.state) fail("ISOLATION_NOT_ACTIVE");
    this.phase = "incident";
    await this.control.query("SET GLOBAL read_only=ON");
    for (const c of this.executors) await c.end().catch(() => {});
    if (
      (
        await rows(
          this.control,
          "SELECT ID id FROM information_schema.PROCESSLIST"
        )
      ).some(x => this.state!.executorIds.includes(Number(x.id)))
    )
      fail("ISOLATION_REVOKE_NOT_PROVEN");
    this.phase = "revoked";
    await this.g.persist("channel-revoked", structuredClone(this.state));
  }
  async release(a: IsolationApproval) {
    approval(a, "release");
    if (this.phase !== "revoked" || !this.state)
      fail("ISOLATION_REVOKE_REQUIRED");
    await this.g.identity();
    const [m] = await rows(
      this.control,
      "SELECT @@GLOBAL.read_only ro,@@GLOBAL.event_scheduler scheduler,IS_USED_LOCK(?) owner",
      [LOCK]
    );
    if (
      Number(m.ro) !== 1 ||
      m.scheduler !== "OFF" ||
      Number(m.owner) !== this.state.controllerId
    )
      fail("ISOLATION_RELEASE_STATE_DIVERGED");
    if (
      Number(
        (
          await rows(
            this.control,
            "SELECT COUNT(*) n FROM information_schema.innodb_trx"
          )
        )[0].n
      ) !== 0
    )
      fail("ISOLATION_TRANSACTIONS_NOT_DRAINED");
    if (
      (
        await rows(
          this.control,
          "SELECT ID id FROM information_schema.PROCESSLIST WHERE USER NOT IN ('system user','event_scheduler')"
        )
      ).some(
        x =>
          ![this.state!.controllerId, this.state!.rescueId].includes(
            Number(x.id)
          )
      )
    )
      fail("ISOLATION_FOREIGN_SESSION");
    const accounts = await rows(
      this.control,
      "SELECT User user,Host host,account_locked locked FROM mysql.user ORDER BY User,Host"
    );
    if (
      accounts.length !== this.state.accounts.length ||
      accounts.some(
        (x, i) =>
          x.user !== this.state!.accounts[i].user ||
          x.host !== this.state!.accounts[i].host ||
          x.locked !== "Y"
      )
    )
      fail("ISOLATION_RELEASE_STATE_DIVERGED");
    await this.g.persist("before-release", structuredClone(this.state));
    for (const x of this.state.accounts.filter(
      x => x.locked === "N" && x.user !== "l4ckos_financial_window"
    ))
      await this.control.query("ALTER USER ?@? ACCOUNT UNLOCK", [
        x.user,
        x.host,
      ]);
    if (this.state.scheduler === "ON")
      await this.control.query("SET GLOBAL event_scheduler=ON");
    await this.control.query("SET GLOBAL read_only=OFF");
    await this.control.query("SELECT RELEASE_LOCK(?)", [LOCK]);
    this.phase = "idle";
    await this.g.persist("released", structuredClone(this.state));
    this.state = undefined;
  }
}
export const WRITE_GRANTS = Object.freeze({
  orders: ["UPDATE"],
  products: ["UPDATE"],
  stockReservations: ["UPDATE"],
  payments: ["INSERT"],
  auditLogs: ["INSERT"],
  notificationOutbox: ["INSERT"],
});
export const METADATA_TABLES = Object.freeze([
  "_l4ckos_schema_executions",
  "_l4ckos_schema_migrations",
  "cartItems",
  "coupons",
  "emailUnsubscribes",
  "favorites",
  "localAuthUsers",
  "passwordResetTokens",
  "productImages",
  "productReviewUploads",
  "productReviews",
  "productionBatchProducts",
  "promoBanners",
  "userAddresses",
  "userPaymentMethods",
  "userProfiles",
  "waitlist_emails",
]);
export const EXECUTOR_GRANTS = Object.freeze(
  Object.fromEntries([
    ...TABLES.map(t => [
      t,
      [
        "SELECT",
        ...((WRITE_GRANTS as Record<string, string[]>)[t] ?? []),
        ...(["payments", "orderItems"].includes(t) ? ["UPDATE (`id`)"] : []),
      ],
    ]),
    ...METADATA_TABLES.map(t => [t, ["REFERENCES"]]),
  ]) as Record<string, string[]>
);
async function assertExecutorGrants(control: Connection, c: Connection) {
  const database = String(c.config.database);
  if (!/^l4ckos_(test_[a-z0-9_]+|staging)$/.test(database))
    fail("ISOLATION_DATABASE_SCOPE");
  const grants = (
    await rows(control, "SHOW GRANTS FOR ?@?", [
      "l4ckos_financial_window",
      "localhost",
    ])
  ).map(x => String(Object.values(x)[0]));
  const expected = [
    `GRANT USAGE ON *.* TO`,
    ...Object.entries(EXECUTOR_GRANTS).map(
      ([t, p]) =>
        "GRANT " + p.join(", ") + " ON `" + database + "`.`" + t + "` TO"
    ),
  ];
  if (
    grants.length !== expected.length ||
    grants.some(
      g =>
        !expected.some(prefix => g.startsWith(prefix + " ")) ||
        g.includes("WITH GRANT OPTION")
    )
  )
    fail("ISOLATION_EXECUTOR_GRANTS");
}
export function assertStagingControllerEnvironment(
  e: Environment,
  mysqlServiceId: string
) {
  assertEnvironment(e);
  if (mysqlServiceId !== "bcda5d78-4a0d-4682-8659-8316847addb7")
    fail("ISOLATION_MYSQL_SERVICE");
}
