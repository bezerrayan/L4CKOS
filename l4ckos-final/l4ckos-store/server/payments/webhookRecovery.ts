import {createHash} from 'node:crypto';
import {sql, type SQL} from 'drizzle-orm';
import {z} from 'zod';
import {canonical} from '../../database/schema/fingerprint';
import {parseAsaasOrderReference} from '../../shared/asaasWebhookSemantics';
import {selectiveEffectsAllowed,selectiveEventAllowed,selectiveOrderAllowed} from './stagingCheckoutAdmission';

export const RECOVERY_HOLD_ACTION='webhook.recovery_held.v1';
const EVIDENCE_ACTION='webhook.recovery_evidence.v1';
const stamp=()=>JSON.stringify([process.env.ASAAS_WEBHOOK_RECOVERY_MODE||'',process.env.NODE_ENV,
  process.env.RAILWAY_PROJECT_ID,process.env.RAILWAY_ENVIRONMENT_ID,process.env.RAILWAY_SERVICE_ID]);
let startupStamp:string|undefined;
/** Process configuration is immutable. Activation requires draining old replicas, not a live toggle. */
export function captureRecoveryFence(){
  const signature=stamp();
  if(startupStamp!==undefined&&startupStamp!==signature)throw Error('WEBHOOK_RECOVERY_RESTART_REQUIRED');
  const mode=process.env.ASAAS_WEBHOOK_RECOVERY_MODE||'';
  if(!['','off','review_only'].includes(mode))throw Error('WEBHOOK_RECOVERY_MODE_INVALID');
  if(mode==='review_only'&&(process.env.NODE_ENV!=='production'||
    process.env.RAILWAY_PROJECT_ID!=='2bb90c8e-eb65-43ee-826b-f93750f0499c'||
    process.env.RAILWAY_ENVIRONMENT_ID!=='15545eee-bc02-4b70-afc4-19a5db9e6f46'||
    process.env.RAILWAY_SERVICE_ID!=='9f1c7705-f2f9-48cf-b957-8f63a6bba4db'))throw Error('WEBHOOK_RECOVERY_STAGING_REQUIRED');
  return {signature,reviewOnly:mode==='review_only'};
}
export function initializeWebhookRecoveryMode(){const fence=captureRecoveryFence();startupStamp=fence.signature;return fence;}
export function assertRecoveryFence(fence:ReturnType<typeof captureRecoveryFence>){
  if(captureRecoveryFence().signature!==fence.signature)throw Error('WEBHOOK_RECOVERY_CONFIGURATION_CHANGED');
}
export function assertWebhookBusinessEffectsAllowed(){
  if(captureRecoveryFence().reviewOnly&&!selectiveEffectsAllowed())throw Error('WEBHOOK_RECOVERY_EFFECTS_BLOCKED');
}
type Executor={execute:(q:SQL)=>Promise<unknown>};
type Record={eventId:string,payloadHash:string,payload:string|null};
const hash=(x:unknown)=>createHash('sha256').update(canonical(x)).digest('hex');
const key=(id:string)=>createHash('sha256').update(id).digest('hex');
const rows=async<T>(db:Executor,q:SQL)=>(await db.execute(q) as [T[]])[0];
async function audit(db:Executor,action:string,eventId:string){
  const [r]=await rows<{metadata:string}>(db,sql`SELECT metadata FROM auditLogs WHERE action=${action} AND entity='asaasWebhookInbox' AND entityId=${key(eventId)} FOR UPDATE`);
  if(!r)return null;
  const meta=typeof r.metadata==='string'?JSON.parse(r.metadata):r.metadata as any;
  if(meta.eventId!==eventId)throw Error('WEBHOOK_RECOVERY_HOLD_CORRUPT');
  return meta;
}
export async function hasRecoveryHold(db:Executor,eventId:string,payloadHash?:string){
  const held=await audit(db,RECOVERY_HOLD_ACTION,eventId);
  if(held&&payloadHash&&held.payloadHash!==payloadHash)throw Error('WEBHOOK_EVENT_CONFLICT');
  return !!held;
}
/** No public release/reset API. Changing inbox.state or disabling the flag does not release an event. */
export async function assertNoRecoveryHold(db:Executor,eventId:string){
  if(captureRecoveryFence().reviewOnly){if(selectiveEventAllowed(eventId))return;throw Error('WEBHOOK_RECOVERY_EFFECTS_BLOCKED');}
  assertWebhookBusinessEffectsAllowed();
  if(await hasRecoveryHold(db,eventId))throw Error('WEBHOOK_RECOVERY_RELEASE_REQUIRED');
}
export async function assertOrderNotRecoveryHeld(db:Executor,orderId:number){
  if(captureRecoveryFence().reviewOnly){if(selectiveOrderAllowed(orderId))return;throw Error('WEBHOOK_RECOVERY_EFFECTS_BLOCKED');}
  assertWebhookBusinessEffectsAllowed();
  const [held]=await rows(db,sql`SELECT id FROM auditLogs WHERE action=${RECOVERY_HOLD_ACTION} AND entity='asaasWebhookInbox' AND JSON_UNQUOTE(JSON_EXTRACT(metadata,'$.orderId'))=${String(orderId)} LIMIT 1`);
  if(held)throw Error('WEBHOOK_RECOVERY_RELEASE_REQUIRED');
}
// Extra recovery evidence is allowlisted independently from the historical canonical envelope.
// It never changes existing inbox payload/hash, and is committed with admission/hold.
const date=z.string().max(40).regex(/^[0-9T:Z+. -]+$/).nullish();
const status=z.string().max(64).regex(/^[A-Z_]+$/).nullish();
const id=z.string().max(191).nullish();
const money=z.number().finite().nonnegative().nullish();
const detailsSchema=z.object({dateCreated:date,payment:z.object({billingType:status,paymentDate:date,
  clientPaymentDate:date,confirmedDate:date,creditDate:date,estimatedCreditDate:date,
  refunds:z.array(z.object({id,status,value:money,dateCreated:date})).max(100).nullish(),
  chargeback:z.object({id,status,reason:status,disputeStatus:status}).nullish(),
}).optional()});
export function recoveryEvidence(payload:unknown){return detailsSchema.parse(payload);}
export async function retainForRecovery(db:Executor,record:Record,envelope:any,details?:unknown){
  const prior=await audit(db,RECOVERY_HOLD_ACTION,record.eventId);
  if(prior&&prior.payloadHash!==record.payloadHash)throw Error('WEBHOOK_EVENT_CONFLICT');
  if(!prior){
    const reference=envelope.payment?.externalReference??envelope.externalReference;
    const metadata=JSON.stringify({eventId:record.eventId,payloadHash:record.payloadHash,eventType:envelope.event,
      paymentId:envelope.payment?.id??null,externalReference:reference??null,orderId:parseAsaasOrderReference(reference),
      envelope,reviewOnly:true,releaseRequired:true,financialMutation:false,notificationMutation:false});
    await db.execute(sql`INSERT INTO auditLogs(actorType,action,entity,entityId,metadata) VALUES('system',${RECOVERY_HOLD_ACTION},'asaasWebhookInbox',${key(record.eventId)},${metadata})`);
  }
  if(details!==undefined){
    const evidenceHash=hash(details),old=await audit(db,EVIDENCE_ACTION,record.eventId);
    if(old&&old.evidenceHash!==evidenceHash)throw Error('WEBHOOK_EVENT_CONFLICT');
    if(!old){const metadata=JSON.stringify({eventId:record.eventId,payloadHash:record.payloadHash,evidenceHash,details});
      await db.execute(sql`INSERT INTO auditLogs(actorType,action,entity,entityId,metadata) VALUES('system',${EVIDENCE_ACTION},'asaasWebhookInbox',${key(record.eventId)},${metadata})`);}
  }
  return {status:200,body:{handled:false,reason:'recovery_review_held',reconciliationRequired:true,financialMutation:false,releaseRequired:true}};
}
