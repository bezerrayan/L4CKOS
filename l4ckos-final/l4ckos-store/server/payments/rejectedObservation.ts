import {createHash} from 'node:crypto';
import {sql,type SQL} from 'drizzle-orm';
import {canonical} from '../../database/schema/fingerprint';

type Executor={execute:(query:SQL)=>Promise<unknown>};
type Record={eventId:string,payload:string|null,payloadHash:string,errorCode:string|null};
const ACTION='webhook.rejected_observation_acknowledged.v1';
const TYPES=new Set(['PAYMENT_CREATED','PAYMENT_UPDATED','PAYMENT_RESTORED']);
const refusal=()=>({status:422,body:{handled:false,code:'REJECTED_EVENT_REQUIRES_REVIEW'}});
const rows=async<T>(tx:Executor,query:SQL)=>(await tx.execute(query) as [T[]])[0];
/** Called only after authenticated admission and with the inbox row locked.
 * Acknowledge a validated NONFINANCIAL observation in an immutable audit record.
 * Never reset rejected, invoke the financial handler, or synthesize a payment.
 */
export async function acknowledgeRejectedObservation(tx:Executor,record:Record){
  if(!record.payload||record.errorCode!=='WEBHOOK_VALIDATION_REJECTED')return refusal();
  let envelope:any;
  try{
    envelope=JSON.parse(record.payload);
    const content={...envelope};delete content.sourcePayloadHash;
    if(createHash('sha256').update(canonical(content)).digest('hex')!==record.payloadHash)return refusal();
  }catch{return refusal();}
  const p=envelope.payment;
  if(envelope.id!==record.eventId||!TYPES.has(envelope.event)||!p||typeof p.id!=='string'||!p.id.trim()||p.id.length>191)return refusal();
  if((envelope.currency&&envelope.currency!=='BRL')||(p.currency&&p.currency!=='BRL'))return refusal();
  if(typeof p.status!=='string'||!p.status.trim()||(envelope.event==='PAYMENT_CREATED'&&p.status!=='PENDING'))return refusal();
  const reference=String(p.externalReference??envelope.externalReference??'');
  if(!/^[1-9][0-9]{0,9}$/.test(reference))return refusal();
  const orderId=Number(reference),value=typeof p.value==='number'||typeof p.value==='string'?Number(p.value):NaN;
  const cents=Math.round(value*100);
  if(!Number.isFinite(value)||value<=0||!Number.isSafeInteger(cents)||Math.abs(value*100-cents)>1e-6)return refusal();
  const [order]=await rows<{id:number,totalPrice:number}>(tx,sql`SELECT id,totalPrice FROM orders WHERE id=${orderId} FOR UPDATE`);
  if(!order||Number(order.totalPrice)!==cents)return refusal();
  const [payment]=await rows<{providerPaymentId:string|null,externalReference:string,amount:number}>(tx,
    sql`SELECT providerPaymentId,externalReference,amount FROM payments WHERE orderId=${orderId} FOR UPDATE`);
  if(payment&&(payment.providerPaymentId!==p.id||payment.externalReference!==reference||Number(payment.amount)!==cents))return refusal();
  const key=createHash('sha256').update(record.eventId).digest('hex');
  const [audit]=await rows<{metadata:string}>(tx,sql`SELECT metadata FROM auditLogs WHERE action=${ACTION} AND entity='asaasWebhookInbox' AND entityId=${key}`);
  if(audit){
    let prior:any;try{prior=typeof audit.metadata==='string'?JSON.parse(audit.metadata):audit.metadata;}catch{return refusal();}
    if(prior.eventId!==record.eventId||prior.payloadHash!==record.payloadHash||prior.orderId!==orderId)return refusal();
  }else{
    const metadata=JSON.stringify({eventId:record.eventId,eventType:envelope.event,payloadHash:record.payloadHash,orderId,paymentId:p.id,
      originalState:'rejected',originalErrorCode:record.errorCode,reconciliationRequired:true,
      reason:payment?'NONFINANCIAL_OBSERVATION':'HISTORICAL_PAYMENT_BINDING_REQUIRES_REVIEW',
      financialMutation:false,reservationMutation:false,notificationMutation:false});
    await tx.execute(sql`INSERT INTO auditLogs(actorType,action,entity,entityId,metadata) VALUES('system',${ACTION},'asaasWebhookInbox',${key},${metadata})`);
  }
  return {status:200,body:{handled:false,reason:'rejected_observation_recorded',reconciliationRequired:true}};
}
