import {assertOrderNotRecoveryHeld,assertWebhookBusinessEffectsAllowed} from './webhookRecovery';
import {assertSelectedLedgerBinding, selectedBoletoReview, BOLETO_REVIEW, insertAdmissionAudit, eventKey, auditRecord} from './stagingCheckoutAdmission';
import {sql} from 'drizzle-orm';
import {webhookDb} from '../database/webhookTransaction';
import {parseAsaasOrderReference} from '../../shared/asaasWebhookSemantics';
/** Bind observations without treating a provider change as a financial update.
 * Missing historical payment rows remain reviewable; existing rows must match.
 */
export async function validatePaymentObservationBinding(orderId:number,paymentId:string|null){
 const db=webhookDb();if(!db)throw Error('PAYMENT_RECORD_TRANSACTION_REQUIRED');
 await db.execute(sql`SELECT id FROM orders WHERE id=${orderId} FOR UPDATE`);
 const [result]=await db.execute(sql`SELECT providerPaymentId,externalReference FROM payments WHERE orderId=${orderId} FOR UPDATE`);
 const records=result as unknown as Array<{providerPaymentId:string|null,externalReference:string}>;
 if(records.length>1||records.some(row=>parseAsaasOrderReference(row.externalReference)!==orderId||!row.providerPaymentId||row.providerPaymentId!==paymentId))throw Error('PAYMENT_RECORD_BINDING_MISMATCH');
}
/** Extra binding for normal checkout records. Never creates/reconciles missing historical payments. */
export async function validatePaymentBinding(orderId:number,paymentId:string|null,amount:number){
 const db=webhookDb();if(!db)throw Error('PAYMENT_RECORD_TRANSACTION_REQUIRED');
 await db.execute(sql`SELECT id FROM orders WHERE id=${orderId} FOR UPDATE`);
 const [result]=await db.execute(sql`SELECT providerPaymentId,amount,externalReference FROM payments WHERE orderId=${orderId} FOR UPDATE`);
 const row=(result as unknown as any[])[0];
 if(row&&(Number(row.amount)!==amount||row.externalReference!==String(orderId)||(row.providerPaymentId&&row.providerPaymentId!==paymentId)))throw Error('PAYMENT_RECORD_BINDING_MISMATCH');
}
export async function recordTrustedPaymentReceipt(orderId:number,paymentId:string|null,received:boolean){
 assertWebhookBusinessEffectsAllowed();
 const db=webhookDb();if(!db)throw Error('PAYMENT_RECORD_TRANSACTION_REQUIRED');
 await assertOrderNotRecoveryHeld(db,orderId);
 // Exception/refund/cancelled/manual/reconciled records require their existing supervised path.
 // Provider receipt time is not present in the minimal envelope: never invent receivedAt from processing time.
 // RECEIVED can follow CONFIRMED; CONFIRMED can never downgrade an already received record.
 await db.execute(sql`UPDATE payments SET status=IF(status='received' OR ${received},'received','confirmed'),
   paidAmount=amount,confirmedAt=COALESCE(confirmedAt,NOW())
   WHERE orderId=${orderId} AND providerPaymentId=${paymentId} AND creationStatus='created'
   AND status IN ('pending','confirmed','received') AND statusSource='provider' AND financialIssue IS NULL`);
}

/** Only a provider-verified, explicitly granted BOLETO event in the inbox transaction. */
export async function recordSelectedBoletoReview(orderId:number,paymentId:string|null,received:boolean,eventId:string){
 if(!selectedBoletoReview(orderId))throw Error('SELECTIVE_BOLETO_REVIEW_REQUIRED');
 assertSelectedLedgerBinding({orderId,paymentId,eventId});
 const db=webhookDb();if(!db)throw Error('PAYMENT_RECORD_TRANSACTION_REQUIRED');
 await validatePaymentBinding(orderId,paymentId,Number((await db.execute(sql`SELECT totalPrice FROM orders WHERE id=${orderId} FOR UPDATE`) as any)[0][0].totalPrice));
 const [changed]=await db.execute(sql`UPDATE payments SET status=IF(status='received' OR ${received},'received','confirmed'),
 paidAmount=amount,confirmedAt=COALESCE(confirmedAt,NOW()),financialIssue=${BOLETO_REVIEW},financialIssueAt=COALESCE(financialIssueAt,NOW())
 WHERE orderId=${orderId} AND providerPaymentId=${paymentId} AND billingType='BOLETO' AND creationStatus='created'
 AND statusSource='provider' AND status IN ('pending','confirmed','received')
 AND (financialIssue IS NULL OR financialIssue=${BOLETO_REVIEW})`) as any;
 if(changed.affectedRows!==1)throw Error('SELECTIVE_BOLETO_REVIEW_BINDING_REQUIRED');
 if(!await auditRecord(db,'staging.checkout_payment_review.v1','asaasWebhookInbox',eventKey(eventId)))
  await insertAdmissionAudit(db,'staging.checkout_payment_review.v1','asaasWebhookInbox',eventKey(eventId),
   {eventId,orderId,paymentId,reason:BOLETO_REVIEW,receiptRecorded:true,stockMutation:false,fulfillmentMutation:false,notificationMutation:false});
}
