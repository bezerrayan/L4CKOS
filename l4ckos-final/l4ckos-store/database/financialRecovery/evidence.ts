import type { Connection, RowDataPacket } from 'mysql2/promise';
import { TARGET, digest, stop, type Snapshot, type FinancialReceipt } from './policy';

export const TABLES = ['orders','orderItems','payments','paymentEvents','stockReservations','auditLogs',
  'notificationOutbox','orderEmailEvents','asaasWebhookEvents','asaasWebhookInbox','products','productVariants','productionBatches','users'] as const;
type Row = Record<string, any>;
export async function query(c: Connection, sql: string, values: unknown[] = []): Promise<Row[]> {
  return (await c.query<RowDataPacket[]>(sql, values))[0];
}
const stable = (rows: Row[]) => rows.map(r => JSON.stringify(r)).sort();
const find = (tables: Record<string, Row[]>, table: string, key: string, value: unknown) => tables[table].filter(r=>r[key]===value);
const omit = (r: Row, keys: string[]) => Object.fromEntries(Object.entries(r).filter(([k])=>!keys.includes(k)));
function historical(table: string, row: Row) {
  if (table === 'orders') return row.id !== 13;
  if (table === 'payments') return row.orderId !== 13;
  if (table === 'stockReservations') return row.id !== 10;
  if (table === 'products') return row.id !== 1;
  if (table === 'notificationOutbox') return row.dedupeKey !== TARGET.outboxKey;
  if (table === 'asaasWebhookInbox' || table === 'asaasWebhookEvents') return row.eventId !== TARGET.eventId;
  if (table === 'auditLogs') return !(row.orderId===13 && ['order.payment_recovery_completed',
    'order.payment_recovery_held','webhook.created_recovery_completed'].includes(row.action));
  return true;
}
export async function captureSnapshot(c: Connection): Promise<Snapshot> {
  const tables: Record<string, Row[]> = {};
  // SELECT-only; raw rows (including PII) never leave this function or the process.
  for (const table of TABLES) tables[table] = await query(c,'SELECT * FROM `'+table+'`');
  const order = find(tables,'orders','id',13), reservation = find(tables,'stockReservations','id',10);
  const product = find(tables,'products','id',1), payment = find(tables,'payments','orderId',13);
  if (order.length!==1 || reservation.length!==1 || product.length!==1) stop('RECOVERY_TARGET_MISSING');
  const completion = tables.auditLogs.filter(r=>r.orderId===13 && r.action==='order.payment_recovery_completed');
  const notifications = tables.notificationOutbox.filter(r=>r.orderId===13);
  const financial = {order, reservation, product, payment, completion, notifications};
  const created = {inbox:find(tables,'asaasWebhookInbox','eventId',TARGET.eventId),
    ledger:find(tables,'asaasWebhookEvents','eventId',TARGET.eventId),
    audit:tables.auditLogs.filter(r=>r.action==='webhook.created_recovery_completed' && r.correlationId===TARGET.eventId)};
  const immutable = {order:order.map(r=>omit(r,['status','paymentStatus','paymentConfirmationSource','paymentConfirmedBy',
    'paymentConfirmedAt','paymentConfirmationReference','fulfillmentStatus','fulfillmentIssue','updatedAt'])),
    reservation:reservation.map(r=>omit(r,['status','updatedAt'])), product:product.map(r=>omit(r,['stock','updatedAt'])),
    inbox:created.inbox.map(r=>omit(r,['state','attempts','errorCode','nextAttemptAt','completedAt','updatedAt']))};
  return {capturedAt:new Date().toISOString(), targetHash:digest({financial,created}),
    immutableTargetHash:digest(immutable), historicalHash:digest(Object.fromEntries(TABLES.map(t=>[t,stable(tables[t].filter(r=>historical(t,r)))]))),
    tableHashes:Object.fromEntries(TABLES.map(t=>[t,digest(stable(tables[t]))])), financialHash:digest(financial),createdHash:digest(created),
    stock:Number(product[0].stock),originalExpiresAt:String(reservation[0].expiresAt)};
}
export function assertSameSnapshot(actual: Snapshot, expected: Snapshot) {
  if (digest({...actual,capturedAt:''}) !== digest({...expected,capturedAt:''})) stop('RECOVERY_CHECKPOINT_DRIFT');
}
function same(value: unknown, expected: unknown, code='RECOVERY_VERIFICATION_FAILED') {
  if (value!==expected) stop(code);
}
function sqlTime(value: unknown) { return String(value).replace(' ','T').replace(/\.\d+$/,'')+'Z'; }
export async function verifyFinancial(c: Connection, baseline: Snapshot, approvalReference: string, artifactHash: string) {
  const [o] = await query(c,'SELECT * FROM orders WHERE id=13');
  const payments = await query(c,'SELECT * FROM payments WHERE orderId=13 OR providerPaymentId=?',[TARGET.paymentId]);
  const reservations = await query(c,'SELECT * FROM stockReservations WHERE orderId=13');
  const audits = await query(c,"SELECT * FROM auditLogs WHERE action='order.payment_recovery_completed' AND entity='order' AND entityId='13'");
  const outbox = await query(c,'SELECT * FROM notificationOutbox WHERE orderId=13');
  if (!o || payments.length!==1 || reservations.length!==1 || audits.length!==1 || outbox.length!==1) stop('RECOVERY_FINANCIAL_COMMIT_UNPROVEN');
  const p=payments[0],r=reservations[0],a=audits[0],n=outbox[0];
  for (const [key,value] of Object.entries({status:'paid',paymentStatus:'confirmed',userId:594,totalPrice:9900,
    paymentConfirmationSource:'manual',paymentConfirmedBy:14,paymentConfirmationReference:null,fulfillmentStatus:'ready',fulfillmentIssue:null})) same(o[key],value);
  for (const [key,value] of Object.entries({orderId:13,provider:'asaas',providerPaymentId:TARGET.paymentId,billingType:'PIX',amount:9900,
    status:'received',creationStatus:'created',externalReference:'13',paidAmount:9900,refundedAmount:0,statusSource:'reconciliation',
    manualConfirmedBy:14,receivedAt:null,confirmedAt:null,refundedAt:null,financialIssue:null})) same(p[key],value);
  for (const [key,value] of Object.entries({id:10,orderId:13,orderItemId:14,productId:1,variantId:null,quantity:1,status:'consumed'})) same(r[key],value);
  same(String(r.expiresAt),baseline.originalExpiresAt);
  same(a.actorUserId,14);same(a.actorType,'admin');same(a.orderId,13);same(a.correlationId,'RC2_ORDER13_'+approvalReference);
  const metadata=JSON.parse(a.metadata),before=JSON.parse(a.beforeState),after=JSON.parse(a.afterState);
  same(metadata.path,'B');same(metadata.approvalReference,approvalReference);same(metadata.localRehearsal,false);
  same(metadata.supervisedStaging,true);same(metadata.artifactHash,artifactHash);same(metadata.notificationDispatch,false);
  same(metadata.evidence.paymentId,TARGET.paymentId);same(metadata.evidence.amountCents,9900);same(metadata.evidence.status,'RECEIVED');
  for(const [key,value] of Object.entries({externalReference:'13',billingType:'PIX',deleted:false,refundCount:0,refundsHasMore:false,chargebackPresent:false,timestampEvidenceReference:null})) same(metadata.evidence[key],value);
  if(!/^[a-f0-9]{64}$/.test(metadata.approvalHash)) stop('RECOVERY_AUDIT_APPROVAL_HASH_INVALID');
  same(metadata.evidence.financialReceivedAt,null);same(metadata.evidence.timestampMeaning,'not_proven');
  same(metadata.evidenceHash,digest(metadata.evidence));same(p.manualEvidence,metadata.evidenceHash);same(p.netAmount,metadata.evidence.netAmountCents);
  same(p.manualReason,metadata.justification);same(o.paymentConfirmedAt,p.manualConfirmedAt);
  if(Math.abs(Date.parse(sqlTime(o.paymentConfirmedAt))-Date.parse(after.operatorAppliedAt))>=1000) stop('RECOVERY_OPERATOR_TIME_MISMATCH');
  same(before.stock,baseline.stock);same(Date.parse(before.originalExpiresAt),Date.parse(sqlTime(baseline.originalExpiresAt)));same(after.stock,baseline.stock-1);
  same(n.dedupeKey,TARGET.outboxKey);same(n.type,'payment-approved');same(n.status,'pending');same(n.attempts,0);
  for (const key of ['sentAt','lockedAt','lockedBy','leaseExpiresAt','lastError']) same(n[key],null);
  const payload=JSON.parse(n.payload);same(payload.orderId,13);same(payload.recoveryOperation,a.correlationId);same(payload.approvedRecipientRequired,true);
  const current=await captureSnapshot(c);
  same(current.stock,baseline.stock-1);same(current.historicalHash,baseline.historicalHash,'RECOVERY_HISTORICAL_DRIFT');
  same(current.immutableTargetHash,baseline.immutableTargetHash,'RECOVERY_IMMUTABLE_DRIFT');
  return current;
}
export async function verifyCreated(c: Connection, before: Snapshot, receipt: FinancialReceipt, artifactHash: string) {
  const current=await verifyFinancial(c,receipt.baseline,receipt.financialApprovalReference,artifactHash);
  same(current.financialHash,receipt.financialHash,'RECOVERY_FINANCIAL_DRIFT');
  const inbox=await query(c,'SELECT * FROM asaasWebhookInbox WHERE eventId=?',[TARGET.eventId]);
  const ledger=await query(c,'SELECT * FROM asaasWebhookEvents WHERE eventId=?',[TARGET.eventId]);
  const audits=await query(c,"SELECT * FROM auditLogs WHERE action='webhook.created_recovery_completed' AND correlationId=?",[TARGET.eventId]);
  if(inbox.length!==1 || ledger.length!==1 || audits.length!==1) stop('RECOVERY_CREATED_COMMIT_UNPROVEN');
  const i=inbox[0],l=ledger[0],a=audits[0];
  same(i.state,'processed');same(i.attempts,2);same(i.errorCode,null);same(i.nextAttemptAt,null);
  same(i.payloadHash,TARGET.payloadHash);
  const envelope=JSON.parse(i.payload);same(envelope.sourcePayloadHash,TARGET.sourcePayloadHash);
  delete envelope.sourcePayloadHash;same(digest(envelope),TARGET.payloadHash);
  for(const [key,value] of Object.entries({eventId:TARGET.eventId,eventType:'PAYMENT_CREATED',paymentId:TARGET.paymentId,
    orderId:13,payloadHash:TARGET.sourcePayloadHash,status:'processed',checkoutId:null})) same(l[key],value);
  same(a.actorUserId,14);same(a.actorType,'admin');same(a.orderId,13);
  const m=JSON.parse(a.metadata),b=JSON.parse(a.beforeState);
  same(m.localRehearsal,false);same(m.supervisedStaging,true);same(m.artifactHash,artifactHash);same(m.payloadHash,TARGET.payloadHash);same(m.paymentId,TARGET.paymentId);
  if(!/^[a-f0-9]{64}$/.test(m.approvalHash) || !/^[A-Za-z0-9_-]{8,80}$/.test(m.approvalReference)) stop('RECOVERY_AUDIT_APPROVAL_HASH_INVALID');
  const after=JSON.parse(a.afterState);same(after.state,'processed');same(after.attempts,2);
  if(i.completedAt===null || l.processedAt===null) stop('RECOVERY_CREATED_COMMIT_UNPROVEN');
  same(m.financialMutation,false);same(m.reservationMutation,false);same(m.notificationDispatch,false);
  same(b.state,'rejected');same(b.attempts,1);same(b.errorCode,'WEBHOOK_VALIDATION_REJECTED');same(b.payloadHash,TARGET.payloadHash);
  same(current.historicalHash,before.historicalHash,'RECOVERY_HISTORICAL_DRIFT');
  same(current.immutableTargetHash,before.immutableTargetHash,'RECOVERY_IMMUTABLE_DRIFT');
  return current;
}
export async function assertNoReversalObservations(c: Connection) {
  const reversals=new Set(['PAYMENT_REFUNDED','PAYMENT_PARTIALLY_REFUNDED','PAYMENT_REFUND_IN_PROGRESS',
    'PAYMENT_REFUND_DENIED','PAYMENT_DELETED','PAYMENT_CHARGEBACK_REQUESTED','PAYMENT_CHARGEBACK_DISPUTE',
    'PAYMENT_AWAITING_CHARGEBACK_REVERSAL']);
  const observations=[...await query(c,'SELECT eventType FROM paymentEvents WHERE orderId=13 OR providerPaymentId=?',[TARGET.paymentId]),
    ...await query(c,'SELECT eventType FROM asaasWebhookEvents WHERE orderId=13 OR paymentId=?',[TARGET.paymentId])];
  if(observations.some(r=>reversals.has(r.eventType))) stop('RECOVERY_REVERSAL_OBSERVATION_REQUIRES_REVIEW');
  for(const row of await query(c,'SELECT payload FROM asaasWebhookInbox')) {
    let e:Row;try{e=JSON.parse(row.payload??'null');}catch{continue;}
    if(e && reversals.has(e.event) && (e.payment?.id===TARGET.paymentId || String(e.payment?.externalReference??e.externalReference)==='13'))
      stop('RECOVERY_REVERSAL_OBSERVATION_REQUIRES_REVIEW');
  }
}
export async function inspectPending(c: Connection) {
  await assertNoReversalObservations(c);
  const [o]=await query(c,'SELECT id,userId,totalPrice,status,paymentStatus,fulfillmentStatus,fulfillmentIssue FROM orders WHERE id=13');
  const [r]=await query(c,'SELECT * FROM stockReservations WHERE id=10');
  const items=await query(c,'SELECT id,productId,variantId,quantity,salesModeAtPurchase,totalPrice FROM orderItems WHERE orderId=13');
  const [p]=await query(c,'SELECT stock FROM products WHERE id=1');
  const [admin]=await query(c,'SELECT role FROM users WHERE id=14');
  if (!o || !r || !p || admin?.role!=='admin' || items.length!==1) stop('RECOVERY_PREFLIGHT_PRECONDITION_CHANGED');
  for(const [key,value] of Object.entries({userId:594,totalPrice:9900,status:'pending',paymentStatus:'unconfirmed',fulfillmentStatus:'awaiting_payment',fulfillmentIssue:null})) same(o[key],value);
  for(const [key,value] of Object.entries({id:10,orderId:13,orderItemId:14,productId:1,variantId:null,quantity:1,status:'active'})) same(r[key],value);
  for(const [key,value] of Object.entries({id:14,productId:1,variantId:null,quantity:1,salesModeAtPurchase:'STOCK',totalPrice:9900})) same(items[0][key],value);
  const [clock]=await query(c,'SELECT UTC_TIMESTAMP() clock');
  if (String(r.expiresAt)>=String(clock.clock)) stop('RECOVERY_EXPIRED_RESERVATION_REQUIRED');
  const [commitments]=await query(c,"SELECT COALESCE(SUM(quantity),0) quantity FROM stockReservations WHERE productId=1 AND id<>10 AND status='active' AND expiresAt>=UTC_TIMESTAMP()");
  const available=Number(p.stock)-Number(commitments.quantity);
  if(available<1) stop('RECOVERY_STOCK_UNAVAILABLE');
  const payments=await query(c,'SELECT id FROM payments WHERE orderId=13 OR providerPaymentId=?',[TARGET.paymentId]);
  const completed=await query(c,"SELECT id FROM auditLogs WHERE entity='order' AND entityId='13' AND action IN('order.payment_recovery_completed','order.payment_recovery_held')");
  if(payments.length || completed.length || (await query(c,'SELECT id FROM notificationOutbox WHERE orderId=13')).length) stop('RECOVERY_FINANCIAL_PRECONDITION_CHANGED');
  const [a]=await query(c,"SELECT metadata FROM auditLogs WHERE id=72 AND action='checkout.charge_created' AND entity='order' AND entityId='13'");
  const audit=a?JSON.parse(a.metadata):null;
  if(audit?.payment?.paymentId!==TARGET.paymentId || audit?.payment?.method!=='PIX') stop('RECOVERY_CHECKOUT_PAYMENT_MISMATCH');
  await inspectRejected(c);
  return {stock:Number(p.stock),reservedElsewhere:Number(commitments.quantity),available};
}
export async function inspectRejected(c: Connection, allowProcessed=false) {
  const [i]=await query(c,'SELECT * FROM asaasWebhookInbox WHERE eventId=?',[TARGET.eventId]);
  if(!i || i.payloadHash!==TARGET.payloadHash) stop('RECOVERY_CREATED_IDENTITY_MISMATCH');
  const e=JSON.parse(i.payload),raw={...e};delete raw.sourcePayloadHash;
  if(digest(raw)!==TARGET.payloadHash || e.sourcePayloadHash!==TARGET.sourcePayloadHash || e.id!==TARGET.eventId ||
    e.event!=='PAYMENT_CREATED' || e.payment?.id!==TARGET.paymentId || e.payment?.externalReference!=='13' ||
    e.payment?.status!=='PENDING' || e.payment?.value!==99) stop('RECOVERY_CREATED_PAYLOAD_MISMATCH');
  if(allowProcessed && i.state==='processed') return;
  if(i.state!=='rejected' || i.attempts!==1 || i.errorCode!=='WEBHOOK_VALIDATION_REJECTED' || i.nextAttemptAt!==null)
    stop('RECOVERY_CREATED_PRECONDITION_CHANGED');
  if ((await query(c,'SELECT id FROM asaasWebhookEvents WHERE eventId=?',[TARGET.eventId])).length ||
      (await query(c,"SELECT id FROM auditLogs WHERE action='webhook.created_recovery_completed' AND correlationId=?",[TARGET.eventId])).length)
    stop('RECOVERY_CREATED_LEDGER_CONFLICT');
}
