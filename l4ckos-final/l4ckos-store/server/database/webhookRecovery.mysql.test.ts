import {
  beforeAll,
  beforeEach,
  afterAll,
  describe,
  it,
  expect,
  vi,
} from "vitest";
import { randomUUID, createHash } from "node:crypto";
import { createPool, type Pool, type Connection } from "mysql2/promise";
import type * as mysqlOrm from "drizzle-orm/mysql2";
import { openBackupConnection } from "./backupRestore";
import { bootstrapReleaseDatabase } from "../../database/bootstrap/bootstrap";
import { readReleaseContract } from "../../database/schema/artifacts";
import { canonical } from "../../database/schema/fingerprint";
import {
  asaasWebhookHandler,
  processWebhookEnvelope,
} from "../controllers/paymentController";
import { financialEnvelope, receiveWebhook, persistWebhook, processStoredWebhook, recoverWebhooks, startWebhookRecovery } from "../payments/webhookInbox";

import {markOrderPaid,runAsaasWebhookOnce,updateOrderAndReserveDeliveredEmailEvents} from '../db';
import {deliverPaymentNotifications,enqueuePaymentApproved} from '../payments/paymentNotificationOutbox';
import {dispatchOrderEmailEvent} from '../services/orderEmailDelivery';
import {inWebhookTransaction} from '../database/webhookTransaction';
import {recordTrustedPaymentReceipt} from '../payments/paymentRecord';
import {RECOVERY_HOLD_ACTION} from '../payments/webhookRecovery';
import {assertEmailRecipientsAllowed} from '../services/email/recipientPolicy.js';
const injected = vi.hoisted(() => ({
  orm: null as unknown,
  mail: vi.fn(async () => ({ id: "synthetic-mail" })),
  provider: vi.fn(),
}));
vi.mock("drizzle-orm/mysql2", async original => ({
  ...(await original<typeof mysqlOrm>()),
  drizzle: () => injected.orm,
}));
vi.mock("../services/emailService.js", () => ({
  sendPaymentApprovedEmail: injected.mail,
  sendOrderDeliveredEmail: injected.mail,sendReviewRequestEmail: injected.mail,
  sendOrderCreatedEmail: injected.mail,
  sendPaymentPendingEmail: injected.mail,
  sendInternalNewSaleAlertEmail: injected.mail,
  sendInternalLowStockAlertEmail: injected.mail,
  sendPaymentFailedEmail: injected.mail,
  sendInternalPaymentFailedAlertEmail: injected.mail,
}));
vi.mock("../services/asaasService", () => ({
  validateAsaasWebhookSignature: (h: Record<string, unknown>) =>
    h["asaas-access-token"] === "synthetic-token",
  getAsaasPayment: injected.provider,
  createAsaasCheckout: vi.fn(() => {
    throw Error("NO_EXTERNAL_CHARGE");
  }),
  createAsaasCustomer: vi.fn(() => {
    throw Error("NO_EXTERNAL_CUSTOMER");
  }),
}));
function setReview(){
  vi.stubEnv('NODE_ENV','production');vi.stubEnv('RAILWAY_PROJECT_ID','2bb90c8e-eb65-43ee-826b-f93750f0499c');
  vi.stubEnv('RAILWAY_ENVIRONMENT_ID','15545eee-bc02-4b70-afc4-19a5db9e6f46');vi.stubEnv('RAILWAY_SERVICE_ID','9f1c7705-f2f9-48cf-b957-8f63a6bba4db');
  vi.stubEnv('ASAAS_WEBHOOK_RECOVERY_MODE','review_only');
}
async function preserved(before:unknown){
 expect(await financialSnapshot()).toEqual(before);
 expect(await query('SELECT * FROM asaasWebhookEvents')).toHaveLength(0);
 expect(await query('SELECT * FROM paymentEvents')).toHaveLength(0);
 expect(injected.mail).not.toHaveBeenCalled();expect(injected.provider).not.toHaveBeenCalled();
}
const socket = process.env.L4CKOS_LOCAL_MYSQL_SOCKET ?? "";
const database =
  "l4ckos_test_recovery_hold_" +
  randomUUID().replaceAll("-", "").slice(0, 10);
const PAYMENT1 = "pay_9c8ztqdst866k0ll",
  PAYMENT13 = "pay_dog6ppexq4gyw3k6";
const DELETED_ID = "evt_d545b50fbb17a226c5f4f4fd193922b7&21454361";
const CREATED_ID = "evt_05b708f961d739ea7eba7e4db318f621&21683762";
let root: Connection, c: Connection, pool: Pool;
const query = async (sql: string, params: unknown[] = []) =>
  (await c.query<any[]>(sql, params))[0];
const envelope = (event: string, id = randomUUID(), orderId = 13) => ({
  id,
  event,
  payment: {
    id: orderId === 1 ? PAYMENT1 : orderId === 14 ? "pay_synthetic_14" : PAYMENT13,
    externalReference: orderId === 1 ? "L4CKOS-ORDER-1" : String(orderId),
    status: event === "PAYMENT_CREATED" ? "PENDING" : "RECEIVED",
    value: 99,
    billingType: "PIX",
  },
});
const deleted = () => ({
  ...envelope("PAYMENT_DELETED", DELETED_ID, 1),
  payment: {
    ...envelope("PAYMENT_DELETED", DELETED_ID, 1).payment,
    status: "OVERDUE",
    deleted: true,
    description: "Pedido #1",
  },
});
async function send(body: unknown, token: unknown = "synthetic-token") {
  let status = 0,
    data: any;
  await asaasWebhookHandler(
    {
      body,
      headers: { "asaas-access-token": token },
      ip: "isolated-local",
    } as any,
    {
      status(code: number) {
        status = code;
        return this;
      },
      json(value: unknown) {
        data = value;
        return this;
      },
    } as any
  );
  return { status, data };
}
async function financialSnapshot() {
  const state: Record<string, unknown> = {};
  for (const table of [
    "orders",
    "payments",
    "products",
    "stockReservations",
    "orderItems",
    "notificationOutbox",
    "orderEmailEvents",
  ])
    state[table] = await query("SELECT * FROM `" + table + "` ORDER BY id");
  return state;
}
async function seedRejected(body: unknown) {
  const p = financialEnvelope(body),
    content: any = { ...p };
  delete content.sourcePayloadHash;
  await query(
    "INSERT INTO asaasWebhookInbox(eventId,payload,payloadHash,state,attempts,errorCode,completedAt) VALUES(?,?,?,'rejected',1,'WEBHOOK_VALIDATION_REJECTED',NOW())",
    [
      p.id,
      JSON.stringify(p),
      createHash("sha256").update(canonical(content)).digest("hex"),
    ]
  );
}
describe.skipIf(process.env.L4CKOS_MYSQL_TEST !== "1")(
  "review-only recovery gate on isolated local MySQL",
  () => {
    beforeAll(async () => {
      if (!/^\/tmp\/l4ckos-[a-z0-9-]+\/mysqld\.sock$/.test(socket))
        throw Error("LOCAL_SOCKET_REQUIRED");
      vi.stubEnv("L4CKOS_LOCAL_SCHEMA", "1");
      vi.stubEnv("L4CKOS_LOCAL_RESTORE", "1");
      root = await openBackupConnection("mysql://root@localhost/mysql", socket);
      const [identity] = await root.query<any[]>(
        "SELECT SHA2(@@server_uuid,256) h"
      );
      if (
        identity[0].h ===
        "92e96ae744d2112c5b4a430abc9a75d557a43d293652dd68369aa81786479f09"
      )
        throw Error("REMOTE_DB_FORBIDDEN");
      await root.query("CREATE DATABASE `" + database + "`");
      c = await openBackupConnection(
        "mysql://root@localhost/" + database,
        socket
      );
      await bootstrapReleaseDatabase(c, {
        url: "mysql://root@localhost/" + database,
        socketPath: socket,
        applicationCommit: "a".repeat(40),
        approvedFingerprint: (await readReleaseContract()).fingerprint,
      });
      const actual =
        await vi.importActual<typeof mysqlOrm>("drizzle-orm/mysql2");
      pool = createPool({
        user: "root",
        socketPath: socket,
        database,
        connectionLimit: 8,
      });
      injected.orm = actual.drizzle(pool);
    }, 30000);
    beforeEach(async () => {
      vi.unstubAllEnvs();
      vi.stubEnv("DATABASE_URL", "synthetic-present");
      injected.mail.mockClear();
      injected.provider.mockReset();
      injected.provider.mockImplementation(async (id: string) => ({
        id,
        externalReference: id === PAYMENT1 ? "L4CKOS-ORDER-1" : "13",
        status: id === PAYMENT1 ? "OVERDUE" : "RECEIVED",
        deleted: id === PAYMENT1,
        value: 99,
      }));
      await query("DROP TRIGGER IF EXISTS reject_observation_audit");
      for (const table of [
        "notificationOutbox",
        "orderEmailEvents",
        "asaasWebhookInbox",
        "asaasWebhookEvents",
        "paymentEvents",
        "payments",
        "auditLogs",
        "stockReservations",
        "orderItems",
        "orders",
        "products",
        "users",
      ])
        await query("DELETE FROM `" + table + "`");
      await query(
        "INSERT INTO users(id,openId,name,email) VALUES(999901,'isolated-semantics','Synthetic','synthetic@example.invalid')"
      );
      await query(
        "INSERT INTO products(id,name,category,price,stock) VALUES(1,'Synthetic','fixture',9900,97)"
      );
      await query(
        "INSERT INTO orders(id,userId,totalPrice,status,paymentStatus,paymentConfirmationSource,paymentConfirmedAt,paymentConfirmedBy,fulfillmentStatus) VALUES(1,999901,9900,'cancelled','unconfirmed',NULL,NULL,NULL,'cancelled'),(13,999901,9900,'paid','confirmed','manual',NOW(),14,'ready')"
      );
      await query(
        "INSERT INTO payments(orderId,providerPaymentId,externalReference,billingType,amount,status,creationStatus,statusSource,paidAmount,netAmount) VALUES(1,?,'L4CKOS-ORDER-1','PIX',9900,'overdue','created','provider',0,0),(13,?,'13','PIX',9900,'received','created','reconciliation',9900,9801)",
        [PAYMENT1, PAYMENT13]
      );
      await query(
        "INSERT INTO orderItems(id,orderId,productId,productName,unitPrice,quantity,totalPrice) VALUES(1,1,1,'Synthetic',9900,1,9900),(14,13,1,'Synthetic',9900,1,9900)"
      );
      await query(
        "INSERT INTO stockReservations(id,orderId,userId,productId,orderItemId,quantity,status,expiresAt) VALUES(1,1,999901,1,1,1,'expired','2026-09-09 22:02:56'),(10,13,999901,1,14,1,'consumed','2026-10-11 16:09:10')"
      );
      await query(
        "INSERT INTO notificationOutbox(dedupeKey,type,orderId,payload) VALUES('held-order13','payment-approved',13,'{}')"
      );
      await query("INSERT INTO orders(id,userId,totalPrice,status,paymentStatus,fulfillmentStatus) VALUES(2,999901,9900,'paid','unconfirmed','ready'),(3,999901,9900,'paid','unconfirmed','ready'),(6,999901,9900,'delivered','confirmed','ready'),(14,999901,9900,'pending','unconfirmed','awaiting_payment')");
      await query("INSERT INTO payments(orderId,providerPaymentId,externalReference,billingType,amount,status,creationStatus,statusSource,paidAmount) VALUES(14,'pay_synthetic_14','14','PIX',9900,'pending','created','provider',0)");
      await query("INSERT INTO orderItems(id,orderId,productId,productName,unitPrice,quantity,totalPrice) VALUES(15,14,1,'Synthetic',9900,1,9900)");
      await query("INSERT INTO stockReservations(orderId,userId,productId,orderItemId,quantity,status,expiresAt) VALUES(14,999901,1,15,1,'active',DATE_ADD(NOW(),INTERVAL 20 MINUTE))");
      await query("INSERT INTO notificationOutbox(dedupeKey,type,orderId,payload) VALUES('legacy-2','payment-approved',2,'{}'),('legacy-3','payment-approved',3,'{}')");
      await query("INSERT INTO orderEmailEvents(id,orderId,eventType,status,idempotencyKey,attemptCount,processingAt,processingToken) VALUES(1,6,'order_delivered_email','processing','historical-1',1,NOW(),'held1'),(2,6,'review_request_email','processing','historical-2',1,NOW(),'held2')");
      setReview();
    });
    afterAll(async () => {
      vi.unstubAllEnvs();
      await pool?.end();
      await c?.end();
      if (root) {
        await root.query("DROP DATABASE `" + database + "`");
        await root.end();
      }
    });

    it.each(['PAYMENT_CREATED','PAYMENT_RECEIVED','PAYMENT_CONFIRMED','PAYMENT_UPDATED','PAYMENT_OVERDUE','PAYMENT_DELETED','PAYMENT_RESTORED','PAYMENT_REFUNDED','PAYMENT_PARTIALLY_REFUNDED','PAYMENT_REFUND_IN_PROGRESS','PAYMENT_REFUND_DENIED','PAYMENT_CHARGEBACK_REQUESTED','PAYMENT_CHARGEBACK_DISPUTE','PAYMENT_AWAITING_CHARGEBACK_REVERSAL','PAYMENT_RECEIVED_IN_CASH_UNDONE','PAYMENT_FUTURE_UNKNOWN'])('%s is durably held without invoking business/provider/mail',async type=>{
      const before=await financialSnapshot(),body=envelope(type,randomUUID(),14);
      const first=await send(body);expect(first.status).toBe(200);expect(first.data).toMatchObject({reason:'recovery_review_held',financialMutation:false,releaseRequired:true});
      expect((await send(body)).status).toBe(200);
      expect(await query('SELECT * FROM asaasWebhookInbox')).toHaveLength(1);
      expect(await query('SELECT * FROM auditLogs WHERE action=?',[RECOVERY_HOLD_ACTION])).toHaveLength(1);
      await preserved(before);
    });
    it('order13 and cancelled order1 remain intact for out-of-order arrivals',async()=>{
      const before=await financialSnapshot();
      for(const order of [13,1])for(const type of ['PAYMENT_RECEIVED','PAYMENT_CREATED','PAYMENT_RESTORED','PAYMENT_DELETED','PAYMENT_CONFIRMED'])expect((await send(envelope(type,randomUUID(),order))).status).toBe(200);
      await preserved(before);
    });
    it('stores allowlisted refund/reversal evidence atomically, strips PII and rejects conflicting evidence',async()=>{
      const before=await financialSnapshot();const e={...envelope('PAYMENT_PARTIALLY_REFUNDED'),customer:{email:'never-store@example.invalid'},payment:{...envelope('PAYMENT_PARTIALLY_REFUNDED').payment,customer:'private',refunds:[{id:'refund-fixture',value:12,status:'DONE',description:'private'}],chargeback:{id:'cb-fixture',status:'REQUESTED',reason:'FRAUD',customer:'private'}}};
      expect((await send(e)).status).toBe(200);const rows=await query('SELECT metadata FROM auditLogs');const text=JSON.stringify(rows);expect(text).toContain('refund-fixture');expect(text).toContain('cb-fixture');expect(text).not.toContain('never-store');expect(text).not.toContain('private');
      vi.stubEnv('ASAAS_WEBHOOK_RECOVERY_MODE','off');
      expect((await send({...e,payment:{...e.payment,refunds:[{id:'refund-fixture',value:13,status:'DONE'}]}})).status).toBe(409);await preserved(before);
    });
    it('same event identity with altered canonical financial content returns409',async()=>{
      const before=await financialSnapshot(),e=envelope('PAYMENT_RECEIVED');expect((await send(e)).status).toBe(200);
      expect((await send({...e,payment:{...e.payment,value:100}})).status).toBe(409);await preserved(before);
    });
    it('unauthenticated or invalid envelope never receives ACK or a hold',async()=>{
      expect((await send(envelope('PAYMENT_RECEIVED'),'bad-token')).status).toBe(401);
      expect((await send({event:'PAYMENT_CREATED'})).status).toBe(400);
      expect(await query('SELECT * FROM asaasWebhookInbox')).toHaveLength(0);expect(await query('SELECT * FROM auditLogs')).toHaveLength(0);
    });
    it('inbox failure never ACKs',async()=>{
      await query("CREATE TRIGGER fail_recovery_inbox BEFORE INSERT ON asaasWebhookInbox FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='LOCAL_INBOX_FAILURE'");
      try{expect((await send(envelope('PAYMENT_RECEIVED'))).status).toBe(503);expect(await query('SELECT * FROM auditLogs')).toHaveLength(0);}finally{await query('DROP TRIGGER fail_recovery_inbox');}
    });
    it('hold-audit failure rolls admission back atomically and never ACKs',async()=>{
      const before=await financialSnapshot();await query("CREATE TRIGGER fail_recovery_audit BEFORE INSERT ON auditLogs FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='LOCAL_HOLD_FAILURE'");
      try{expect((await send(envelope('PAYMENT_RECEIVED'))).status).toBe(503);expect(await query('SELECT * FROM asaasWebhookInbox')).toHaveLength(0);await preserved(before);}finally{await query('DROP TRIGGER fail_recovery_audit');}
    });
    it('preserves the original historical rejected row during hold and redelivery',async()=>{
      const e=envelope('PAYMENT_CREATED',CREATED_ID),before=await financialSnapshot();await seedRejected(e);const original=await query('SELECT * FROM asaasWebhookInbox');
      expect((await send(e)).status).toBe(200);expect((await send(e)).status).toBe(200);expect(await query('SELECT * FROM asaasWebhookInbox')).toEqual(original);await preserved(before);
    });
    it('concurrent HTTP admissions and worker serialize one hold, with safe retry for busy transactions',async()=>{
      const e=envelope('PAYMENT_RECEIVED',randomUUID(),14),before=await financialSnapshot();await persistWebhook(e);
      const replies=await Promise.all([send(e),send(e),recoverWebhooks(processWebhookEnvelope)]);for(const r of replies.slice(0,2))expect([200,503]).toContain((r as any).status);
      expect((await send(e)).status).toBe(200);expect(await query('SELECT * FROM auditLogs WHERE action=?',[RECOVERY_HOLD_ACTION])).toHaveLength(1);await preserved(before);
    });
    it('startup/restarted worker retains preexisting received/failed/processing events and never retries held work',async()=>{
      const before=await financialSnapshot();for(const state of ['received','failed','processing']){const e=envelope('PAYMENT_RECEIVED',randomUUID(),14);await persistWebhook(e);await query('UPDATE asaasWebhookInbox SET state=? WHERE eventId=?',[state,e.id]);}
      const stop=startWebhookRecovery(processWebhookEnvelope);
      try{for(let i=0;i<100;i++){if((await query('SELECT * FROM auditLogs WHERE action=?',[RECOVERY_HOLD_ACTION])).length===3)break;await new Promise(r=>setTimeout(r,5));}}finally{stop();}
      expect(await query('SELECT * FROM auditLogs WHERE action=?',[RECOVERY_HOLD_ACTION])).toHaveLength(3);
      expect(await recoverWebhooks(processWebhookEnvelope)).toMatchObject({examined:0});await preserved(before);
    });
    it('disabling mode, resetting inbox state, force flags and internal/admin entrypoints cannot release holds',async()=>{
      const e=envelope('PAYMENT_RECEIVED',randomUUID(),14),before=await financialSnapshot();expect((await send(e)).status).toBe(200);vi.stubEnv('ASAAS_WEBHOOK_RECOVERY_MODE','off');
      await query("UPDATE asaasWebhookInbox SET state='processed',completedAt='2020-01-01' WHERE eventId=?",[e.id]);
      expect((await processStoredWebhook(e.id,processWebhookEnvelope)).body).toMatchObject({releaseRequired:true});
      await recoverWebhooks(processWebhookEnvelope);expect((await query('SELECT payload FROM asaasWebhookInbox WHERE eventId=?',[e.id]))[0].payload).not.toBeNull();
      await query("UPDATE asaasWebhookInbox SET state='received' WHERE eventId=?",[e.id]);
      expect(await recoverWebhooks(processWebhookEnvelope)).toMatchObject({examined:0});
      expect((await processWebhookEnvelope({...e,force:true,release:true})).body).toMatchObject({releaseRequired:true});
      await expect(markOrderPaid(14,{source:'manual',actorUserId:14})).rejects.toThrow('WEBHOOK_RECOVERY_RELEASE_REQUIRED');
      await expect(updateOrderAndReserveDeliveredEmailEvents(14,{status:'cancelled'},14)).rejects.toThrow('WEBHOOK_RECOVERY_RELEASE_REQUIRED');
      await expect(runAsaasWebhookOnce({eventId:e.id,eventType:e.event,payload:e},async()=>({}))).rejects.toThrow('WEBHOOK_RECOVERY_RELEASE_REQUIRED');
      await expect(inWebhookTransaction(injected.orm as any,()=>recordTrustedPaymentReceipt(14,'pay_synthetic_14',true),[])).rejects.toThrow('WEBHOOK_RECOVERY_RELEASE_REQUIRED');
      await expect(inWebhookTransaction(injected.orm as any,()=>processWebhookEnvelope(e),[])).rejects.toThrow('WEBHOOK_RECOVERY_RELEASE_REQUIRED');await preserved(before);
    });
    it('review mode blocks notification enqueue, eligible outbox dispatch, legacy claims and allowlisted sends',async()=>{
      await query("INSERT INTO notificationOutbox(dedupeKey,type,orderId,payload) VALUES('eligible-14','payment-approved-email-v1',14,?)",[JSON.stringify({orderNumber:'14',customerEmail:'synthetic@example.invalid',customerName:'Synthetic',total:'R$99',salesMode:'STOCK'})]);
      const before=await financialSnapshot();vi.stubEnv('EMAIL_MODE','restricted');vi.stubEnv('STAGING_EMAIL_ALLOWLIST','synthetic@example.invalid');
      expect(await deliverPaymentNotifications()).toMatchObject({sent:0,blocked:true,recovery:true});
      expect(await dispatchOrderEmailEvent({orderId:6,eventType:'review_request_email',customerEmail:'synthetic@example.invalid',customerName:'Synthetic',appBaseUrl:'https://staging.l4ckos.com.br'})).toMatchObject({dispatched:false,reason:'policy_blocked'});
      expect(()=>assertEmailRecipientsAllowed({to:'synthetic@example.invalid'})).toThrow('ASAAS_WEBHOOK_RECOVERY_EMAIL_BLOCKED');
      await expect(enqueuePaymentApproved(14,{} as any)).rejects.toThrow('WEBHOOK_RECOVERY_EFFECTS_BLOCKED');
      await expect(markOrderPaid(14,{source:'manual',actorUserId:14})).rejects.toThrow('WEBHOOK_RECOVERY_EFFECTS_BLOCKED');
      await send(envelope('PAYMENT_RECEIVED',randomUUID(),14));vi.stubEnv('ASAAS_WEBHOOK_RECOVERY_MODE','off');
      expect(await deliverPaymentNotifications()).toMatchObject({sent:0,blocked:true});await preserved(before);
    });
    it('activation before an in-flight normal transaction commits rolls back real payment/stock writes and deferred notifications',async()=>{
      vi.stubEnv('ASAAS_WEBHOOK_RECOVERY_MODE','off');const before=await financialSnapshot();let enter!:()=>void,release!:()=>void;const ready=new Promise<void>(r=>enter=r),wait=new Promise<void>(r=>release=r);
      const pending=receiveWebhook(envelope('PAYMENT_RECEIVED',randomUUID(),14),async body=>{const reply=await processWebhookEnvelope(body);expect(reply.status).toBe(200);enter();await wait;return reply;});
      await ready;vi.stubEnv('ASAAS_WEBHOOK_RECOVERY_MODE','review_only');release();expect((await pending).status).toBe(503);await preserved(before);
    });
    it('deactivation while held admission waits on an inbox row cannot commit an ACK without the hold',async()=>{
      const e=envelope('PAYMENT_RECEIVED',randomUUID(),14),before=await financialSnapshot();await persistWebhook(e);await c.beginTransaction();await query('SELECT * FROM asaasWebhookInbox WHERE eventId=? FOR UPDATE',[e.id]);
      const pending=send(e);let waiting=false;
      for(let i=0;i<100;i++){const [locks]=await root.query<any[]>("SELECT COUNT(*) n FROM performance_schema.data_lock_waits w JOIN performance_schema.data_locks l ON l.ENGINE_LOCK_ID=w.REQUESTING_ENGINE_LOCK_ID WHERE l.OBJECT_SCHEMA=? AND l.OBJECT_NAME='asaasWebhookInbox'",[database]);if(Number(locks[0].n)>0){waiting=true;break;}await new Promise(r=>setTimeout(r,5));}
      expect(waiting).toBe(true);vi.stubEnv('ASAAS_WEBHOOK_RECOVERY_MODE','off');await c.commit();expect((await pending).status).toBe(503);expect(await query('SELECT * FROM auditLogs')).toHaveLength(0);await preserved(before);
      setReview();expect((await send(e)).status).toBe(200);
    });
    it('invalid mode or a production target fails closed without persistence',async()=>{
      vi.stubEnv('RAILWAY_PROJECT_ID','real-production-is-forbidden');expect((await send(envelope('PAYMENT_RECEIVED'))).status).toBe(503);expect(await query('SELECT * FROM asaasWebhookInbox')).toHaveLength(0);
      setReview();vi.stubEnv('ASAAS_WEBHOOK_RECOVERY_MODE','force');expect((await send(envelope('PAYMENT_RECEIVED'))).status).toBe(503);
    });
    it('boot configuration is immutable: a live toggle requires process restart',async()=>{
      vi.resetModules();const fresh=await import('../payments/webhookRecovery');fresh.initializeWebhookRecoveryMode();vi.stubEnv('ASAAS_WEBHOOK_RECOVERY_MODE','off');expect(()=>fresh.captureRecoveryFence()).toThrow('WEBHOOK_RECOVERY_RESTART_REQUIRED');
    });
  },
);
