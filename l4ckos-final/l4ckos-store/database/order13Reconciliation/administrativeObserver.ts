import { randomUUID } from "node:crypto";
import type { Connection } from "mysql2/promise";

export type ObservationTarget = {
  project: string;
  environment: string;
  mysqlService: string;
  database: string;
  uuidHash: string;
};
export type ObservationRequest = {
  nonce: string;
  operatorSession: number;
  operatorUser: string;
  target: ObservationTarget;
};
export type AdministrativeObserver = (request: ObservationRequest) => Promise<{
  nonce: string;
  operatorSession: number;
  target: ObservationTarget;
  observedAt: string;
  otherTransactions: number;
  operatorVisible: boolean;
}>;
function check(ok: unknown, reason: string): asserts ok {
  if (!ok) throw Error(reason);
}

/** No caller-provided receipt: every invocation opens a separate administrative session. */
export function mysqlAdministrativeObserver(
  open: () => Promise<Connection>,
  target: ObservationTarget
): AdministrativeObserver {
  return async request => {
    check(
      JSON.stringify(request.target) === JSON.stringify(target),
      "OBSERVER_TARGET_MISMATCH"
    );
    const c = await open();
    try {
      const [identity] = await c.query<any[]>(
        "SELECT DATABASE() db,SHA2(@@server_uuid,256) uuidHash,CURRENT_USER() account,CONNECTION_ID() session"
      );
      const i = identity[0];
      check(
        i.db === target.database && i.uuidHash === target.uuidHash,
        "OBSERVER_INSTANCE_MISMATCH"
      );
      check(
        !String(i.account).split("@")[0].includes("l4ckos_app") &&
          Number(i.session) !== request.operatorSession,
        "OBSERVER_SEPARATE_ACCOUNT_REQUIRED"
      );
      // Direct global PROCESS grant is required: a filtered view is not complete visibility.
      // Grants stay in memory and are never returned or logged. No grants are issued here.
      const [grants] = await c.query<any[]>("SHOW GRANTS FOR CURRENT_USER()");
      check(
        grants.some(row =>
          Object.values(row).some(value =>
            /^GRANT (?:ALL PRIVILEGES|.*\bPROCESS\b.*) ON \*\.\* TO /i.test(
              String(value)
            )
          )
        ),
        "OBSERVER_VISIBILITY_INCOMPLETE"
      );
      const [rows] = await c.execute<any[]>(
        "SELECT ? nonce,DATE_FORMAT(UTC_TIMESTAMP(3),'%Y-%m-%dT%H:%i:%s.%fZ') observedAt,COUNT(*) otherTransactions FROM information_schema.INNODB_TRX WHERE trx_mysql_thread_id<>?",
        [request.nonce, request.operatorSession]
      );
      // Confirm the excluded session is real, on this server, and belongs to the application.
      const [sessions] = await c.execute<any[]>(
        "SELECT ID FROM information_schema.PROCESSLIST WHERE ID=? AND USER=?",
        [request.operatorSession, request.operatorUser]
      );
      check(sessions.length === 1, "OBSERVER_OPERATOR_SESSION_MISSING");
      return {
        ...request,
        nonce: rows[0].nonce,
        observedAt: rows[0].observedAt,
        otherTransactions: Number(rows[0].otherTransactions),
        operatorVisible: true,
      };
    } finally {
      await c.end();
    }
  };
}

export async function observeAdministrativeGate(
  c: Connection,
  observer: AdministrativeObserver | undefined,
  target: ObservationTarget
) {
  check(observer, "ADMINISTRATIVE_OBSERVER_UNAVAILABLE");
  const [rows] = await c.query<any[]>(
    "SELECT CONNECTION_ID() session,SUBSTRING_INDEX(CURRENT_USER(),'@',1) operatorUser"
  );
  const operatorSession = Number(rows[0].session);
  check(
    Number.isSafeInteger(operatorSession) && operatorSession > 0,
    "OPERATOR_SESSION_INVALID"
  );
  const request = {
    nonce: randomUUID(),
    operatorSession,
    operatorUser: String(rows[0].operatorUser),
    target,
  };
  const started = Date.now();
  let result;
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    result = await Promise.race([
      observer(request),
      new Promise<never>((_, reject) => {
        timeout = setTimeout(() => reject(Error("OBSERVER_TIMEOUT")), 5000);
      }),
    ]);
  } catch (error) {
    throw Error(
      /^OBSERVER_[A-Z_]+$/.test((error as Error).message)
        ? (error as Error).message
        : "ADMINISTRATIVE_OBSERVER_UNAVAILABLE"
    );
  } finally {
    if (timeout) clearTimeout(timeout);
  }
  check(
    Date.now() - started <= 5000 &&
      Date.parse(result.observedAt) >= started &&
      Date.parse(result.observedAt) <= Date.now(),
    "OBSERVER_PROOF_STALE"
  );
  check(
    result.nonce === request.nonce &&
      result.operatorSession === operatorSession &&
      JSON.stringify(result.target) === JSON.stringify(target),
    "OBSERVER_BINDING_MISMATCH"
  );
  check(
    result.operatorVisible === true &&
      Number.isSafeInteger(result.otherTransactions) &&
      result.otherTransactions >= 0,
    "OBSERVER_VISIBILITY_INCOMPLETE"
  );
  check(result.otherTransactions === 0, "OTHER_DATABASE_TRANSACTION_ACTIVE");
}
