import { CANDIDATES, stop } from './policy';
import { sha256 } from '../schema/fingerprint';
// Explicit, reviewed source adaptation. SQL/locks/evidence remain the approved
// candidate's text; original guards and hashes remain unchanged in their files.
export function deriveKernel(source: string, kind: 'financial' | 'created') {
  const file = kind === 'financial' ? 'server/payments/supervisedFinancialRecoveryRehearsal.ts' : 'server/payments/supervisedCreatedRecoveryRehearsal.ts';
  if (sha256(source) !== CANDIDATES[file]) stop('RECOVERY_CANDIDATE_HASH_MISMATCH');
  let output = source.replace('import { getDb } from "../db";', 'import { assertKernelContext, type KernelContext } from "./kernelContext";');
  output = output.replace('"../../database/schema/fingerprint"', '"../schema/fingerprint"')
    .replace('"../../drizzle/schema"', '"../../drizzle/schema"')
    .replace('"../database/webhookTransaction"', '"../../server/database/webhookTransaction"')
    .replace('"./webhookInbox"', '"./envelope"');
  if (kind === 'financial') {
    output = output.replace('export async function rehearseFinancialRecovery(raw: FinancialRecoveryPlan)',
      'export async function applyFinancialCore(raw: FinancialRecoveryPlan, context: KernelContext)');
    const start = output.indexOf('  const db = await getDb();'), end = output.indexOf('  const evidenceHash', start);
    output = output.slice(0,start)+'  await assertKernelContext(context);\n  const db = context.db;\n'+output.slice(end);
    output = output.replace('    if (available < 1) {', '    await context.beforeWrite();\n    if (available < 1) {');
  } else {
    output = output.replace('export async function rehearseCreatedRecovery(input:', 'export async function applyCreatedCore(input:');
    output = output.replace('}, process: WebhookProcessor)', '}, process: WebhookProcessor, context: KernelContext)');
    const start = output.indexOf('  const db = await getDb();'), end = output.indexOf('  return db.transaction', start);
    output = output.slice(0,start)+'  await assertKernelContext(context);\n  const db = context.db;\n'+output.slice(end);
    output = output.replace('    const action = "webhook.created_recovery_completed";',
      '    await context.beforeWrite();\n    const action = "webhook.created_recovery_completed";');
  }
  output = output.replace('tx as unknown as NonNullable<typeof db>', 'tx as unknown as Parameters<typeof inWebhookTransaction>[0]');
  output = output.replace('return db.transaction(async tx => {', 'return context.transaction(async tx => {');
  output = output.replace('localRehearsal: true', 'localRehearsal: false, supervisedStaging: true, approvalHash: context.approvalHash, artifactHash: context.artifactHash');
  return '// Derived from the pinned local candidate by reuse.ts; do not edit independently.\n'+output;
}
