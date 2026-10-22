import type { Connection } from "mysql2/promise";
import { readArtifact } from '../schema/artifacts';
import { readStructuralSchema, structuralHash } from '../schema/fingerprint';
import { POST23 } from './policy';
import { rows, canonical } from "../schema/fingerprint";
import { fail } from "./policy";
import type { WindowPlan } from "./policy";
import { verifyCapability, type Capability } from "./capability";
import {
  loadLineage,
  readOperationalManifest,
  validateHistory,
} from "../migrations/runner";

export type BarrierState = {
  owner: number;
  readOnly: number;
  accounts: { user: string; host: string }[];
  ready: boolean;
  readAccounts?: { user: string; host: string }[];
};
const active = new WeakMap<Connection, BarrierState>();
async function policy(c: Connection) {
  const meta = (
    await rows(
      c,
      "SELECT CONNECTION_ID() id, CURRENT_USER() account, @@GLOBAL.read_only ro, @@GLOBAL.super_read_only sro, @@GLOBAL.event_scheduler scheduler"
    )
  )[0];
  if (meta.scheduler !== "OFF" || Number(meta.sro) !== 0)
    fail("BARRIER_SERVER_MODE_INVALID");
  if (
    Number((await rows(c, "SELECT COUNT(*) n FROM mysql.role_edges"))[0].n) !==
      0 ||
    (await rows(c, "SHOW REPLICA STATUS")).length ||
    Number(
      (
        await rows(
          c,
          "SELECT COUNT(*) n FROM performance_schema.replication_group_members"
        )
      )[0].n
    ) !== 0 ||
    Number(
      (
        await rows(
          c,
          "SELECT COUNT(*) n FROM performance_schema.replication_applier_status WHERE SERVICE_STATE='ON'"
        )
      )[0].n
    ) !== 0
  )
    fail("BARRIER_ROLES_OR_REPLICATION_UNSUPPORTED");
  const accounts = await rows(
    c,
    "SELECT User user, Host host, account_locked locked, Super_priv superPrivilege FROM mysql.user ORDER BY User, Host"
  );
  // Existing container-local recovery account is the sole admission exception.
  // It cannot be used from the API/private network. No account or password is created.
  const recovery = accounts.find(
    a =>
      a.user === "root" &&
      a.host === "localhost" &&
      a.locked === "N" &&
      a.superPrivilege === "Y"
  );
  if (!recovery) fail("LOCAL_RECOVERY_ACCOUNT_REQUIRED");
  if (
    Number(
      (await rows(c, "SELECT COUNT(*) n FROM information_schema.innodb_trx"))[0]
        .n
    ) !== 0
  )
    fail("BARRIER_TRANSACTIONS_NOT_DRAINED");
  return { meta, accounts };
}
export async function assertBarrier(c: Connection) {
  const state = active.get(c);
  if (!state?.ready) fail("BARRIER_CAPABILITY_REQUIRED");
  const { meta, accounts } = await policy(c);
  if (
    Number(meta.id) !== state.owner ||
    Number(meta.ro) !== 1 ||
    accounts.some(
      a =>
        !(a.user === "root" && a.host === "localhost") &&
        !state.readAccounts?.some(
          v => v.user === a.user && v.host === a.host
        ) &&
        a.locked !== "Y"
    )
  )
    fail("BARRIER_LOST");
  for (const a of state.readAccounts ?? []) await readonlyGrants(c, a);
  const sessions = await rows(
    c,
    "SELECT ID id, USER user FROM information_schema.PROCESSLIST WHERE ID<>CONNECTION_ID() AND USER NOT IN ('system user','event_scheduler')"
  );
  if (sessions.some(s => !state.readAccounts?.some(a => a.user === s.user)))
    fail("BARRIER_FOREIGN_SESSION");
}
async function readonlyGrants(
  c: Connection,
  a: { user: string; host: string }
) {
  const grants = await rows(c, "SHOW GRANTS FOR ?@?", [a.user, a.host]);
  const database = String(c.config.database).replace(
    /[.*+?^${}()|[\]\\]/g,
    "\\$&"
  );
  const scoped = new RegExp(
    "^GRANT (?:ALL PRIVILEGES|(?:SELECT|INSERT|UPDATE|DELETE)(?:, (?:SELECT|INSERT|UPDATE|DELETE))*) ON `" +
      database +
      "`\\.\\* TO "
  );
  if (
    !grants.length ||
    grants.some(g => {
      const text = String(Object.values(g)[0]);
      return (
        /WITH GRANT OPTION/.test(text) ||
        !(/^GRANT USAGE ON \*\.\* TO /.test(text) || scoped.test(text))
      );
    })
  )
    fail("APPLICATION_READ_ONLY_BYPASS_PRIVILEGES");
}
/** Allows API reads under read_only; UPDATE/INSERT remain rejected at MySQL.
 * Account/credential provisioning is deliberately outside this operator.
 */
export async function allowApplicationReads(
  c: Connection,
  expected: BarrierState,
  a: { user: string; host: string },
  approved: boolean,
  requireV4 = false
) {
  const state = active.get(c);
  if (
    !approved ||
    !state ||
    canonical(state) !== canonical(expected) ||
    !state.accounts.some(v => v.user === a.user && v.host === a.host)
  )
    fail("READ_ADMISSION_APPROVAL_REQUIRED");
  await assertBarrier(c);
  await readonlyGrants(c, a);
  const history = await validateHistory(
    c,
    await loadLineage(JSON.parse((await readArtifact('database/migrations/manifest-v4.json','database/migrations')).toString()))
  );
  if (!['0022_preorder_manufacturing_schedule','0023_asaas_webhook_inbox'].includes(history.at(-1)?.name ?? '') ||
      (requireV4 && (history.at(-1)?.name !== '0023_asaas_webhook_inbox' || structuralHash(await readStructuralSchema(c)) !== POST23)))
    fail("0022_REQUIRED_BEFORE_READ_ADMISSION");
  await c.query("ALTER USER ?@? ACCOUNT UNLOCK", [a.user, a.host]);
  state.readAccounts = [...(state.readAccounts ?? []), a];
  await assertBarrier(c);
  return structuredClone(state);
}
/** Caller must verify fixed staging identity and explicit account-quarantine approval first. */
export async function activateBarrier(
  c: Connection,
  plan: WindowPlan,
  capability: Capability,
  preserve: (state: BarrierState) => Promise<void>
) {
  await verifyCapability(c, plan, capability);
  if (active.has(c)) fail("BARRIER_ALREADY_ACTIVE");
  const { meta, accounts } = await policy(c);
  if (Number(meta.ro) !== 0) fail("BARRIER_PREEXISTING_READ_ONLY");
  const state: BarrierState = {
    owner: Number(meta.id),
    readOnly: Number(meta.ro),
    accounts: accounts
      .filter(
        a => a.locked === "N" && !(a.user === "root" && a.host === "localhost")
      )
      .map(a => ({ user: String(a.user), host: String(a.host) })),
    ready: false,
  };
  // Persist the recovery inventory BEFORE changing a global variable/account.
  await preserve(structuredClone(state));
  active.set(c, state);
  await c.query("SET GLOBAL read_only=ON");
  for (const a of state.accounts)
    await c.query("ALTER USER ?@? ACCOUNT LOCK", [a.user, a.host]);
  // ACCOUNT LOCK affects new admission, not established sessions. Disconnect all
  // foreign clients after transactions were drained; these sessions may bypass read_only.
  for (const s of await rows(
    c,
    "SELECT ID id FROM information_schema.PROCESSLIST WHERE ID<>CONNECTION_ID() AND USER NOT IN ('system user','event_scheduler')"
  )) {
    if (!Number.isSafeInteger(Number(s.id))) fail("SESSION_ID_INVALID");
    await c.query(`KILL CONNECTION ${Number(s.id)}`);
  }
  state.ready = true;
  await assertBarrier(c);
  return structuredClone(state);
}
/** Never called by a migration finally block. Reopening writes is a separate approval. */
export async function releaseBarrier(
  c: Connection,
  expected: BarrierState,
  approved: boolean,
  requireV4 = false
) {
  const state = active.get(c);
  if (!approved || !state || canonical(state) !== canonical(expected))
    fail("BARRIER_RELEASE_APPROVAL_REQUIRED");
  await assertBarrier(c);
  if (requireV4) {
    const lineage=await loadLineage(JSON.parse((await readArtifact('database/migrations/manifest-v4.json','database/migrations')).toString()));
    const history=await validateHistory(c,lineage);
    if(history.at(-1)?.name!=='0023_asaas_webhook_inbox'||structuralHash(await readStructuralSchema(c))!==POST23)fail('V4_REQUIRED_BEFORE_RELEASE');
  }
  // Keep read_only while restoring admission; sessions that can bypass it remain
  // forbidden by the operational HTTP/service barrier until this whole step completes.
  for (const a of state.accounts)
    await c.query("ALTER USER ?@? ACCOUNT UNLOCK", [a.user, a.host]);
  await c.query("SET GLOBAL read_only=OFF");
  active.delete(c);
}

/** Rebinds a preserved quarantine inventory to an independently verified recovery
 * session. It never unlocks accounts or changes read_only; approval is separate.
 */
export async function adoptBarrier(c: Connection, plan: WindowPlan, capability: Capability,
  saved: BarrierState, approved: boolean) {
  await verifyCapability(c, plan, capability);
  if (!approved || active.has(c) || saved.readOnly !== 0 ||
    !saved.accounts.length || saved.accounts.some(a => !a.user || !a.host || (a.user === 'root' && a.host === 'localhost')))
    fail('BARRIER_RECOVERY_APPROVAL_REQUIRED');
  for(const a of saved.readAccounts??[]) {
    if(!saved.accounts.some(v=>v.user===a.user&&v.host===a.host))fail('BARRIER_RECOVERY_STATE_MISMATCH');
    await readonlyGrants(c,a);
  }
  const { meta, accounts } = await policy(c);
  if (Number(meta.ro) !== 1 || saved.accounts.some(a => !accounts.some(v => v.user === a.user && v.host === a.host &&
    v.locked === ((saved.readAccounts??[]).some(r=>r.user===a.user&&r.host===a.host)?'N':'Y'))))
    fail('BARRIER_RECOVERY_STATE_MISMATCH');
  const state: BarrierState = { ...structuredClone(saved), owner: Number(meta.id), ready: true };
  active.set(c, state);
  try { await assertBarrier(c); } catch (error) { active.delete(c); throw error; }
  return structuredClone(state);
}
