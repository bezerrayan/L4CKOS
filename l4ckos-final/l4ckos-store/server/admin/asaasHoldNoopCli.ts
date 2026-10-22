/** Dedicated administrative CLI. No HTTP endpoint, no actor/token in argv or request. */
import { readFileSync, readSync } from "node:fs";
import { createConnection } from "mysql2/promise";
import {
  reviewAsaasHoldsNoop,
  NOOP_SCOPE,
  noopRequestSchema,
} from "./asaasHoldNoop";
export function parseNoopArguments(args: string[]) {
  const values: Record<string, string> = {};
  let apply = false,
    session = false;
  for (let i = 0; i < args.length; i++) {
    const flag = args[i];
    if (flag === "--apply") {
      if (apply) throw Error("NOOP_ARGUMENTS");
      apply = true;
      continue;
    }
    if (flag === "--session-stdin") {
      if (session) throw Error("NOOP_ARGUMENTS");
      session = true;
      continue;
    }
    if (
      ![
        "--request",
        "--confirm-holds",
        "--confirm-events",
        "--expected-digest",
        "--local-socket",
        "--local-database",
      ].includes(flag) ||
      values[flag] ||
      !args[i + 1] ||
      args[i + 1].startsWith("--")
    )
      throw Error("NOOP_ARGUMENTS");
    values[flag] = args[++i];
  }
  if (!session || !values["--request"]) throw Error("NOOP_ARGUMENTS");
  if (
    apply &&
    (values["--confirm-holds"] !== "74,76" ||
      values["--confirm-events"] !== NOOP_SCOPE.map(x => x.eventId).join(",") ||
      !/^[a-f0-9]{64}$/.test(values["--expected-digest"] || ""))
  )
    throw Error("NOOP_EXPLICIT_IDS_AND_DIGEST_REQUIRED");
  if (!!values["--local-socket"] !== !!values["--local-database"])
    throw Error("NOOP_LOCAL_ARGUMENTS");
  return { apply, values };
}
function sessionFromStdin() {
  let result = "";
  const buffer = Buffer.alloc(1024);
  for (;;) {
    const n = readSync(0, buffer, 0, buffer.length, null);
    if (!n) break;
    result += buffer.toString("utf8", 0, n);
    if (result.length > 16384) throw Error("NOOP_SESSION_INVALID");
  }
  return result.trim();
}
export async function noopCli(args = process.argv.slice(2)) {
  const { apply, values: v } = parseNoopArguments(args);
  const request = noopRequestSchema.parse(
    JSON.parse(readFileSync(v["--request"], "utf8"))
  );
  const token = sessionFromStdin();
  let c;
  try {
    if (v["--local-socket"]) {
      if (
        !/^\/tmp\/l4ckos-[a-z0-9-]+\/mysqld\.sock$/.test(v["--local-socket"]) ||
        !/^l4ckos_test_noop_[a-z0-9]+$/.test(v["--local-database"])
      )
        throw Error("NOOP_LOCAL_DATABASE_REQUIRED");
      c = await createConnection({
        socketPath: v["--local-socket"],
        user: "root",
        database: v["--local-database"],
        dateStrings: true,
        multipleStatements: false,
      });
    } else {
      // Guard the destination BEFORE opening any network connection.
      if (
        process.env.NODE_ENV !== "production" ||
        process.env.RAILWAY_PROJECT_ID !==
          "2bb90c8e-eb65-43ee-826b-f93750f0499c" ||
        process.env.RAILWAY_ENVIRONMENT_ID !==
          "15545eee-bc02-4b70-afc4-19a5db9e6f46" ||
        process.env.RAILWAY_SERVICE_ID !==
          "9f1c7705-f2f9-48cf-b957-8f63a6bba4db" ||
        process.env.ASAAS_WEBHOOK_RECOVERY_MODE !== "review_only"
      )
        throw Error("NOOP_STAGING_REQUIRED");
      if (!process.env.DATABASE_URL) throw Error("NOOP_DATABASE_REQUIRED");
      c = await createConnection({
        uri: process.env.DATABASE_URL,
        dateStrings: true,
        multipleStatements: false,
      });
    }
    const result = await reviewAsaasHoldsNoop(c, request, token, {
      dryRun: !apply,
      expectedDigest: v["--expected-digest"],
      localSocket: v["--local-socket"],
    });
    console.log(JSON.stringify(result));
    return result;
  } finally {
    await c?.end();
  }
}
// Importing the CLI for argument tests never connects or reads credentials.
if (
  process.argv[1] &&
  /(?:asaasHoldNoopCli\.(?:ts|js)|asaas-hold-noop\.js)$/.test(process.argv[1])
) {
  noopCli().catch(error => {
    const code =
      error instanceof Error && /^NOOP_[A-Z0-9_]+$/.test(error.message)
        ? error.message
        : "NOOP_VALIDATION_OR_PERSISTENCE_FAILED";
    console.error(JSON.stringify({ error: code, automaticRetry: false }));
    process.exitCode = 1;
  });
}
