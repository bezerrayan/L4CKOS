/** V2 is opt-in for NEW proposals only. Never extends a legacy request/approval. */
import { z } from "zod";
import { digest } from "./operator";
import { ORDER13_DRAINAGE_WINDOW } from "./operationalDrainage";
const stamp = z.string().datetime({ offset: true });
export const authorizationSchema = z
  .object({
    policy: z.literal("ORDER13_SCOPED_RENEWAL_V2"),
    validFrom: stamp,
    validUntil: stamp,
    scope: z.record(z.string(), z.unknown()),
  })
  .strict();
export const claimsWindowSchema = z
  .object({
    id: z.string().min(8),
    validFrom: stamp,
    validUntil: stamp,
  })
  .strict();
export const renewableSchema = z
  .object({
    authorization: authorizationSchema,
    request: z.record(z.string(), z.any()),
    claimsWindow: claimsWindowSchema,
  })
  .strict();
export type Renewable = z.infer<typeof renewableSchema>;
function need(ok: unknown, code: string): asserts ok {
  if (!ok) throw Error(code);
}
export function validPeriod(
  v: { validFrom: string; validUntil: string },
  now = Date.now()
) {
  const from = Date.parse(v.validFrom),
    until = Date.parse(v.validUntil);
  need(
    Number.isFinite(from) &&
      Number.isFinite(until) &&
      from <= now &&
      now < until &&
      until - from <= 900000 &&
      until > from,
    "AUTHORIZATION_EXPIRED_OR_INVALID"
  );
}
/** Everything is bound except this explicit list of renewable evidence fields.
 * State hashes stay bound: stock/order/reservation/queue drift requires a new proposal.
 */
export function authorizationScope(raw: Record<string, any>) {
  const r = structuredClone(raw);
  delete r.evidence.observedAt;
  delete r.checkpoint.observedAt;
  delete r.checkpoint.evidenceHash;
  delete r.readiness.checkpointHash;
  delete r.readiness.panel.reviewedAt;
  for (const k of [
    "archiveSha256",
    "manifestReference",
    "custodyReference",
    "verifiedAt",
  ])
    delete r.readiness.backup[k];
  delete r.readiness.quiescence.verifiedAt;
  delete r.readiness.quiescence.reference;
  for (const k of ["validFrom", "validUntil", "backupRestoreReference"])
    delete r.approval[k];
  return {
    request: r,
    historicalClaims: ORDER13_DRAINAGE_WINDOW.claims,
    externalEmailOutcome: "UNKNOWN",
    claimsPolicy: "FRESH_FULL_ROW_HASHES_BOTH_GATES_NO_DISPATCH",
  };
}
export function proposeAuthorization(
  request: Record<string, any>,
  validFrom: string,
  validUntil: string
) {
  const proposal = authorizationSchema.parse({
    policy: "ORDER13_SCOPED_RENEWAL_V2",
    validFrom,
    validUntil,
    scope: authorizationScope(request),
  });
  validPeriod(proposal);
  return proposal;
}
export function validateRenewable(
  raw: unknown,
  approvedHash: string,
  now = Date.now()
): Renewable {
  const value = renewableSchema.parse(raw);
  need(
    /^[a-f0-9]{64}$/.test(approvedHash) &&
      digest(value.authorization) === approvedHash,
    "EXPLICIT_APPROVAL_HASH_REQUIRED"
  );
  validPeriod(value.authorization, now);
  validPeriod(value.claimsWindow, now);
  need(
    digest(authorizationScope(value.request)) ===
      digest(value.authorization.scope),
    "AUTHORIZED_SCOPE_CHANGED"
  );
  need(
    value.request.approval.validFrom === value.authorization.validFrom &&
      value.request.approval.validUntil === value.authorization.validUntil,
    "AUTHORIZATION_PERIOD_MISMATCH"
  );
  return value;
}
