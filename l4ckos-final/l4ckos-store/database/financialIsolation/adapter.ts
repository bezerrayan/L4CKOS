import {
  runRecovery,
  RecoveryIncident,
  type Runtime,
} from "../financialRecovery/operator";
import { assertApproval, requestSchema } from "../financialRecovery/policy";
import type { FinancialIsolation } from "./controller";
/** Private integration seam, not wired into startup/HTTP or a remote launcher. */
export async function runIsolatedRecovery(
  input: unknown,
  runtime: Runtime,
  isolation: FinancialIsolation
) {
  const request = requestSchema.parse(input);
  if (request.operation !== "financial-b")
    throw Error("ISOLATION_FINANCIAL_B_ONLY");
  assertApproval(request, runtime.artifactHash);
  if (request.mode !== "execute")
    throw Error("ISOLATION_WRITE_LEASE_REQUIRES_APPROVAL");
  const open = await isolation.lease(request, runtime.artifactHash);
  let result: Awaited<ReturnType<typeof runRecovery>>;
  try {
    result = await runRecovery(request, { ...runtime, open });
  } catch (error) {
    try {
      await isolation.revoke();
    } catch {
      throw new RecoveryIncident(
        error instanceof RecoveryIncident ? error.commitState : "unknown",
        "isolation-revoke",
        "ISOLATION_REVOKE_FAILED"
      );
    }
    throw error;
  }
  try {
    await isolation.revoke();
  } catch {
    throw new RecoveryIncident(
      result.commitState,
      "isolation-revoke",
      "ISOLATION_REVOKE_FAILED"
    );
  }
  return result; // No automatic release, even after confirmed commit.
}

/** Fresh A on pre-opened sessions while all account admission stays locked. */
export async function runIsolatedPreflight(
  input: unknown,
  runtime: Runtime,
  isolation: FinancialIsolation
) {
  const request = requestSchema.parse(input);
  if (request.operation !== "financial-b" || request.mode !== "dry-run")
    throw Error("ISOLATION_PREFLIGHT_READ_ONLY");
  const open = await isolation.readLease(request);
  try {
    return await runRecovery(request, { ...runtime, open });
  } catch (error) {
    await isolation.revoke();
    throw error;
  }
}
