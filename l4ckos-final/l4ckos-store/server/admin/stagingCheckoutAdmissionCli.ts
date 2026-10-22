/** No endpoint or automatic startup. Signed session arrives exclusively on stdin. */
import { readFileSync, readSync } from "node:fs";
import { createConnection } from "mysql2/promise";
import { drizzle } from "drizzle-orm/mysql2";
import {
  administerCheckoutAdmission,
  admissionRequest,
} from "./stagingCheckoutAdmission";
import {
  assertSelectiveStage,
  requireAdmission,
} from "../payments/stagingCheckoutAdmission";
export function parseAdmissionArguments(args: string[]) {
  const v: Record<string, string> = {};
  let apply = false,
    session = false;
  for (let i = 0; i < args.length; i++) {
    const flag = args[i];
    if (flag === "--apply") {
      requireAdmission(!apply);
      apply = true;
      continue;
    }
    if (flag === "--session-stdin") {
      requireAdmission(!session);
      session = true;
      continue;
    }
    requireAdmission(
      [
        "--request",
        "--expected-digest",
        "--confirm-order",
        "--confirm-payment",
        "--confirm-events",
      ].includes(flag) &&
        !v[flag] &&
        args[i + 1] &&
        !args[i + 1].startsWith("--")
    );
    v[flag] = args[++i];
  }
  requireAdmission(session && v["--request"]);
  if (apply)
    requireAdmission(
      /^[a-f0-9]{64}$/.test(v["--expected-digest"] || "") &&
        v["--confirm-order"] &&
        v["--confirm-payment"]
    );
  return { apply, v };
}
async function main() {
  const { apply, v } = parseAdmissionArguments(process.argv.slice(2));
  assertSelectiveStage();
  const request = admissionRequest.parse(
    JSON.parse(readFileSync(v["--request"], "utf8"))
  );
  if (apply) {
    requireAdmission(
      v["--confirm-order"] === String(request.orderId) &&
        v["--confirm-payment"] === request.paymentId
    );
    requireAdmission(
      v["--confirm-events"] ===
        (request.action === "release" ? request.eventIds : request.events).join(
          ","
        )
    );
  }
  const b = Buffer.alloc(16385);
  let n = 0;
  for (;;) {
    const x = readSync(0, b, n, b.length - n, null);
    if (!x) break;
    n += x;
    requireAdmission(n < 16385);
  }
  let token = b.toString("utf8", 0, n).trim();
  b.fill(0);
  requireAdmission(token.length > 0);
  requireAdmission(process.env.DATABASE_URL);
  const c = await createConnection({
    uri: process.env.DATABASE_URL,
    multipleStatements: false,
  });
  try {
    const [identity] = await c.query<any[]>(
      "SELECT DATABASE() db,SHA2(@@server_uuid,256) h"
    );
    requireAdmission(
      identity[0].db === "l4ckos_staging" &&
        identity[0].h ===
          "92e96ae744d2112c5b4a430abc9a75d557a43d293652dd68369aa81786479f09"
    );
    const result = await administerCheckoutAdmission(
      drizzle(c),
      request,
      token,
      { dryRun: !apply, expectedDigest: v["--expected-digest"] }
    );
    console.log(JSON.stringify(result));
  } finally {
    token = "";
    await c.end();
  }
}
if (
  /(?:stagingCheckoutAdmissionCli\.(?:ts|js)|staging-checkout-admission\.js)$/.test(
    process.argv[1] || ""
  )
)
  main().catch(() => {
    console.error(
      JSON.stringify({
        error: "SELECTIVE_ADMISSION_BLOCKED",
        automaticRetry: false,
      })
    );
    process.exitCode = 1;
  });
