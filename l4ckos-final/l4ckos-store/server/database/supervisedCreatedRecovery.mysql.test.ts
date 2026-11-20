import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { createConnection, createPool, type Connection, type Pool } from "mysql2/promise";
import type * as mysqlOrm from "drizzle-orm/mysql2";
import { preflightAsaasWebhookEnvelope, processWebhookEnvelope, type AsaasWebhookPreflight } from "../controllers/paymentController";
import { financialEnvelope, persistWebhook, processStoredWebhook, receiveWebhook, recoverWebhooks } from "../payments/webhookInbox";

import { rehearseCreatedRecovery } from "../payments/supervisedCreatedRecoveryRehearsal";
import { canonical, structuralHash, readStructuralSchema } from "../../database/schema/fingerprint";
import { afterWebhookCommit } from "../database/webhookTransaction";
import { markOrderPaid } from "../db";

import { addStockColumnsToFixture } from "../stock/testing/applyStockV6Migration";
const injected = vi.hoisted(() => ({ orm: null as unknown, getPayment: vi.fn(async (_paymentId: string): Promise<any> => { throw Error("OFFLINE_PROVIDER"); }) }));
vi.mock("drizzle-orm/mysql2", async original => ({ ...await original<typeof mysqlOrm>(), drizzle: () => injected.orm }));
vi.mock("../services/emailService.js", () => ({
  sendPaymentApprovedEmail: vi.fn(async () => {}), sendInternalNewSaleAlertEmail: vi.fn(async () => {}),
  sendInternalLowStockAlertEmail: vi.fn(async () => {}), sendPaymentFailedEmail: vi.fn(async () => {}),
  sendInternalPaymentFailedAlertEmail: vi.fn(async () => {}),
}));
vi.mock("../services/asaasService", () => ({
  validateAsaasWebhookSignature: (headers: Record<string, unknown>) => headers["asaas-access-token"] === "synthetic-token",
  getAsaasPayment: injected.getPayment,
  createAsaasCheckout: vi.fn(() => { throw Error("FORBIDDEN_EXTERNAL_CHARGE"); }),
  createAsaasCustomer: vi.fn(() => { throw Error("FORBIDDEN_EXTERNAL_CUSTOMER"); }),
}));

const socketPath = process.env.L4CKOS_LOCAL_MYSQL_SOCKET ?? "/tmp/l4ckos-0022-socket/mysqld.sock";
const database = "l4ckos_test_recovery_" + randomUUID().replaceAll("-", "").slice(0, 12);
let root: Connection, connection: Connection, pool: Pool;
const query = async (sql: string, values: unknown[] = []) => (await connection.query<any[]>(sql, values))[0];
const created = (id = randomUUID()) => ({
  id, event: "PAYMENT_CREATED",
  payment: { id: "pay-staging-synthetic", externalReference: "13", status: "PENDING", value: 99, netValue: 98.01 },
});
const paid = (event = "PAYMENT_RECEIVED") => ({ ...created(), event, payment: { ...created().payment, status: event === "PAYMENT_CONFIRMED" ? "CONFIRMED" : "RECEIVED" } });
const accountId = "sandbox-account-created-recovery";
const customerId = "cus-created-recovery-594";
const paidWithAccount = (event = "PAYMENT_RECEIVED") => ({ ...paid(event), account: { id: accountId } });
const inbox = async (id: string) => (await query("SELECT * FROM asaasWebhookInbox WHERE eventId=?", [id]))[0];
const order = async () => (await query("SELECT status,paymentStatus,fulfillmentStatus FROM orders WHERE id=13"))[0];
const stock = async () => Number((await query("SELECT stock FROM products WHERE id=1"))[0].stock);
const reservation = async () => (await query("SELECT status FROM stockReservations WHERE orderId=13"))[0].status;
const financialSnapshot = async () => {
  const snapshot: Record<string, unknown> = {};
  for (const table of ["orders", "orderItems", "stockReservations", "products", "auditLogs"])
    snapshot[table] = await query("SELECT * FROM `" + table + "`");
  return snapshot;
};

describe.skipIf(process.env.L4CKOS_MYSQL_TEST !== "1")("ORD-13 supervised recovery local rehearsal", () => {
  beforeAll(async () => {
    // Local socket only; fresh schema fixtures, no migration runner or remote database.
    if (!/^\/tmp\/l4ckos-[a-z0-9-]+\/mysqld\.sock$/.test(socketPath)) throw Error("LOCAL_SOCKET_REQUIRED");
    root = await createConnection({ user: "root", socketPath });
    await root.query("CREATE DATABASE `" + database + "`");
    connection = await createConnection({ user: "root", socketPath, database, dateStrings: true });
    await connection.query("SET FOREIGN_KEY_CHECKS=0");
    for (const file of (await readdir(new URL("../../database/bootstrap/v2/", import.meta.url))).filter(f => f.endsWith(".sql"))) {
      const table = file.slice(0,-4);
      let definition = await readFile(new URL("../../database/bootstrap/v2/" + table + ".sql", import.meta.url), "utf8");
      // Include the nullable schedule columns in the fresh CREATE definitions.
      // This is fixture setup, not execution of existing ALTER/migration scripts.
      const scheduleColumns = table === "orderItems"
        ? "  `estimatedManufacturingStartAtPurchase` date DEFAULT NULL,\n  `estimatedManufacturingEndAtPurchase` date DEFAULT NULL,\n"
        : table === "productionBatches"
          ? "  `estimatedManufacturingStart` date DEFAULT NULL,\n  `estimatedManufacturingEnd` date DEFAULT NULL,\n  `manufacturingScheduleRequired` tinyint NOT NULL DEFAULT '1',\n"
          : "";
      definition = definition.replace("  PRIMARY KEY", scheduleColumns + "  PRIMARY KEY");
      await connection.query(definition);
    }
    await connection.query("SET FOREIGN_KEY_CHECKS=1");
    await connection.query(await readFile(new URL("../../database/migrations/0023_asaas_webhook_inbox.sql", import.meta.url), "utf8"));
    const contract = JSON.parse(await readFile(new URL("../../database/schema/contract-v4.json", import.meta.url), "utf8"));
    expect(structuralHash(await readStructuralSchema(connection))).toBe(contract.fingerprint);
    // After the lineage-fingerprint check: the integrated Drizzle models also select the STOCK columns.
    await addStockColumnsToFixture(connection);
    const orm = await vi.importActual<typeof mysqlOrm>("drizzle-orm/mysql2");
    pool = createPool({ user: "root", socketPath, database, connectionLimit: 5 });
    injected.orm = orm.drizzle(pool);
  });
  beforeEach(async () => {
    vi.unstubAllEnvs(); vi.stubEnv("DATABASE_URL", "mysql://root@localhost/l4ckos_test_synthetic");
    vi.stubEnv("ASAAS_WEBHOOK_ACCOUNT_ID", ""); vi.stubEnv("ASAAS_WEBHOOK_ACCOUNT_CURRENCY", ""); vi.clearAllMocks();
    injected.getPayment.mockRejectedValue(Error("OFFLINE_PROVIDER"));
    for (const table of ["notificationOutbox", "orderEmailEvents", "paymentEvents", "payments", "asaasWebhookInbox", "asaasWebhookEvents", "auditLogs", "stockReservations", "orderItems", "orders", "products", "users"])
      await query("DELETE FROM `" + table + "`");
    await query("INSERT INTO users(id,openId,name,email) VALUES(14,'synthetic-admin','Fixture Admin','admin@example.invalid')");
    await query("INSERT INTO users(id,openId,name,email) VALUES(594,'synthetic-created-customer','STAGING RC2 synthetic','synthetic@example.invalid')");
    await query("INSERT INTO products(id,name,category,price,stock) VALUES(1,'STAGING RC2 synthetic','fixture',9900,98)");
    await query("INSERT INTO orders(id,userId,totalPrice) VALUES(13,594,9900)");
    await query("INSERT INTO orderItems(id,orderId,productId,productName,unitPrice,quantity,totalPrice) VALUES(14,13,1,'STAGING RC2 synthetic',9900,1,9900)");
    await query("INSERT INTO stockReservations(id,userId,orderId,orderItemId,productId,quantity,status,expiresAt) VALUES(10,594,13,14,1,1,'active',DATE_SUB(NOW(),INTERVAL 1 HOUR))");
    for (const id of [2,3,6,12]) await query("INSERT INTO orders(id,userId,totalPrice,status,paymentStatus) VALUES(?,594,9900,'paid','confirmed')",[id]);
    await query("INSERT INTO notificationOutbox(id,dedupeKey,type,orderId,status,attempts) VALUES(1,'fixture-historical-2','payment-approved',2,'pending',0),(2,'fixture-historical-3','payment-approved',3,'pending',0)");
    await query("INSERT INTO orderEmailEvents(orderId,eventType,status,idempotencyKey,attemptCount,processingAt) VALUES(6,'order_delivered_email','processing','fixture-delivered-6',1,'2026-09-27 01:43:32'),(6,'review_request_email','processing','fixture-review-6',1,'2026-09-27 01:43:32')");
  });
  afterAll(async () => {
    vi.unstubAllEnvs(); await pool?.end(); await connection?.end();
    if (root) { await root.query("DROP DATABASE `" + database + "`"); await root.end(); }
  });


  const seedRejected = async () => {
    const event = created("evt-supervised-created-synthetic");
    await persistWebhook(event);
    await query("UPDATE asaasWebhookInbox SET state='rejected',attempts=1,errorCode='WEBHOOK_VALIDATION_REJECTED',completedAt=NOW() WHERE eventId=?",[event.id]);
    return { event, plan: { eventId: event.id, payloadHash: (await inbox(event.id)).payloadHash,
      paymentId: event.payment.id, expectedAttempts: 1, actorUserId: 14 as const, approvalReference: "LOCAL_REHEARSAL_ORD13" } };
  };
  const historical = async () => ({
    orders: await query("SELECT * FROM orders WHERE id IN(2,3,6,12) ORDER BY id"),
    // Compare pre-existing order effects only. A legitimately paid order 13
    // creates its own payment-approved outbox entry and must not be mistaken for history dispatch.
    outbox: await query("SELECT * FROM notificationOutbox WHERE orderId IN(2,3,6,12) ORDER BY id"),
    emails: await query("SELECT * FROM orderEmailEvents ORDER BY id"),
  });
  const liveReservation = () => query("UPDATE stockReservations SET expiresAt=DATE_ADD(NOW(),INTERVAL 1 HOUR) WHERE id=10");
  const audits = () => query("SELECT * FROM auditLogs WHERE action='webhook.created_recovery_completed'");
  const recover = async () => { const fixture = await seedRejected(); await rehearseCreatedRecovery(fixture.plan,processWebhookEnvelope); return fixture; };
  const processWithPreflight = (event: unknown, result?: unknown) =>
    processWebhookEnvelope(event, undefined, undefined, result as AsaasWebhookPreflight | undefined);
  const receiveWithPreflight = (event: unknown) => receiveWebhook(event, processWithPreflight, preflightAsaasWebhookEnvelope);
  const seedAuthoritativePayment = async () => {
    vi.stubEnv("ASAAS_WEBHOOK_ACCOUNT_ID", accountId);
    await query("UPDATE users SET asaasCustomerId=? WHERE id=594", [customerId]);
    await query("INSERT INTO payments(orderId,providerPaymentId,providerCustomerId,billingType,amount,status,creationStatus,externalReference) VALUES(13,'pay-staging-synthetic',?,'PIX',9900,'pending','created','13')", [customerId]);
    injected.getPayment.mockResolvedValue({ id: "pay-staging-synthetic", externalReference: "13", status: "CONFIRMED",
      deleted: false, value: 99, currency: "BRL", customer: customerId });
  };
  const assertMissingEvidenceBlocked = async (label: string) => {
    const event = { ...paid(), id: `evt-${label}-without-authoritative-proof` };
    const response = await receiveWithPreflight(event);
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ reason: "payment_reconciliation_required", reconciliationRequired: true,
      financialMutation: false, stockMutation: false });
    expect(injected.getPayment).not.toHaveBeenCalled();
    expect(await order()).toMatchObject({ status: "pending", paymentStatus: "unconfirmed" });
    expect(await stock()).toBe(98); expect(await reservation()).toBe("active");
    expect(await inbox(event.id)).toMatchObject({ state: "processed" });
    expect(await query("SELECT * FROM auditLogs WHERE action='payment.webhook_reconciliation_required.v1'")).toHaveLength(1);
    expect(await query("SELECT * FROM notificationOutbox WHERE type='financial-reconciliation-alert-v1'")).toHaveLength(1);
    expect((await receiveWithPreflight(event)).body).toMatchObject({ reason: "duplicate_event" });
    expect(await query("SELECT * FROM auditLogs WHERE action='payment.webhook_reconciliation_required.v1'")).toHaveLength(1);
    expect(await query("SELECT * FROM notificationOutbox WHERE type='financial-reconciliation-alert-v1'")).toHaveLength(1);
  };

  it("does not automatically reopen the historical rejected CREATED", async () => {
    const {event}=await seedRejected(), before=await inbox(event.id);
    expect(await recoverWebhooks(processWebhookEnvelope)).toMatchObject({examined:0,rejected:1});
    expect(await processStoredWebhook(event.id,processWebhookEnvelope)).toMatchObject({status:200,body:{reason:"rejected_observation_recorded",reconciliationRequired:true}});
    expect(await inbox(event.id)).toEqual(before);
    expect(await query("SELECT * FROM auditLogs WHERE action='webhook.rejected_observation_acknowledged.v1'")).toHaveLength(1);
    expect(await query("SELECT * FROM notificationOutbox WHERE type='financial-reconciliation-alert-v1'")).toHaveLength(1);
    expect((await processStoredWebhook(event.id,processWebhookEnvelope)).status).toBe(200);
    expect(await query("SELECT * FROM notificationOutbox WHERE type='financial-reconciliation-alert-v1'")).toHaveLength(1);
  });
  it("does not acknowledge a rejected observation until its reconciliation alert is durable",async()=>{
    const {event}=await seedRejected();
    await query(`CREATE TRIGGER rejected_observation_alert_fail BEFORE INSERT ON notificationOutbox FOR EACH ROW
      BEGIN IF NEW.type='financial-reconciliation-alert-v1' THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='synthetic alert failure'; END IF; END`);
    try {
      expect((await processStoredWebhook(event.id,processWebhookEnvelope)).status).toBeGreaterThanOrEqual(500);
      expect(await query("SELECT * FROM auditLogs WHERE action='webhook.rejected_observation_acknowledged.v1'")).toHaveLength(0);
      expect(await query("SELECT * FROM notificationOutbox WHERE type='financial-reconciliation-alert-v1'")).toHaveLength(0);
      expect(await inbox(event.id)).toMatchObject({state:'rejected',attempts:1});
    } finally { await query('DROP TRIGGER rejected_observation_alert_fail'); }
    expect(await processStoredWebhook(event.id,processWebhookEnvelope)).toMatchObject({status:200,body:{reconciliationRequired:true}});
    expect(await query("SELECT * FROM auditLogs WHERE action='webhook.rejected_observation_acknowledged.v1'")).toHaveLength(1);
    expect(await query("SELECT * FROM notificationOutbox WHERE type='financial-reconciliation-alert-v1'")).toHaveLength(1);
  });
  it("atomically resolves CREATED and audits the original rejection without financial effects", async () => {
    const {event,plan}=await seedRejected(),before=await financialSnapshot(),history=await historical();
    const original=await inbox(event.id);
    expect(await rehearseCreatedRecovery(plan,processWebhookEnvelope)).toEqual({status:"completed"});
    expect(await inbox(event.id)).toMatchObject({state:"processed",attempts:2,payload:original.payload,payloadHash:original.payloadHash,errorCode:null});
    const audit=(await audits())[0];expect(audit.actorUserId).toBe(14);
    expect(JSON.parse(audit.beforeState)).toMatchObject({state:"rejected",attempts:1,errorCode:"WEBHOOK_VALIDATION_REJECTED"});
    const after=await financialSnapshot();delete before.auditLogs;delete after.auditLogs;expect(after).toEqual(before);
    expect(await historical()).toEqual(history);
    expect((await query("SELECT status,eventType FROM asaasWebhookEvents"))[0]).toMatchObject({status:"processed",eventType:"PAYMENT_CREATED"});
    expect((await import("../services/emailService.js")).sendPaymentApprovedEmail).not.toHaveBeenCalled();
  });
  it("duplicate recovery and authenticated-equivalent re-delivery preserve attempts and audit",async()=>{
    const {event,plan}=await recover(),before=await inbox(event.id);
    expect(await rehearseCreatedRecovery(plan,processWebhookEnvelope)).toEqual({status:"already_completed"});
    expect((await receiveWebhook(event,processWebhookEnvelope)).body).toMatchObject({reason:"duplicate_event"});
    expect(await inbox(event.id)).toEqual(before);expect(await audits()).toHaveLength(1);expect(await stock()).toBe(98);
  });
  it("serializes competing recovery attempts with one durable completion",async()=>{
    const {event,plan}=await seedRejected();
    const results=await Promise.allSettled([rehearseCreatedRecovery(plan,processWebhookEnvelope),rehearseCreatedRecovery(plan,processWebhookEnvelope)]);
    expect(results.some(r=>r.status==='fulfilled'&&r.value.status==='completed')).toBe(true);
    expect(await inbox(event.id)).toMatchObject({state:'processed',attempts:2});expect(await audits()).toHaveLength(1);
    expect((await query("SELECT COUNT(*) n FROM asaasWebhookEvents"))[0].n).toBe(1);expect(await stock()).toBe(98);
  });
  it.each(['payloadHash','paymentId','eventId','expectedAttempts','actorUserId','approvalReference'])("rejects changed recovery precondition %s",async(field)=>{
    const {event,plan}=await seedRejected(),before=await inbox(event.id);
    const altered={...plan,[field]: field==='expectedAttempts'?2:field==='actorUserId'?537:field==='payloadHash'?'f'.repeat(64):'bad'};
    await expect(rehearseCreatedRecovery(altered as any,processWebhookEnvelope)).rejects.toThrow();
    expect(await inbox(event.id)).toEqual(before);expect(await audits()).toHaveLength(0);
  });
  it("detects preserved payload tampering before any re-opening",async()=>{
    const {event,plan}=await seedRejected();await query("UPDATE asaasWebhookInbox SET payload=REPLACE(payload,'PENDING','RECEIVED') WHERE eventId=?",[event.id]);
    await expect(rehearseCreatedRecovery(plan,processWebhookEnvelope)).rejects.toThrow('RECOVERY_PAYLOAD_HASH_MISMATCH');
    expect(await inbox(event.id)).toMatchObject({state:'rejected',attempts:1});expect(await audits()).toHaveLength(0);
  });
  it("blocks accidental staging database use before a write",async()=>{
    const {plan}=await seedRejected();
    const execute=vi.spyOn(injected.orm as any,'execute').mockResolvedValueOnce([[{name:'l4ckos_staging'}]]);
    try {await expect(rehearseCreatedRecovery(plan,processWebhookEnvelope)).rejects.toThrow('LOCAL_REHEARSAL_ONLY');expect(await audits()).toHaveLength(0);}
    finally {execute.mockRestore();}
  });
  it.each(['ledger','audit','terminal inbox'])("rolls back re-opening, ledger and audit on %s failure",async(stage)=>{
    const {event,plan}=await seedRejected(),before=await inbox(event.id),snapshot=await financialSnapshot();
    const table=stage==='ledger'?'asaasWebhookEvents':stage==='audit'?'auditLogs':'asaasWebhookInbox';
    const operation=stage==='terminal inbox'?'UPDATE':'INSERT';
    const body=stage==='terminal inbox'?"BEGIN IF NEW.state='processed' THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='synthetic terminal failure'; END IF; END":"SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='synthetic failure'";
    await query('CREATE TRIGGER recovery_fail BEFORE '+operation+' ON '+table+' FOR EACH ROW '+body);
    try {await expect(rehearseCreatedRecovery(plan,processWebhookEnvelope)).rejects.toThrow();
      expect(await inbox(event.id)).toEqual(before);expect(await financialSnapshot()).toEqual(snapshot);
      expect(await query('SELECT * FROM asaasWebhookEvents')).toHaveLength(0);
    } finally {await query('DROP TRIGGER recovery_fail');}
  });
  it("non-200 or queued external effects cannot commit a recovery",async()=>{
    const {event,plan}=await seedRejected(),before=await inbox(event.id);
    await expect(rehearseCreatedRecovery(plan,async()=>({status:422,body:{handled:false}}))).rejects.toThrow('RECOVERY_HANDLER_NOT_COMPLETED');
    expect(await inbox(event.id)).toEqual(before);
  });
  it("queued notification effect causes rollback without dispatch",async()=>{
    const {event,plan}=await seedRejected(),before=await inbox(event.id),send=vi.fn(async()=>{});
    await expect(rehearseCreatedRecovery(plan,async()=>{
      await afterWebhookCommit(send);return {status:200,body:{handled:true,event:'PAYMENT_CREATED',orderId:13}};
    })).rejects.toThrow('RECOVERY_HANDLER_NOT_COMPLETED');
    expect(send).not.toHaveBeenCalled();expect(await inbox(event.id)).toEqual(before);
  });
  it("CREATED then RECEIVED with expired-active reserve remains pending and records reconciliation",async()=>{
    await assertMissingEvidenceBlocked("expired-active");await recover();await seedAuthoritativePayment();const event=paidWithAccount();expect((await receiveWithPreflight(event)).body).toMatchObject({reason:'invalid_status_transition'});
    // markOrderPaid expires an active reservation whose deadline has passed; it does not release or consume it.
    expect(await order()).toMatchObject({status:'pending',paymentStatus:'unconfirmed'});expect(await stock()).toBe(98);expect(await reservation()).toBe('expired');
    expect((await query("SELECT COUNT(*) n FROM auditLogs WHERE action='payment.reconciliation_required'"))[0].n).toBe(1);
    expect((await receiveWithPreflight(event)).body).toMatchObject({reason:'duplicate_event'});
    expect((await query("SELECT COUNT(*) n FROM auditLogs WHERE action='payment.reconciliation_required'"))[0].n).toBe(1);
  });
  it("receipt before expiry but delivery late is not silently treated as a live reserve",async()=>{
    await assertMissingEvidenceBlocked("late-delivery");await recover();await seedAuthoritativePayment();const event={...paidWithAccount(),dateCreated:'2026-10-11T12:55:00-03:00',payment:{...paidWithAccount().payment,confirmedDate:'2026-10-11T12:55:00-03:00'}};
    expect(financialEnvelope(event).payment).not.toHaveProperty('confirmedDate');
    expect((await receiveWithPreflight(event)).body).toMatchObject({reason:'invalid_status_transition'});
    expect(await stock()).toBe(98);expect(await order()).toMatchObject({paymentStatus:'unconfirmed'});
    expect(await reservation()).toBe('expired');
    expect((await query("SELECT COUNT(*) n FROM auditLogs WHERE action='payment.reconciliation_required'"))[0].n).toBe(1);
    expect((await receiveWithPreflight(event)).body).toMatchObject({reason:'duplicate_event'});
  });
  it("released reserve remains released when the financial event arrives",async()=>{
    await assertMissingEvidenceBlocked("released-reserve");await recover();await seedAuthoritativePayment();await query("UPDATE stockReservations SET status='released' WHERE id=10");
    const event=paidWithAccount();expect((await receiveWithPreflight(event)).body).toMatchObject({reason:'invalid_status_transition'});
    expect(await reservation()).toBe('released');expect(await stock()).toBe(98);
    expect((await query("SELECT COUNT(*) n FROM auditLogs WHERE action='payment.reconciliation_required'"))[0].n).toBe(1);
    expect((await receiveWithPreflight(event)).body).toMatchObject({reason:'duplicate_event'});
  });
  it("manual admin confirmation also refuses the expired reserve",async()=>{
    await recover();expect(await markOrderPaid(13,{source:'manual',actorUserId:14})).toMatchObject({updated:false,invalidTransition:true});
    expect(await order()).toMatchObject({paymentStatus:'unconfirmed'});expect(await stock()).toBe(98);
  });
  it("live-fixture concurrent RECEIVED and CONFIRMED consume once and do not dispatch history",async()=>{
    await assertMissingEvidenceBlocked("concurrent-paid");await liveReservation();await recover();await seedAuthoritativePayment();const history=await historical();const received=paidWithAccount(),confirmed=paidWithAccount('PAYMENT_CONFIRMED');
    const replies=await Promise.all([receiveWithPreflight(received),receiveWithPreflight(confirmed)]);
    expect(replies.every(r=>r.status===200||r.status===503)).toBe(true);
    // Explicit test-only retry after known busy/rollback, with original event IDs.
    for(const [i,event] of [received,confirmed].entries())if(replies[i].status!==200)expect((await receiveWithPreflight(event)).status).toBe(200);
    expect(await stock()).toBe(97);expect(await reservation()).toBe('consumed');
    expect(await order()).toMatchObject({status:'paid',paymentStatus:'confirmed'});
    expect(await query("SELECT eventId,status FROM asaasWebhookEvents WHERE eventId IN(?,?)",[received.id,confirmed.id])).toHaveLength(2);
    await receiveWithPreflight(received);await receiveWithPreflight(paidWithAccount());
    expect(await stock()).toBe(97);expect(await historical()).toEqual(history);
    const email=await import('../services/emailService.js');expect(email.sendPaymentApprovedEmail).toHaveBeenCalledTimes(1);expect(email.sendInternalNewSaleAlertEmail).toHaveBeenCalledTimes(1);
  });
  it("concurrent release holding the order lock prevents late financial consumption",async()=>{
    await assertMissingEvidenceBlocked("concurrent-release");await liveReservation();await recover();await seedAuthoritativePayment();
    const releaser=await createConnection({user:'root',socketPath,database});
    try {
      await releaser.beginTransaction();await releaser.query('SELECT id FROM orders WHERE id=13 FOR UPDATE');
      const event=paidWithAccount();const processing=receiveWithPreflight(event);
      await releaser.query("UPDATE stockReservations SET status='released' WHERE id=10");await releaser.commit();
      const result=await processing;expect(result.status).toBe(200);expect(result.body).toMatchObject({reason:'invalid_status_transition'});
      expect(await stock()).toBe(98);expect(await reservation()).toBe('released');expect(await order()).toMatchObject({paymentStatus:'unconfirmed'});
      expect((await query("SELECT COUNT(*) n FROM auditLogs WHERE action='payment.reconciliation_required'"))[0].n).toBe(1);
      expect((await receiveWithPreflight(event)).body).toMatchObject({reason:'duplicate_event'});
    } finally {await releaser.end();}
  });
  it("partial financial failure rolls back before a safe retry consumes once",async()=>{
    await assertMissingEvidenceBlocked("partial-financial-failure");await liveReservation();await recover();await seedAuthoritativePayment();const history=await historical();
    await query("CREATE TRIGGER paid_reservation_fail BEFORE UPDATE ON stockReservations FOR EACH ROW BEGIN IF NEW.status='consumed' THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='synthetic financial failure'; END IF; END");
    try {
      const event=paidWithAccount();expect((await receiveWithPreflight(event)).status).not.toBe(200);
      expect(await inbox(event.id)).toMatchObject({state:'failed'});expect(await stock()).toBe(98);expect(await reservation()).toBe('active');
      expect(await order()).toMatchObject({paymentStatus:'unconfirmed'});expect(await historical()).toEqual(history);
      expect((await import('../services/emailService.js')).sendPaymentApprovedEmail).not.toHaveBeenCalled();
      await query('DROP TRIGGER paid_reservation_fail');
      expect((await receiveWithPreflight(event)).status).toBe(200);
      expect(await stock()).toBe(97);expect(await reservation()).toBe('consumed');
      expect(await order()).toMatchObject({status:'paid',paymentStatus:'confirmed'});
      expect((await import('../services/emailService.js')).sendPaymentApprovedEmail).toHaveBeenCalledTimes(1);
      expect((await receiveWithPreflight(event)).body).toMatchObject({reason:'duplicate_event'});
      expect(await stock()).toBe(97);
    } finally {await query('DROP TRIGGER IF EXISTS paid_reservation_fail');}
  });
  it("does not ACK a missing-evidence receipt when reconciliation audit persistence fails",async()=>{
    const event={...paid(),id:'evt-audit-failure-no-ack'};
    await query(`CREATE TRIGGER webhook_reconciliation_audit_fail BEFORE INSERT ON auditLogs FOR EACH ROW
      BEGIN IF NEW.action='payment.webhook_reconciliation_required.v1' THEN
      SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='synthetic audit failure'; END IF; END`);
    try {
      expect((await receiveWithPreflight(event)).status).not.toBe(200);
      expect(await inbox(event.id)).toMatchObject({state:'failed'});
      expect(await query("SELECT * FROM auditLogs WHERE action='payment.webhook_reconciliation_required.v1'")).toHaveLength(0);
      expect(await query("SELECT * FROM notificationOutbox WHERE type='financial-reconciliation-alert-v1'")).toHaveLength(0);
      expect(await order()).toMatchObject({status:'pending',paymentStatus:'unconfirmed'});expect(await stock()).toBe(98);
      await query('DROP TRIGGER webhook_reconciliation_audit_fail');
      expect((await receiveWithPreflight(event)).status).toBe(200);
      expect(await inbox(event.id)).toMatchObject({state:'processed'});
      expect(await query("SELECT * FROM auditLogs WHERE action='payment.webhook_reconciliation_required.v1'")).toHaveLength(1);
      expect(await query("SELECT * FROM notificationOutbox WHERE type='financial-reconciliation-alert-v1'")).toHaveLength(1);
      expect(await order()).toMatchObject({status:'pending',paymentStatus:'unconfirmed'});expect(await stock()).toBe(98);
    } finally {await query('DROP TRIGGER IF EXISTS webhook_reconciliation_audit_fail');}
  });
  it("live-fixture RECEIVED before late CREATED recovery does not consume or notify again",async()=>{
    await assertMissingEvidenceBlocked("late-created");await liveReservation();const {plan}=await seedRejected();await seedAuthoritativePayment();const paymentEvent=paidWithAccount();await receiveWithPreflight(paymentEvent);
    expect(await rehearseCreatedRecovery(plan,processWebhookEnvelope)).toEqual({status:'completed'});
    expect(await stock()).toBe(97);expect(await reservation()).toBe('consumed');
    expect((await import('../services/emailService.js')).sendPaymentApprovedEmail).toHaveBeenCalledTimes(1);
    expect(await audits()).toHaveLength(1);
    expect((await receiveWithPreflight(paymentEvent)).body).toMatchObject({reason:'duplicate_event'});
    expect(await stock()).toBe(97);
  });
  it("out-of-order RECEIVED before recovery has no effects for expired reserve",async()=>{
    const {plan}=await seedRejected();await receiveWebhook(paid(),processWebhookEnvelope);
    await rehearseCreatedRecovery(plan,processWebhookEnvelope);
    expect(await stock()).toBe(98);expect(await order()).toMatchObject({paymentStatus:'unconfirmed'});
    expect((await import('../services/emailService.js')).sendPaymentApprovedEmail).not.toHaveBeenCalled();
  });
  it("a durable reconciliation receipt is not a financial confirmation and is not replayable by repeating its ID",async()=>{
    await recover();const event=paid();await receiveWebhook(event,processWebhookEnvelope);await liveReservation();
    expect((await receiveWebhook(event,processWebhookEnvelope)).body).toMatchObject({reason:'duplicate_event'});
    expect(await order()).toMatchObject({paymentStatus:'unconfirmed'});expect(await stock()).toBe(98);
  });
});
