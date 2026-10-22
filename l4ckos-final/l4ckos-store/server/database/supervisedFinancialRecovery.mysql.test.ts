import { afterEach, afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { createConnection, createPool, type Connection, type Pool } from "mysql2/promise";
import type * as mysqlOrm from "drizzle-orm/mysql2";
import { processWebhookEnvelope } from "../controllers/paymentController";
import { financialEnvelope, persistWebhook, processStoredWebhook, receiveWebhook, recoverWebhooks } from "../payments/webhookInbox";

import { rehearseCreatedRecovery } from "../payments/supervisedCreatedRecoveryRehearsal";
import { canonical, structuralHash, readStructuralSchema } from "../../database/schema/fingerprint";
import { afterWebhookCommit } from "../database/webhookTransaction";
import { rehearseFinancialRecovery, type FinancialRecoveryPlan } from "../payments/supervisedFinancialRecoveryRehearsal";

const injected = vi.hoisted(() => ({ orm: null as unknown }));
vi.mock("drizzle-orm/mysql2", async original => ({ ...await original<typeof mysqlOrm>(), drizzle: () => injected.orm }));
vi.mock("../services/emailService.js", () => ({
  sendPaymentApprovedEmail: vi.fn(async () => {}), sendInternalNewSaleAlertEmail: vi.fn(async () => {}),
  sendInternalLowStockAlertEmail: vi.fn(async () => {}), sendPaymentFailedEmail: vi.fn(async () => {}),
  sendInternalPaymentFailedAlertEmail: vi.fn(async () => {}),
}));
vi.mock("../services/asaasService", () => ({
  validateAsaasWebhookSignature: (headers: Record<string, unknown>) => headers["asaas-access-token"] === "synthetic-token",
  getAsaasPayment: vi.fn(async () => { throw Error("OFFLINE_PROVIDER"); }),
  createAsaasCheckout: vi.fn(() => { throw Error("FORBIDDEN_EXTERNAL_CHARGE"); }),
  createAsaasCustomer: vi.fn(() => { throw Error("FORBIDDEN_EXTERNAL_CUSTOMER"); }),
}));

const socketPath = process.env.L4CKOS_LOCAL_MYSQL_SOCKET ?? "/tmp/l4ckos-0022-socket/mysqld.sock";
const database = "l4ckos_test_recovery_" + randomUUID().replaceAll("-", "").slice(0, 12);
let root: Connection, connection: Connection, pool: Pool;
const query = async (sql: string, values: unknown[] = []) => (await connection.query<any[]>(sql, values))[0];
const created = (id = randomUUID()) => ({
  id, event: "PAYMENT_CREATED",
  payment: { id: "pay_dog6ppexq4gyw3k6", externalReference: "13", status: "PENDING", value: 99, netValue: 98.01 },
});
const paid = (event = "PAYMENT_RECEIVED") => ({ ...created(), event, payment: { ...created().payment, status: event === "PAYMENT_CONFIRMED" ? "CONFIRMED" : "RECEIVED" } });
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

describe.skipIf(process.env.L4CKOS_MYSQL_TEST !== "1")("ORD-13 financial recovery paths A and B", () => {
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
    const orm = await vi.importActual<typeof mysqlOrm>("drizzle-orm/mysql2");
    pool = createPool({ user: "root", socketPath, database, connectionLimit: 5, timezone: "Z" });
    injected.orm = orm.drizzle(pool);
  });
  beforeEach(async () => {
    vi.unstubAllEnvs(); vi.stubEnv("DATABASE_URL", "synthetic-present"); vi.clearAllMocks();
    for (const table of ["notificationOutbox", "orderEmailEvents", "paymentEvents", "payments", "asaasWebhookInbox", "asaasWebhookEvents", "auditLogs", "stockReservations", "orderItems", "orders", "products", "users"])
      await query("DELETE FROM `" + table + "`");
    await query("INSERT INTO users(id,openId,name,email,role) VALUES(14,'synthetic-admin','Fixture Admin','admin@example.invalid','admin')");
    await query("INSERT INTO users(id,openId,name,email) VALUES(594,'synthetic-created-customer','STAGING RC2 synthetic','synthetic@example.invalid')");
    await query("INSERT INTO products(id,name,category,price,stock) VALUES(1,'STAGING RC2 synthetic','fixture',9900,98)");
    await query("INSERT INTO orders(id,userId,totalPrice,createdAt) VALUES(13,594,9900,DATE_SUB(NOW(),INTERVAL 2 HOUR))");
    await query("INSERT INTO orderItems(id,orderId,productId,productName,unitPrice,quantity,totalPrice) VALUES(14,13,1,'STAGING RC2 synthetic',9900,1,9900)");
    await query("INSERT INTO stockReservations(id,userId,orderId,orderItemId,productId,quantity,status,expiresAt) VALUES(10,594,13,14,1,1,'active',DATE_SUB(NOW(),INTERVAL 1 HOUR))");
    await query("INSERT INTO auditLogs(id,actorUserId,actorType,action,entity,entityId,metadata) VALUES(72,594,'user','checkout.charge_created','order','13',?)",[JSON.stringify({payment:{paymentId:'pay_dog6ppexq4gyw3k6',method:'PIX'}})]);
    for (const id of [2,3,6,12]) await query("INSERT INTO orders(id,userId,totalPrice,status,paymentStatus) VALUES(?,594,9900,'paid','confirmed')",[id]);
    await query("UPDATE orders SET paymentStatus='unconfirmed',fulfillmentStatus='inventory_exception' WHERE id=2");
    await query("UPDATE orders SET paymentConfirmationSource='manual',paymentConfirmedBy=14,paymentConfirmedAt='2026-10-11 04:47:24',fulfillmentStatus='ready' WHERE id=3");
    await query("UPDATE orders SET status='delivered',paymentConfirmationSource='asaas_webhook',paymentConfirmedAt='2026-10-09 02:00:53',paymentConfirmationReference='synthetic-historical-12',fulfillmentStatus='awaiting_payment' WHERE id=12");
    await query("INSERT INTO auditLogs(id,actorUserId,actorType,action,entity,entityId,metadata) VALUES(69,14,'admin','order.payment_confirmed_manual','order','3','{}')");
    await query("INSERT INTO notificationOutbox(id,dedupeKey,type,orderId,status,attempts) VALUES(1,'fixture-historical-2','payment-approved',2,'pending',0),(2,'fixture-historical-3','payment-approved',3,'pending',0)");
    await query("INSERT INTO orderEmailEvents(orderId,eventType,status,idempotencyKey,attemptCount,processingAt) VALUES(6,'order_delivered_email','processing','fixture-delivered-6',1,'2026-09-27 01:43:32'),(6,'review_request_email','processing','fixture-review-6',1,'2026-09-27 01:43:32')");
  });
  let historicalBefore: Record<string,unknown>;
  const historical = async () => ({orders:await query("SELECT * FROM orders WHERE id IN(2,3,6,12) ORDER BY id"),
    audits:await query("SELECT * FROM auditLogs WHERE entityId<>'13' ORDER BY id"),
    outbox:await query("SELECT * FROM notificationOutbox WHERE orderId<>13 ORDER BY id"),
    emails:await query("SELECT * FROM orderEmailEvents ORDER BY id")});
  beforeEach(async()=>{historicalBefore=await historical();});
  afterEach(async()=>{
    expect(await historical()).toEqual(historicalBefore);
    const provider=await import('../services/asaasService');expect(provider.getAsaasPayment).not.toHaveBeenCalled();expect(provider.createAsaasCheckout).not.toHaveBeenCalled();
    const email=await import('../services/emailService.js');expect(email.sendPaymentApprovedEmail).not.toHaveBeenCalled();expect(email.sendInternalNewSaleAlertEmail).not.toHaveBeenCalled();
  });
  afterAll(async () => {
    vi.unstubAllEnvs(); await pool?.end(); await connection?.end();
    if (root) { await root.query("DROP DATABASE `" + database + "`"); await root.end(); }
  });



  const plan = (path:'A'|'B'='B',knownLate=false): FinancialRecoveryPlan => ({path,actorUserId:14,
    approvalReference:'LOCAL_FINANCIAL_ORD13',justification:'STAGING RC2 supervised exception with verified Sandbox receipt and stock',
    evidence:{source:'official_sandbox_get',paymentId:'pay_dog6ppexq4gyw3k6',externalReference:'13',status:'RECEIVED',billingType:'PIX',
      amountCents:9900,netAmountCents:9801,deleted:false,refundCount:0,refundsHasMore:false,chargebackPresent:false,observedAt:new Date().toISOString(),
      financialReceivedAt:path==='A'||knownLate?new Date(Date.now()-(knownLate?30:90)*60000).toISOString():null,
      timestampMeaning:path==='A'||knownLate?'official_financial_receipt':'not_proven',
      timestampEvidenceReference:path==='A'||knownLate?'synthetic-official-financial-receipt':null}});
  const apply = (input=plan()) => rehearseFinancialRecovery(input);
  const completedAudits = () => query("SELECT * FROM auditLogs WHERE action='order.payment_recovery_completed'");
  const seedRejected = async () => {
    const event=created('evt-created-synthetic-before-financial-recovery');await persistWebhook(event);
    await query("UPDATE asaasWebhookInbox SET state='rejected',attempts=1,errorCode='WEBHOOK_VALIDATION_REJECTED',completedAt=NOW() WHERE eventId=?",[event.id]);
    return {event,plan:{eventId:event.id,paymentId:event.payment.id,payloadHash:(await inbox(event.id)).payloadHash,expectedAttempts:1,actorUserId:14 as const,approvalReference:'LOCAL_CREATED_ORD13'}};
  };
  it.each(['A','B','B-known-late'] as const)("%s confirms now, preserves original expiry and consumes one unit",async(path)=>{
    const input=plan(path==='A'?'A':'B',path==='B-known-late'),before=(await query('SELECT * FROM stockReservations WHERE id=10'))[0],started=Date.now();
    expect(await apply(input)).toMatchObject({status:'completed'});
    expect(await stock()).toBe(97);expect(await reservation()).toBe('consumed');
    const after=(await query('SELECT * FROM stockReservations WHERE id=10'))[0];expect(after.expiresAt).toBe(before.expiresAt);
    const orderRow=(await query('SELECT * FROM orders WHERE id=13'))[0];expect(orderRow).toMatchObject({status:'paid',paymentStatus:'confirmed',paymentConfirmationSource:'manual',paymentConfirmedBy:14,fulfillmentStatus:'ready',paymentConfirmationReference:null});
    expect(Date.parse(orderRow.paymentConfirmedAt+'Z')).toBeGreaterThanOrEqual(started-1000);
    const payment=(await query('SELECT * FROM payments WHERE orderId=13'))[0];expect(payment).toMatchObject({providerPaymentId:input.evidence.paymentId,status:'received',amount:9900,paidAmount:9900,refundedAmount:0,statusSource:'reconciliation',manualConfirmedBy:14});
    if(path==='B')expect(payment.receivedAt).toBeNull();else expect(Date.parse(payment.receivedAt+'Z')).toBe(Math.floor(Date.parse(input.evidence.financialReceivedAt!)/1000)*1000);
    const audit=(await completedAudits())[0];expect(audit.actorUserId).toBe(14);expect(JSON.parse(audit.metadata).evidence.timestampMeaning).toBe(input.evidence.timestampMeaning);
    expect(await query('SELECT * FROM paymentEvents')).toHaveLength(0);expect(await query('SELECT * FROM asaasWebhookInbox')).toHaveLength(0);
    expect((await query('SELECT * FROM notificationOutbox WHERE orderId=13'))[0]).toMatchObject({status:'pending',attempts:0,sentAt:null});
  });
  it("date-only financial evidence cannot satisfy A and does not block B",async()=>{
    const input=plan('A');input.evidence.financialReceivedAt='2026-10-11';await expect(apply(input)).rejects.toThrow();
    const unknown=plan();expect(await apply(unknown)).toMatchObject({status:'completed'});
  });
  it.each(['webhook-created','webhook-delivered','operator-action'])("rejects %s as substitute financial timestamp",async(kind)=>{
    const input=plan('A');(input.evidence as any).timestampMeaning=kind;await expect(apply(input)).rejects.toThrow();expect(await stock()).toBe(98);
  });
  it.each(['unknown','late','before-order'])("A rejects %s financial time",async(kind)=>{
    const input=kind==='unknown'?{...plan(),path:'A' as const}:plan('A');
    if(kind==='late')input.evidence.financialReceivedAt=new Date(Date.now()-30*60000).toISOString();
    if(kind==='before-order')input.evidence.financialReceivedAt=new Date(Date.now()-180*60000).toISOString();
    await expect(apply(input)).rejects.toThrow();expect(await stock()).toBe(98);expect(await completedAudits()).toHaveLength(0);
  });
  it.each(['status','paymentId','externalReference','amountCents','deleted','refundCount','refundsHasMore','chargebackPresent','stale'])("rejects invalid or reversed evidence %s",async(field)=>{
    const input=plan();const replacements:any={status:'REFUNDED',paymentId:'another-payment',externalReference:'12',amountCents:100,deleted:true,refundCount:1,refundsHasMore:true,chargebackPresent:true};
    if(field==='stale')input.evidence.observedAt=new Date(Date.now()-180000).toISOString();else (input.evidence as any)[field]=replacements[field];
    await expect(apply(input)).rejects.toThrow();expect(await stock()).toBe(98);expect(await order()).toMatchObject({paymentStatus:'unconfirmed'});
  });
  it("verifies the administrator role and nonempty justification",async()=>{
    await query("UPDATE users SET role='user' WHERE id=14");await expect(apply()).rejects.toThrow('RECOVERY_ADMIN_REQUIRED');
    await query("UPDATE users SET role='admin' WHERE id=14");const input=plan();input.justification='';await expect(apply(input)).rejects.toThrow();
  });
  it.each(['active','expired','released'])("blocks unavailable or changed reserve state %s without renewal",async(state)=>{
    if(state==='active')await query("UPDATE stockReservations SET expiresAt=DATE_ADD(NOW(),INTERVAL 1 HOUR) WHERE id=10");
    else await query('UPDATE stockReservations SET status=? WHERE id=10',[state]);
    const before=await financialSnapshot();await expect(apply()).rejects.toThrow();expect(await financialSnapshot()).toEqual(before);
  });
  it.each([0,1])("insufficient effective stock (%s physical) holds for decision without refund",async(physical)=>{
    await query('UPDATE products SET stock=? WHERE id=1',[physical]);
    if(physical===1)await query("INSERT INTO stockReservations(userId,orderId,productId,quantity,status,expiresAt) VALUES(594,12,1,1,'active',DATE_ADD(NOW(),INTERVAL 1 HOUR))");
    expect(await apply()).toMatchObject({status:'held',reason:'STOCK_UNAVAILABLE'});
    expect(await stock()).toBe(physical);expect(await reservation()).toBe('active');expect(await order()).toMatchObject({paymentStatus:'unconfirmed'});
    expect(await query('SELECT * FROM payments WHERE orderId=13')).toHaveLength(0);
    expect(await query('SELECT * FROM notificationOutbox WHERE orderId=13')).toHaveLength(0);
    expect(await apply()).toMatchObject({status:'held',reason:'NEW_ADMIN_DECISION_REQUIRED'});
    expect(await query("SELECT * FROM auditLogs WHERE action='order.payment_recovery_held'")).toHaveLength(1);
  });
  it("repeated plans do not confirm, consume, audit or enqueue twice",async()=>{
    await apply();const before=await financialSnapshot(),payment=await query('SELECT * FROM payments'),outbox=await query('SELECT * FROM notificationOutbox');
    expect(await apply()).toEqual({status:'already_completed'});expect(await financialSnapshot()).toEqual(before);
    expect(await query('SELECT * FROM payments')).toEqual(payment);expect(await query('SELECT * FROM notificationOutbox')).toEqual(outbox);
  });
  it("concurrent A/B plans have exactly one successful application",async()=>{
    const results=await Promise.allSettled([apply(plan('A')),apply(plan())]);
    expect(results.some(r=>r.status==='fulfilled'&&r.value.status==='completed')).toBe(true);
    expect(await stock()).toBe(97);expect(await completedAudits()).toHaveLength(1);
    expect(await query('SELECT * FROM payments WHERE orderId=13')).toHaveLength(1);expect(await query('SELECT * FROM notificationOutbox WHERE orderId=13')).toHaveLength(1);
  });
  it("concurrent checkout product lock and live commitment reduce effective availability",async()=>{
    await query('UPDATE products SET stock=1 WHERE id=1');const writer=await createConnection({user:'root',socketPath,database});
    try {
      await writer.beginTransaction();await writer.query('SELECT id FROM products WHERE id=1 FOR UPDATE');
      const pending=apply();
      await writer.query("INSERT INTO stockReservations(userId,orderId,productId,quantity,status,expiresAt) VALUES(594,12,1,1,'active',DATE_ADD(NOW(),INTERVAL 1 HOUR))");await writer.commit();
      expect(await pending).toMatchObject({status:'held'});expect(await stock()).toBe(1);
    } finally {await writer.end();}
  });
  it.each(['products','stockReservations','payments','orders','auditLogs','notificationOutbox'])("rolls back all financial changes on %s failure",async(table)=>{
    const snapshot=await financialSnapshot();const operation=['products','stockReservations','orders'].includes(table)?'UPDATE':'INSERT';
    await query('CREATE TRIGGER finrec_fail BEFORE '+operation+' ON '+table+" FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='synthetic recovery failure'");
    try {await expect(apply()).rejects.toThrow();expect(await financialSnapshot()).toEqual(snapshot);expect(await query('SELECT * FROM payments WHERE orderId=13')).toHaveLength(0);expect(await query('SELECT * FROM notificationOutbox WHERE orderId=13')).toHaveLength(0);}
    finally {await query('DROP TRIGGER finrec_fail');}
  });
  it("refuses a payment already bound to a different order",async()=>{
    await query("INSERT INTO payments(orderId,providerPaymentId,billingType,amount,externalReference) VALUES(12,'pay_dog6ppexq4gyw3k6','PIX',9900,'12')");
    await expect(apply()).rejects.toThrow('RECOVERY_FINANCIAL_PRECONDITION_CHANGED');expect(await stock()).toBe(98);
  });
  it.each(["A","B"] as const)("%s: CREATED recovery, financial exception, and later official-equivalent events retain their own identities",async(path)=>{
    const fixture=await seedRejected();await rehearseCreatedRecovery(fixture.plan,processWebhookEnvelope);
    const createdBefore=await inbox(fixture.event.id);await apply(plan(path));const paymentBefore=await query('SELECT * FROM payments'),stockBefore=await stock();
    const received=paid(),confirmed=paid('PAYMENT_CONFIRMED');
    expect((await receiveWebhook(received,processWebhookEnvelope)).status).toBe(200);expect((await receiveWebhook(confirmed,processWebhookEnvelope)).status).toBe(200);
    await receiveWebhook(received,processWebhookEnvelope);await receiveWebhook(created(),processWebhookEnvelope);
    expect(await inbox(fixture.event.id)).toEqual(createdBefore);expect(await stock()).toBe(stockBefore);
    expect(await query('SELECT * FROM payments')).toEqual(paymentBefore);expect(await completedAudits()).toHaveLength(1);
    expect(await query('SELECT * FROM notificationOutbox WHERE orderId=13')).toHaveLength(1);
    expect((await inbox(received.id)).state).toBe('processed');expect((await inbox(confirmed.id)).state).toBe('processed');
  });
  it("an event received before reconciliation remains an observation; reconciliation does not invent another event",async()=>{
    const received=paid();expect((await receiveWebhook(received,processWebhookEnvelope)).body).toMatchObject({reason:'invalid_status_transition'});
    const inboxBefore=await inbox(received.id);await apply();expect(await inbox(received.id)).toEqual(inboxBefore);
    expect((await receiveWebhook(received,processWebhookEnvelope)).body).toMatchObject({reason:'duplicate_event'});
    expect(await stock()).toBe(97);expect(await query('SELECT * FROM paymentEvents')).toHaveLength(0);
  });
  it("financial exception before CREATED resolution is safe for spontaneous provider retries",async()=>{
    const fixture=await seedRejected();await apply();
    expect((await receiveWebhook(fixture.event,processWebhookEnvelope)).status).toBe(422);
    await rehearseCreatedRecovery(fixture.plan,processWebhookEnvelope);
    expect((await receiveWebhook(fixture.event,processWebhookEnvelope)).body).toMatchObject({reason:'duplicate_event'});
    await Promise.all([receiveWebhook(paid(),processWebhookEnvelope),receiveWebhook(paid('PAYMENT_CONFIRMED'),processWebhookEnvelope)]);
    expect(await stock()).toBe(97);expect(await reservation()).toBe('consumed');expect(await completedAudits()).toHaveLength(1);
    expect(await query('SELECT * FROM notificationOutbox WHERE orderId=13')).toHaveLength(1);
  });
  it("rejects mismatched original checkout audit",async()=>{
    await query("UPDATE auditLogs SET metadata='{}' WHERE id=72");await expect(apply()).rejects.toThrow('RECOVERY_CHECKOUT_PAYMENT_MISMATCH');expect(await stock()).toBe(98);
  });
  it("does not extend expiry or renew reservation on repeated confirmation",async()=>{
    const original=(await query('SELECT expiresAt FROM stockReservations WHERE id=10'))[0].expiresAt;
    await apply();await receiveWebhook(paid(),processWebhookEnvelope);await apply();
    expect((await query('SELECT expiresAt FROM stockReservations WHERE id=10'))[0].expiresAt).toBe(original);
    expect(await query('SELECT * FROM stockReservations WHERE orderId=13')).toHaveLength(1);
  });
});
