import { diagnosticStage } from './diagnostics';
import type { Connection } from 'mysql2/promise';
import { drizzle } from 'drizzle-orm/mysql2';
import { readStructuralSchema, structuralHash } from '../schema/fingerprint';
import { applyFinancialCore } from './financialKernel';
import { applyCreatedCore } from './createdKernel';
import { bindKernel, type KernelContext, type Transaction } from './kernelContext';
import { fetchOfficialEvidence } from './provider';
import { captureSnapshot, assertSameSnapshot, inspectPending, inspectRejected, verifyFinancial, verifyCreated, query, assertNoReversalObservations } from './evidence';
import { TARGET, digest, requestSchema, assertEnvironment, assertDatabaseIdentity, assertApproval, assertFresh,
  stop, type Environment, type Snapshot, type FinancialReceipt, type Checkpoint, type RecoveryRequest } from './policy';

export type CommitState = 'not_started' | 'rolled_back' | 'confirmed' | 'unknown';
export class RecoveryIncident extends Error {
  constructor(public readonly commitState: CommitState, public readonly phase: string, code='RECOVERY_STOP_REQUIRES_INDEPENDENT_READ') {
    super(code);
  }
}
// Dependency seams for local tests. The shipped CLI fixes each dependency and
// accepts no database, identity, provider or bundle override from stdin/arguments.
export type Runtime = {
  environment: Environment; artifactHash: string;
  open: () => Promise<Connection>;
  identity: (connection: Connection) => Promise<{ database: string; uuidHash: string }>;
  bundleHash: () => Promise<string>;
  fetch: typeof fetch;
};
export async function readDatabaseIdentity(c: Connection) {
  const [r]=await query(c,'SELECT DATABASE() AS `database`,SHA2(@@server_uuid,256) uuidHash');
  return {database:String(r.database),uuidHash:String(r.uuidHash)};
}
export async function runRecovery(input: unknown, supplied: Runtime) {
  const request=requestSchema.parse(input);
  const runtime={...supplied,environment:Object.freeze({...supplied.environment})};
  assertEnvironment(runtime.environment);assertApproval(request,runtime.artifactHash);
  let phase='preflight',commitState: CommitState='not_started';
  async function identity(c: Connection, schema=true) {
    assertEnvironment(runtime.environment);
    await diagnosticStage('database-identity',async()=>assertDatabaseIdentity(await runtime.identity(c)));
    await diagnosticStage('bundle-verification',async()=>{if(await runtime.bundleHash()!==TARGET.bundleHash) stop('RECOVERY_BUNDLE_MISMATCH');});
    if(schema) await diagnosticStage('schema-verification',async()=>{if(structuralHash(await readStructuralSchema(c))!==TARGET.schemaHash) stop('RECOVERY_SCHEMA_MISMATCH');});
    await diagnosticStage('database-timezone',async()=>{const [zone]=await query(c,'SELECT @@session.time_zone zone,@@system_time_zone systemZone');
    if(!['+00:00','UTC'].includes(zone.zone) && !(zone.zone==='SYSTEM' && zone.systemZone==='UTC')) stop('RECOVERY_DATABASE_UTC_REQUIRED');});
  }
  async function read<T>(action:(c:Connection)=>Promise<T>) {
    const c=await diagnosticStage('mysql-open',()=>runtime.open());
    try {
      await identity(c);
      await diagnosticStage('read-only-transaction',async()=>{await c.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ');
      await c.query('SET TRANSACTION READ ONLY');await c.beginTransaction();});
      try {const value=await action(c);await c.commit();return value;}
      catch(error){await c.rollback();throw error;}
    } finally {await c.end();}
  }
  function assertReceipt(receipt: FinancialReceipt | undefined, fresh=true): asserts receipt is FinancialReceipt {
    if(!receipt || receipt.artifactHash!==runtime.artifactHash || receipt.deploymentId!==TARGET.deploymentId)
      stop('RECOVERY_FINANCIAL_VERIFICATION_REQUIRED');
    if(fresh) assertFresh(receipt.verifiedAt);
  }
  const checkpoint=request.checkpoint;
  const baseline=request.baseline??checkpoint?.snapshot;
  const receipt=request.financialReceipt;
  try {
    if(request.operation==='verify-financial') {
      if(!baseline || !request.financialApprovalReference) stop('RECOVERY_VERIFICATION_BASELINE_REQUIRED');
      phase='independent-financial-verification';
      const current=await read(c=>verifyFinancial(c,baseline,request.financialApprovalReference!,runtime.artifactHash));
      if(current.createdHash!==baseline.createdHash) stop('RECOVERY_CREATED_CHANGED_BEFORE_VERIFICATION');
      const financialReceipt=makeReceipt(current,baseline,request.financialApprovalReference,runtime.artifactHash);
      return {status:'verified' as const,operation:request.operation,commitState,financialReceipt};
    }
    if(request.operation==='verify-created') {
      assertReceipt(receipt,false);if(!baseline) stop('RECOVERY_VERIFICATION_BASELINE_REQUIRED');
      phase='independent-created-verification';
      const current=await read(c=>verifyCreated(c,baseline,receipt,runtime.artifactHash));
      return {status:'verified' as const,operation:request.operation,commitState,snapshot:current};
    }
    if(request.operation==='created') assertReceipt(receipt);
    let duplicate=false;
    let expectedAfter:Snapshot|undefined;
    const preflight=await read(async c=>{
      await diagnosticStage('reversal-observations',()=>assertNoReversalObservations(c));
      const snapshot=await diagnosticStage('snapshot',()=>captureSnapshot(c));
      if(request.operation==='financial-b') {
        // Idempotent reentry must independently prove this same approved commit.
        if(request.mode==='execute' && checkpoint && snapshot.financialHash!==checkpoint.snapshot.financialHash) {
          const verified=await verifyFinancial(c,checkpoint.snapshot,request.approval!.reference,runtime.artifactHash);
          if(verified.createdHash!==checkpoint.snapshot.createdHash) stop('RECOVERY_CREATED_CHANGED_BEFORE_VERIFICATION');
          duplicate=true;
        } else {await diagnosticStage('pending-preconditions',()=>inspectPending(c));if(request.mode==='execute') assertSameSnapshot(snapshot,checkpoint!.snapshot);}
      } else {
        const verified=await verifyFinancial(c,receipt!.baseline,receipt!.financialApprovalReference,runtime.artifactHash);
        if(verified.financialHash!==receipt!.financialHash) stop('RECOVERY_FINANCIAL_DRIFT');
        if(request.mode==='execute' && checkpoint && snapshot.createdHash!==checkpoint.snapshot.createdHash) {
          await verifyCreated(c,checkpoint.snapshot,receipt!,runtime.artifactHash);duplicate=true;
        } else {await inspectRejected(c);if(request.mode==='execute') assertSameSnapshot(snapshot,checkpoint!.snapshot);}
      }
      return snapshot;
    });
    const evidence=await diagnosticStage('provider-evidence',()=>fetchOfficialEvidence(runtime.environment,runtime.fetch));
    if(request.mode==='dry-run') {
      const prepared: Checkpoint={version:1,operation:request.operation,artifactHash:runtime.artifactHash,
        deploymentId:TARGET.deploymentId,snapshot:preflight};
      return {status:'dry-run' as const,operation:request.operation,commitState,writes:false,
        checkpoint:prepared,checkpointHash:digest(prepared),financialReceipt:receipt};
    }
    assertApproval(request,runtime.artifactHash);
    const original=checkpoint!.snapshot;
    phase=request.operation;
    const writer=await runtime.open();
    let result: {status:string};
    try {
      await identity(writer);
      const db=drizzle(writer);
      const context:KernelContext=bindKernel({db,artifactHash:runtime.artifactHash,approvalHash:digest(request.approval),
        assertIdentity:()=>identity(writer,false),
        beforeWrite:async()=>{
          assertApproval(request,runtime.artifactHash);await identity(writer,false);assertFresh(evidence.observedAt);
          if(request.operation==='created') {
            // Lock financial proof/notification so CREATED cannot follow a
            // concurrent financial change or a dispatcher claim unnoticed.
            for(const statement of [
              'SELECT id FROM users WHERE id=14 AND role=\'admin\' FOR SHARE',
              'SELECT id FROM products WHERE id=1 FOR UPDATE',
              'SELECT id FROM stockReservations WHERE orderId=13 FOR UPDATE',
              'SELECT id FROM payments WHERE orderId=13 FOR UPDATE',
              'SELECT id FROM auditLogs WHERE orderId=13 FOR SHARE',
              'SELECT id FROM notificationOutbox WHERE orderId=13 FOR UPDATE']) await query(writer,statement);
            const current=await verifyFinancial(writer,receipt!.baseline,receipt!.financialApprovalReference,runtime.artifactHash);
            if(current.financialHash!==receipt!.financialHash) stop('RECOVERY_FINANCIAL_DRIFT');
            const [admin]=await query(writer,'SELECT role FROM users WHERE id=14 FOR SHARE');
            if(admin?.role!=='admin') stop('RECOVERY_ADMIN_REQUIRED');
          }
          await assertNoReversalObservations(writer);
          const current=await captureSnapshot(writer);
          if(!duplicate) assertSameSnapshot(current,original);
          if(request.operation==='financial-b') await inspectPending(writer);
          else await inspectRejected(writer,duplicate);
        },
        transaction:async run=>{
          await writer.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ');
          await writer.beginTransaction();let committing=false;
          try {
            const value=await run(db as unknown as Transaction);
            assertApproval(request,runtime.artifactHash);await identity(writer,false);
            if(request.operation==='financial-b') {
              const current=await verifyFinancial(writer,original,request.approval!.reference,runtime.artifactHash);
              if(current.createdHash!==original.createdHash) stop('RECOVERY_CREATED_CHANGED_DURING_FINANCIAL');
              expectedAfter=current;
            } else {
              expectedAfter=await verifyCreated(writer,original,receipt!,runtime.artifactHash);
              const [audit]=await query(writer,"SELECT metadata FROM auditLogs WHERE action='webhook.created_recovery_completed' AND correlationId=?",[TARGET.eventId]);
              if(JSON.parse(audit.metadata).approvalReference!==request.approval!.reference) stop('RECOVERY_APPROVAL_SCOPE_MISMATCH');
            }
            committing=true;await writer.commit();commitState='confirmed';return value;
          } catch(error) {
            if(committing) commitState='unknown';
            else {try {await writer.rollback();commitState='rolled_back';}catch {commitState='unknown';}}
            throw error;
          }
        },
      });
      if(request.operation==='financial-b') {
        result=await applyFinancialCore({path:'B',actorUserId:14,approvalReference:request.approval!.reference,
          justification:request.approval!.justification,evidence},context);
      } else {
        result=await applyCreatedCore({eventId:TARGET.eventId,payloadHash:TARGET.payloadHash,paymentId:TARGET.paymentId,
          expectedAttempts:1,actorUserId:14,approvalReference:request.approval!.reference},
        async()=>{
          // Restricted CREATED branch of the approved handler: durable observation
          // only. No payment controller/provider/email imports, no paid-event path.
          const existing=await query(writer,'SELECT * FROM asaasWebhookEvents WHERE eventId=? FOR UPDATE',[TARGET.eventId]);
          if(existing.length) stop('RECOVERY_CREATED_LEDGER_CONFLICT');
          await writer.execute("INSERT INTO asaasWebhookEvents(eventId,eventType,paymentId,orderId,payloadHash,status,processedAt) VALUES(?,'PAYMENT_CREATED',?,13,?,'processed',UTC_TIMESTAMP())",
            [TARGET.eventId,TARGET.paymentId,TARGET.sourcePayloadHash]);
          return {status:200,body:{handled:true,event:'PAYMENT_CREATED',orderId:13}};
        },context);
      }
    } finally {await writer.end();}
    // No success is reported solely because COMMIT returned. New connection,
    // READ ONLY transaction and independent SQL verifier are mandatory.
    phase='postcommit-independent-verification';
    const after=await read(c=>request.operation==='financial-b'
      ?verifyFinancial(c,original,request.approval!.reference,runtime.artifactHash)
      :verifyCreated(c,original,receipt!,runtime.artifactHash));
    if(!expectedAfter) stop('RECOVERY_COMMIT_SNAPSHOT_MISSING');
    assertSameSnapshot(after,expectedAfter);
    await fetchOfficialEvidence(runtime.environment,runtime.fetch);
    if(request.operation==='financial-b' && after.createdHash!==original.createdHash) stop('RECOVERY_CREATED_CHANGED_DURING_FINANCIAL');
    if(result.status!=='completed' && result.status!=='already_completed') stop('RECOVERY_PARTIAL_RESULT');
    return {status:result.status,operation:request.operation,commitState,independentlyVerified:true,snapshot:after,
      financialReceipt:request.operation==='financial-b'?makeReceipt(after,original,request.approval!.reference,runtime.artifactHash):receipt};
  } catch(error) {
    // Never print SQL, provider bodies, URI, driver messages or approval text.
    // Confirmed/unknown commits are incidents, never automatic retries/undo.
    if((commitState as CommitState)==='confirmed' || (commitState as CommitState)==='unknown') throw new RecoveryIncident(commitState,phase);
    if((commitState as CommitState)==='rolled_back') {
      const code=error instanceof Error && /^RECOVERY_[A-Z_]+$/.test(error.message)?error.message:'RECOVERY_TRANSACTION_ROLLED_BACK';
      throw new RecoveryIncident('rolled_back',phase,code);
    }
    throw error;
  }
}
function makeReceipt(current: Snapshot, baseline: Snapshot, reference: string, artifactHash: string): FinancialReceipt {
  return {version:1,operation:'verify-financial',verified:true,verifiedAt:new Date().toISOString(),artifactHash,
    deploymentId:TARGET.deploymentId,financialApprovalReference:reference,financialHash:current.financialHash,
    historicalHash:current.historicalHash,baseline};
}
