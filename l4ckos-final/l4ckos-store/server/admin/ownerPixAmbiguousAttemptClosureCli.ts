import { createPool, type RowDataPacket } from "mysql2/promise";
import { runtimeConnectionOptions } from "../database/runtimeConnection";
import {
  isProductionStockRuntimeIdentity,
  PRODUCTION_RAILWAY_IDENTITY,
} from "../_core/productionFinancialPolicy";
import { MYSQL_TLS_C7_HOST } from "../database/mysqlTls.mjs";
import {
  closeOwnerPixAmbiguousAttempt,
  OwnerPixClosureError,
  type OwnerPixClosureMode,
} from "./ownerPixAmbiguousAttemptClosure";

type Args = {
  mode: OwnerPixClosureMode;
  auditReference?: string;
  acknowledgeUncertainty: boolean;
  acknowledgeSingleUnit: boolean;
};

export function parseOwnerPixCloseArgs(args: string[]): Args {
  let mode: OwnerPixClosureMode | null = null;
  let auditReference: string | undefined;
  let acknowledgeUncertainty = false;
  let acknowledgeSingleUnit = false;
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === "--preflight" || arg === "--status" || arg === "--apply") {
      if (mode)
        throw new OwnerPixClosureError("OWNER_PIX_CLOSE_ARGUMENTS_INVALID");
      mode =
        arg === "--preflight"
          ? "preflight"
          : arg === "--status"
            ? "status"
            : "apply";
      continue;
    }
    if (arg === "--acknowledge-financial-uncertainty") {
      if (acknowledgeUncertainty)
        throw new OwnerPixClosureError("OWNER_PIX_CLOSE_ARGUMENTS_INVALID");
      acknowledgeUncertainty = true;
      continue;
    }
    if (arg === "--acknowledge-single-unit-release") {
      if (acknowledgeSingleUnit)
        throw new OwnerPixClosureError("OWNER_PIX_CLOSE_ARGUMENTS_INVALID");
      acknowledgeSingleUnit = true;
      continue;
    }
    if (
      arg === "--audit-reference" &&
      !auditReference &&
      args[i + 1] &&
      !args[i + 1].startsWith("--")
    ) {
      auditReference = args[++i];
      continue;
    }
    throw new OwnerPixClosureError("OWNER_PIX_CLOSE_ARGUMENTS_INVALID");
  }
  if (
    !mode ||
    ((mode === "apply" || mode === "status") && !auditReference) ||
    (mode === "apply" && (!acknowledgeUncertainty || !acknowledgeSingleUnit)) ||
    (mode !== "apply" && (acknowledgeUncertainty || acknowledgeSingleUnit))
  ) {
    throw new OwnerPixClosureError("OWNER_PIX_CLOSE_ARGUMENTS_INVALID");
  }
  if (
    (mode === "apply" || mode === "status") &&
    !/^[A-Za-z0-9][A-Za-z0-9._:/-]{2,190}$/.test(auditReference ?? "")
  ) {
    throw new OwnerPixClosureError("OWNER_PIX_CLOSE_AUDIT_REFERENCE_REQUIRED");
  }
  return {
    mode,
    auditReference,
    acknowledgeUncertainty,
    acknowledgeSingleUnit,
  };
}

export function assertOwnerPixClosureTarget(
  env: Record<string, string | undefined>
): void {
  const url = (() => {
    try {
      return new URL(env.DATABASE_URL ?? "");
    } catch {
      return null;
    }
  })();
  if (
    !isProductionStockRuntimeIdentity(env) ||
    env.RAILWAY_PROJECT_ID !== PRODUCTION_RAILWAY_IDENTITY.projectId ||
    env.RAILWAY_ENVIRONMENT_ID !== PRODUCTION_RAILWAY_IDENTITY.environmentId ||
    env.RAILWAY_SERVICE_ID !== PRODUCTION_RAILWAY_IDENTITY.serviceId ||
    env.NODE_ENV !== "production" ||
    env.APP_ENV !== "production" ||
    url?.protocol !== "mysql:" ||
    url.hostname !== MYSQL_TLS_C7_HOST ||
    url.pathname !== "/railway" ||
    env.STOCK_DATABASE_ENV !== "production" ||
    env.STOCK_EXPECTED_DATABASE !== "railway" ||
    env.PUBLIC_CHECKOUT_ENABLED !== "false" ||
    env.STOCK_CHECKOUT_ENABLED !== "false" ||
    env.OWNER_PIX_TEST_ENABLED !== "false" ||
    env.PUBLIC_SITE_MODE !== "coming-soon" ||
    !env.OWNER_OPEN_ID?.trim() ||
    !env.OWNER_PIX_TEST_ATTEMPT_ID?.trim()
  ) {
    throw new OwnerPixClosureError("OWNER_PIX_CLOSE_TARGET_OR_FLAGS_INVALID");
  }
}

export async function runOwnerPixCloseCli(
  args = process.argv.slice(2),
  env = process.env
) {
  const parsed = parseOwnerPixCloseArgs(args);
  assertOwnerPixClosureTarget(env);
  const pool = createPool({
    ...runtimeConnectionOptions(),
    connectionLimit: 1,
    waitForConnections: true,
    queueLimit: 0,
    multipleStatements: false,
  });
  try {
    const [identity] = await pool.query<
      Array<RowDataPacket & { databaseName: string; version: string }>
    >("SELECT DATABASE() AS databaseName, VERSION() AS version");
    if (
      identity[0]?.databaseName !== "railway" ||
      !["9.7.2", "9.7.4"].includes(String(identity[0]?.version))
    ) {
      throw new OwnerPixClosureError(
        "OWNER_PIX_CLOSE_DATABASE_IDENTITY_MISMATCH"
      );
    }
    const result = await closeOwnerPixAmbiguousAttempt(pool, {
      mode: parsed.mode,
      attemptId: env.OWNER_PIX_TEST_ATTEMPT_ID!,
      ownerOpenId: env.OWNER_OPEN_ID!,
      ...(parsed.auditReference
        ? { auditReference: parsed.auditReference }
        : {}),
      acknowledgeFinancialUncertainty: parsed.acknowledgeUncertainty,
      acknowledgeSingleUnitRelease: parsed.acknowledgeSingleUnit,
    });
    return result;
  } finally {
    await pool.end();
  }
}

export function isOwnerPixCloseEntrypoint(argv1: string | undefined): boolean {
  return Boolean(
    argv1 &&
      /(?:^|[\\/])(?:ownerPixAmbiguousAttemptClosureCli\.(?:ts|js)|owner-pix-ambiguous-close\.js)$/.test(
        argv1
      )
  );
}

if (isOwnerPixCloseEntrypoint(process.argv[1])) {
  runOwnerPixCloseCli()
    .then(result => {
      console.log(
        JSON.stringify({ operation: "owner_pix_ambiguous_close", ...result })
      );
    })
    .catch(error => {
      const code =
        error instanceof OwnerPixClosureError
          ? error.code
          : "OWNER_PIX_CLOSE_BLOCKED";
      console.error(
        JSON.stringify({
          operation: "owner_pix_ambiguous_close",
          result: "blocked",
          code,
          retryAutomatically: false,
        })
      );
      process.exitCode = 1;
    });
}
