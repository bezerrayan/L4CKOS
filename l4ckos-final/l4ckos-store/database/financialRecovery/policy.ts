import { z } from 'zod';
import { canonical, sha256 } from '../schema/fingerprint';

export const TARGET = Object.freeze({
  projectId: '2bb90c8e-eb65-43ee-826b-f93750f0499c',
  environmentId: '15545eee-bc02-4b70-afc4-19a5db9e6f46',
  serviceId: '9f1c7705-f2f9-48cf-b957-8f63a6bba4db',
  deploymentId: '2586b697-2db5-45c5-8e88-030172ec14b7',
  domain: 'api-staging.l4ckos.com.br', database: 'l4ckos_staging',
  mysqlUuidHash: '92e96ae744d2112c5b4a430abc9a75d557a43d293652dd68369aa81786479f09',
  schemaHash: '0ba16c9b19b698d4933d0abad9a5e4679052fd2aaf78800da42d480e396ef5d2',
  bundleHash: 'b906435220bb6470dcd34eded26eb4f2d97fcb7a75da7268aeacb3906849e898',
  paymentId: 'pay_dog6ppexq4gyw3k6',
  eventId: 'evt_05b708f961d739ea7eba7e4db318f621&21683762',
  payloadHash: 'de2c741317cfa80116652027ff2e5ac385d27c972b90ec13eff6018821e89130',
  sourcePayloadHash: '2733c98ee9ab7d003376fe8a5a3e07378090cb577591d924c3caafe940b5d315',
  outboxKey: 'rc2-recovery-order13-payment-approved-v1',
});
export const CANDIDATES = Object.freeze({
  'server/payments/supervisedFinancialRecoveryRehearsal.ts': '404dc0b73b72c7e285d0305a959371bd2cda94390d849a191f6d479858455d79',
  'server/database/supervisedFinancialRecovery.mysql.test.ts': '15ecd43e6fd41ae4aba8456eb080318fb335a87e07450eb04da0fe09451ecfb0',
  'server/payments/supervisedCreatedRecoveryRehearsal.ts': '526c4b82da367c5d5a4713b613ec96529b0a1b6f6c361b0f63d36b31f585a8fc',
  'server/database/supervisedCreatedRecovery.mysql.test.ts': 'e3650a59f479f14a199210ec641185bd6153221c1bcbca54f040dba917021cf5',
});
export const digest = (value: unknown) => sha256(canonical(value));
export const hashSchema = z.string().regex(/^[a-f0-9]{64}$/);
export const referenceSchema = z.string().regex(/^[A-Za-z0-9_-]{8,80}$/);
const time = z.string().datetime({ offset: true });
export const operationSchema = z.enum(['financial-b', 'created', 'verify-financial', 'verify-created']);
export type Operation = z.infer<typeof operationSchema>;
const hashes = z.record(z.string(), hashSchema);
export const snapshotSchema = z.object({
  capturedAt: time, targetHash: hashSchema, historicalHash: hashSchema,
  immutableTargetHash: hashSchema, tableHashes: hashes, financialHash: hashSchema, createdHash: hashSchema,
  stock: z.number().int().nonnegative(), originalExpiresAt: z.string(),
}).strict();
export type Snapshot = z.infer<typeof snapshotSchema>;
export const checkpointSchema = z.object({
  version: z.literal(1), operation: z.enum(['financial-b', 'created']),
  artifactHash: hashSchema, deploymentId: z.literal(TARGET.deploymentId),
  snapshot: snapshotSchema,
}).strict();
export type Checkpoint = z.infer<typeof checkpointSchema>;
export const receiptSchema = z.object({
  version: z.literal(1), operation: z.literal('verify-financial'), verified: z.literal(true),
  verifiedAt: time, artifactHash: hashSchema, deploymentId: z.literal(TARGET.deploymentId),
  financialApprovalReference: referenceSchema, financialHash: hashSchema,
  historicalHash: hashSchema, baseline: snapshotSchema,
}).strict();
export type FinancialReceipt = z.infer<typeof receiptSchema>;
export const approvalSchema = z.object({
  operation: z.enum(['financial-b', 'created']),
  projectId: z.literal(TARGET.projectId), environmentId: z.literal(TARGET.environmentId), serviceId: z.literal(TARGET.serviceId),
  deploymentId: z.literal(TARGET.deploymentId), artifactHash: hashSchema, checkpointHash: hashSchema,
  reference: referenceSchema, actorUserId: z.literal(14), justification: z.string().trim().min(20).max(400),
  validFrom: time, validUntil: time,
  confirmation: z.literal('AUTHORIZE_ONE_STAGING_OPERATION_ONLY'),
  expiredReservationException: z.boolean(), unknownFinancialReceiptTime: z.boolean(),
  createdRetryMayAck: z.boolean(), pendingNotificationIntent: z.enum(['create-one-order13','preserve-all']),
  notificationDispatch: z.literal(false), queueResume: z.literal(false),
  writersQuiesced: z.literal(true), dispatchersQuiesced: z.literal(true), backupRestoreReference: referenceSchema,
  // CREATED approval names the separately verified B commit; B leaves this null.
  financialReceiptHash: hashSchema.nullable(),
}).strict();
export type Approval = z.infer<typeof approvalSchema>;
export const requestSchema = z.object({
  operation: operationSchema, mode: z.enum(['dry-run', 'execute']).default('dry-run'),
  approval: approvalSchema.optional(), checkpoint: checkpointSchema.optional(),
  financialReceipt: receiptSchema.optional(), baseline: snapshotSchema.optional(),
  financialApprovalReference: referenceSchema.optional(),
}).strict();
export type RecoveryRequest = z.infer<typeof requestSchema>;
export type Environment = Record<string, string | undefined>;
export function stop(code: string): never { throw new Error(code); }
export function assertEnvironment(env: Environment) {
  const expected = { RAILWAY_PROJECT_ID: TARGET.projectId, RAILWAY_ENVIRONMENT_ID: TARGET.environmentId,
    RAILWAY_SERVICE_ID: TARGET.serviceId, RAILWAY_DEPLOYMENT_ID: TARGET.deploymentId };
  for (const [key, value] of Object.entries(expected)) if (env[key] !== value) stop('RECOVERY_ENVIRONMENT_MISMATCH');
  if (env.ASAAS_API_URL?.trim().replace(/\/+$/, '') !== 'https://api-sandbox.asaas.com/v3' ||
      env.ASAAS_CHECKOUT_BASE_URL?.trim().replace(/\/+$/, '') !== 'https://sandbox.asaas.com' ||
      !env.ASAAS_API_KEY?.startsWith('$aact_hmlg_')) stop('RECOVERY_SANDBOX_CONFIGURATION_REQUIRED');
  let uri: URL;
  try { uri = new URL(env.DATABASE_URL ?? ''); } catch { return stop('RECOVERY_DATABASE_TARGET_MISMATCH'); }
  if (uri.protocol !== 'mysql:' || uri.hostname !== 'mysql.railway.internal' ||
      uri.pathname !== '/'+TARGET.database || uri.search || uri.hash || !uri.username || !uri.password ||
      (uri.port && uri.port !== '3306')) stop('RECOVERY_DATABASE_TARGET_MISMATCH');
  return uri;
}
export function assertDatabaseIdentity(row: { database: string; uuidHash: string }) {
  if (row.database !== TARGET.database || row.uuidHash !== TARGET.mysqlUuidHash) stop('RECOVERY_DATABASE_IDENTITY_MISMATCH');
}
export function assertFresh(timeValue: string, maximumMs = 120_000) {
  const elapsed = Date.now() - Date.parse(timeValue);
  if (!Number.isFinite(elapsed) || elapsed < -5_000 || elapsed > maximumMs) stop('RECOVERY_EVIDENCE_STALE');
}
export function assertApproval(request: RecoveryRequest, artifactHash: string) {
  if (request.mode !== 'execute') return;
  if (request.operation !== 'financial-b' && request.operation !== 'created') stop('RECOVERY_VERIFY_IS_READ_ONLY');
  const a = request.approval, checkpoint = request.checkpoint;
  if (!a || !checkpoint) stop('RECOVERY_EXPLICIT_APPROVAL_REQUIRED');
  const now = Date.now(), start = Date.parse(a.validFrom), end = Date.parse(a.validUntil);
  if (now < start || now >= end || end-start <= 0 || end-start > 15*60_000) stop('RECOVERY_APPROVAL_WINDOW_INVALID');
  if (a.operation !== request.operation || checkpoint.operation !== request.operation ||
      a.artifactHash !== artifactHash || checkpoint.artifactHash !== artifactHash ||
      a.checkpointHash !== digest(checkpoint)) stop('RECOVERY_APPROVAL_SCOPE_MISMATCH');
  const financial=request.operation==='financial-b';
  if(a.expiredReservationException!==financial || a.unknownFinancialReceiptTime!==financial ||
    a.createdRetryMayAck===financial || a.pendingNotificationIntent!==(financial?'create-one-order13':'preserve-all'))
    stop('RECOVERY_APPROVAL_EFFECTS_MISMATCH');
  assertFresh(checkpoint.snapshot.capturedAt);
  if (request.operation === 'financial-b' && a.financialReceiptHash !== null) stop('RECOVERY_APPROVAL_SCOPE_MISMATCH');
  if (request.operation === 'created' && (!request.financialReceipt ||
      a.financialReceiptHash !== digest(request.financialReceipt))) stop('RECOVERY_FINANCIAL_VERIFICATION_REQUIRED');
}
