import { randomUUID,createHash } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { getDb } from '../db';
import { webhookDb } from '../database/webhookTransaction';
import { sendPaymentApprovedEmail, sendOrderCreatedEmail, sendPaymentPendingEmail } from '../services/emailService.js';
import { assertEmailRecipientsAllowed, withRecoveryRecipient } from '../services/email/recipientPolicy.js';
import { isStagingMaintenanceEnabled } from '../_core/stagingMaintenance';
import {captureRecoveryFence,assertRecoveryFence,assertWebhookBusinessEffectsAllowed,assertOrderNotRecoveryHeld} from './webhookRecovery';

import {assertSelectedNotification,GRANT,CANDIDATE} from './stagingCheckoutAdmission';

const TYPE='payment-approved-email-v1';
const TYPES=[TYPE,'order-created-email-v1','payment-pending-email-v1']; // Never drains legacy reconciliation or other notification types.
type Payload=Parameters<typeof sendPaymentApprovedEmail>[0];
export async function enqueuePaymentApproved(orderId:number,payload:Omit<Payload,"customerEmail"|"customerName">){
  assertWebhookBusinessEffectsAllowed();
  const db=webhookDb(); // Must commit with financial effects; no unbound enqueue.
  if(!db)throw Error('PAYMENT_NOTIFICATION_TRANSACTION_REQUIRED');
  await assertOrderNotRecoveryHeld(db,orderId);
  const body=JSON.stringify(payload);
  if(Buffer.byteLength(body)>16384)throw Error('PAYMENT_NOTIFICATION_PAYLOAD_LIMIT');
  const key=`payment-approved-email:v1:order:${orderId}`;
  await db.execute(sql`INSERT INTO notificationOutbox(dedupeKey,type,orderId,payload)
    VALUES(${key},${TYPE},${orderId},${body}) ON DUPLICATE KEY UPDATE dedupeKey=dedupeKey`);
}
/** Claim and token protect ownership; the provider key protects ambiguous retries within its 24h window. */
export async function deliverPaymentNotifications(limit=10,onlyOrderId?:number,onlyType?:string){
  const recovery=captureRecoveryFence();

  if(onlyType&&!TYPES.includes(onlyType))throw Error('PAYMENT_NOTIFICATION_TYPE_INVALID');
  if(isStagingMaintenanceEnabled())return {sent:0,blocked:true};
  const db=await getDb();if(!db)throw Error('PAYMENT_NOTIFICATION_DB_UNAVAILABLE');
  let sent=0;
  for(let i=0;i<Math.min(25,Math.max(1,limit));i++){
    const token=randomUUID();
    let claim:any;
    try{
      claim=await db.transaction(async tx=>{
        const [records]=await tx.execute(sql`SELECT *,TIMESTAMPDIFF(SECOND,lockedAt,NOW()) firstAttemptAge
          FROM notificationOutbox WHERE type IN (${TYPES[0]},${TYPES[1]},${TYPES[2]})
          AND (${onlyType??null} IS NULL OR type=${onlyType??null})
          AND (${onlyOrderId??null} IS NULL OR orderId=${onlyOrderId??null})
          AND (${!recovery.reviewOnly} OR (EXISTS(SELECT 1 FROM auditLogs a WHERE a.action=${GRANT} AND a.entity='order' AND a.entityId=CAST(notificationOutbox.orderId AS CHAR)) AND EXISTS(SELECT 1 FROM auditLogs c WHERE c.action=${CANDIDATE} AND c.entity='order' AND c.entityId=CAST(notificationOutbox.orderId AS CHAR))))
          AND ((status IN ('pending','failed') AND nextAttemptAt<=NOW()) OR
            (status='processing' AND leaseExpiresAt<NOW()))
          ORDER BY id LIMIT 1 FOR UPDATE SKIP LOCKED`);
        const row=(records as unknown as any[])[0];if(!row)return null;
        if(recovery.reviewOnly)await assertSelectedNotification(tx,row.orderId);
        else await assertOrderNotRecoveryHeld(tx,row.orderId);
        if(row.attempts>=5||(row.attempts>0&&(!row.lockedAt||Number(row.firstAttemptAge)>=23*3600))){
          await tx.execute(sql`UPDATE notificationOutbox SET status='dead',lastError='REVIEW_REQUIRED_IDEMPOTENCY_WINDOW_OR_ATTEMPTS',lockedBy=NULL,leaseExpiresAt=NULL WHERE id=${row.id}`);
          return {dead:true};
        }
        let payload:any;
        try{payload=JSON.parse(row.payload);}catch{payload=null;}
        if(!payload||String(payload.orderNumber)!==String(row.orderId)){
          await tx.execute(sql`UPDATE notificationOutbox SET status='dead',lastError='PAYMENT_NOTIFICATION_PAYLOAD_INVALID',lockedBy=NULL,leaseExpiresAt=NULL WHERE id=${row.id}`);
          return {dead:true};
        }
        if(row.type==='payment-pending-email-v1'){
          const [orders]=await tx.execute(sql`SELECT paymentStatus FROM orders WHERE id=${row.orderId}`);
          if((orders as unknown as any[])[0]?.paymentStatus==='confirmed'){
            await tx.execute(sql`UPDATE notificationOutbox SET status='dead',lastError='SUPPRESSED_AFTER_PAYMENT_CONFIRMATION' WHERE id=${row.id}`);
            return {dead:true};
          }
        }
        // Resolve and freeze the destination only after the financial commit; retry payload stays identical.
        if(!payload.customerEmail){
          const [recipients]=await tx.execute(sql`SELECT u.email,u.name FROM users u JOIN orders o ON o.userId=u.id WHERE o.id=${row.orderId}`);
          const recipient=(recipients as unknown as any[])[0];
          if(!recipient?.email){
            await tx.execute(sql`UPDATE notificationOutbox SET status='dead',lastError='PAYMENT_NOTIFICATION_RECIPIENT_UNAVAILABLE' WHERE id=${row.id}`);
            return {dead:true};
          }
          payload.customerEmail=recipient.email;payload.customerName=recipient.name||'Cliente';
        }
        // Policy denial does not consume an attempt or reclaim an existing lease.
        if(recovery.reviewOnly){
          await assertSelectedNotification(tx,row.orderId,payload.customerEmail);
          withRecoveryRecipient(payload.customerEmail,()=>assertEmailRecipientsAllowed({to:payload.customerEmail}));
        }else assertEmailRecipientsAllowed({to:payload.customerEmail});
        await tx.execute(sql`UPDATE notificationOutbox SET status='processing',attempts=attempts+1,
          lockedBy=${token},payload=${JSON.stringify(payload)},lockedAt=COALESCE(lockedAt,NOW()),leaseExpiresAt=DATE_ADD(NOW(),INTERVAL 60 SECOND)
          WHERE id=${row.id}`);
        assertRecoveryFence(recovery);
        return {...row,payload};
      });
    }catch{console.warn('[PaymentNotification] claim_or_policy_blocked');return {sent,blocked:true};}
    if(!claim)break;if(claim.dead)continue;
    const idempotencyKey=claim.type+'/'+createHash('sha256').update(claim.dedupeKey).digest('hex');
    try{
      let timer:ReturnType<typeof setTimeout>|undefined;
      let response:unknown;
      const payload={...claim.payload,idempotencyKey};
      assertRecoveryFence(recovery);
      if(recovery.reviewOnly)await db.transaction(tx=>assertSelectedNotification(tx,claim.orderId,claim.payload.customerEmail));
      else assertWebhookBusinessEffectsAllowed();
      const send=()=>claim.type===TYPE ? sendPaymentApprovedEmail(payload)
        : claim.type==='order-created-email-v1' ? sendOrderCreatedEmail(payload) : sendPaymentPendingEmail(payload);
      try{response=await Promise.race([recovery.reviewOnly?withRecoveryRecipient(payload.customerEmail,send):send(),
        new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('PAYMENT_NOTIFICATION_PROVIDER_TIMEOUT')),15000);})]);}
      finally{clearTimeout(timer);}
      const providerId=(response as {id?:unknown})?.id;
      if(typeof providerId!=='string'||!providerId)throw Error('PAYMENT_NOTIFICATION_ACCEPTANCE_UNPROVEN');
      const [updated]=await db.execute(sql`UPDATE notificationOutbox SET status='sent',sentAt=NOW(),lastError=NULL,payload=${JSON.stringify({...claim.payload,providerMessageId:providerId})},
        lockedBy=NULL,leaseExpiresAt=NULL WHERE id=${claim.id} AND status='processing' AND lockedBy=${token}`);
      if((updated as any).affectedRows===1)sent++;
      else console.warn('[PaymentNotification] lease_lost_after_provider_acceptance');
    }catch{
      // Retain first-attempt timestamp; never retry an uncertain send past the provider's window.
      await db.execute(sql`UPDATE notificationOutbox SET status='failed',lastError='PAYMENT_NOTIFICATION_DELIVERY_UNCONFIRMED',
        nextAttemptAt=DATE_ADD(NOW(),INTERVAL 60 SECOND),lockedBy=NULL,leaseExpiresAt=NULL
        WHERE id=${claim.id} AND status='processing' AND lockedBy=${token}`);
    }
  }
  return {sent,blocked:recovery.reviewOnly&&sent===0,...(recovery.reviewOnly?{recovery:true}:{})};
}
export function startPaymentNotificationRecovery(){
  let running=false;
  const tick=async()=>{if(running)return;running=true;try{await deliverPaymentNotifications();}
    catch{console.error('[PaymentNotification] recovery_failed');}finally{running=false;}};
  const timer=setInterval(()=>void tick(),30000);timer.unref();void tick();return()=>clearInterval(timer);
}
