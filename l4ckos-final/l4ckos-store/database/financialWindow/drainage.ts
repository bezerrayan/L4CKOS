import { z } from "zod";
import type { Connection } from "mysql2/promise";
import { rows } from "../schema/fingerprint";
import type { AdmissionEvidence } from "../financialIsolation/controller";
export type ExternalDrainProof = {
  observedAt: number;
  httpStatus: 503;
  oldInstancesTerminated: true;
  workersPaused: true;
  dispatchersPaused: true;
  externalWriterInventoryComplete: true;
  providerCallsInFlight: 0;
  reference: string;
};
/** Foreign proofs must come from the authenticated transport/signed approval.
 * Processing histories are not reset or silently waived; any unresolved one stops.
 */
export async function collectDrainage(
  c: Connection,
  proof: ExternalDrainProof
): Promise<AdmissionEvidence> {
  const parsed = z
    .object({
      observedAt: z.number().int().nonnegative(),
      httpStatus: z.literal(503),
      oldInstancesTerminated: z.literal(true),
      workersPaused: z.literal(true),
      dispatchersPaused: z.literal(true),
      externalWriterInventoryComplete: z.literal(true),
      providerCallsInFlight: z.literal(0),
      reference: z.string().regex(/^[-a-zA-Z0-9_]{8,80}$/),
    })
    .strict()
    .safeParse(proof);
  if (!parsed.success) throw Error("WINDOW_EXTERNAL_DRAIN_NOT_PROVEN");
  proof = parsed.data;
  if (
    proof.httpStatus !== 503 ||
    proof.oldInstancesTerminated !== true ||
    proof.workersPaused !== true ||
    proof.dispatchersPaused !== true ||
    proof.externalWriterInventoryComplete !== true ||
    proof.providerCallsInFlight !== 0 ||
    !/^[-a-zA-Z0-9_]{8,80}$/.test(proof.reference) ||
    Date.now() - proof.observedAt > 30000 ||
    proof.observedAt > Date.now()
  )
    throw Error("WINDOW_EXTERNAL_DRAIN_NOT_PROVEN");
  for (const sql of [
    "SELECT COUNT(*) n FROM information_schema.EVENTS",
    "SELECT COUNT(*) n FROM asaasWebhookInbox WHERE state IN ('received','processing','failed')",
    "SELECT COUNT(*) n FROM notificationOutbox WHERE status='processing' OR leaseExpiresAt>UTC_TIMESTAMP()",
    "SELECT COUNT(*) n FROM orderEmailEvents WHERE status='processing'",
  ]) {
    if (Number((await rows(c, sql))[0].n))
      throw Error("WINDOW_DRAIN_PENDING_OR_ACTIVE");
  }
  return {
    httpBlocked: true,
    workersBlocked: true,
    dispatchersDrained: true,
    externalJobsInventoried: true,
    observedAt: proof.observedAt,
  };
}
