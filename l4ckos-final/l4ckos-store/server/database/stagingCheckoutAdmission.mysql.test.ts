import * as checkoutPolicy from "../../shared/checkoutMethods";
import {
  beforeAll,
  beforeEach,
  afterAll,
  describe,
  it,
  expect,
  vi,
} from "vitest";
import { randomUUID } from "node:crypto";
import { createPool, type Pool, type Connection } from "mysql2/promise";
import type * as mysqlOrm from "drizzle-orm/mysql2";
import { openBackupConnection } from "./backupRestore";
import { bootstrapReleaseDatabase } from "../../database/bootstrap/bootstrap";
import { readReleaseContract } from "../../database/schema/artifacts";
import { checkout, type CheckoutInput } from "./checkout";
import {
  receiveWebhook,
  recoverWebhooks,
  processStoredWebhook,
} from "../payments/webhookInbox";
import { processWebhookEnvelope } from "../controllers/paymentController";
import { deliverPaymentNotifications } from "../payments/paymentNotificationOutbox";
import { administerCheckoutAdmission } from "../admin/stagingCheckoutAdmission";
import { parseAdmissionArguments } from "../admin/stagingCheckoutAdmissionCli";
import {
  CANDIDATE,
  GRANT,
  RELEASE,
  ADMIT,
  recipientHash,
  admissionHash,
} from "../payments/stagingCheckoutAdmission";
import { RECOVERY_HOLD_ACTION } from "../payments/webhookRecovery";
import { sdk } from "../_core/sdk";
import { ENV } from "../_core/env";
import { assertEmailRecipientsAllowed } from "../services/email/recipientPolicy.js";
const injected = vi.hoisted(() => ({
  orm: null as unknown,
  mail: vi.fn(async (_p: any) => ({ id: "synthetic-mail" })),
  provider: vi.fn(),
}));
vi.mock("drizzle-orm/mysql2", async original => ({
  ...(await original<typeof mysqlOrm>()),
  drizzle: () => injected.orm,
}));
vi.mock("../services/emailService.js", () => ({
  sendPaymentApprovedEmail: injected.mail,
  sendOrderCreatedEmail: injected.mail,
  sendPaymentPendingEmail: injected.mail,
  sendInternalNewSaleAlertEmail: injected.mail,
  sendInternalLowStockAlertEmail: injected.mail,
  sendPaymentFailedEmail: injected.mail,
  sendInternalPaymentFailedAlertEmail: injected.mail,
}));
vi.mock("../services/asaasService", () => ({
  validateAsaasWebhookSignature: (h: any) =>
    h["asaas-access-token"] === "synthetic-token",
  getAsaasPayment: injected.provider,
  createAsaasCheckout: vi.fn(() => {
    throw Error("REMOTE_FORBIDDEN");
  }),
  createAsaasCustomer: vi.fn(() => {
    throw Error("REMOTE_FORBIDDEN");
  }),
}));
const socket = process.env.L4CKOS_LOCAL_MYSQL_SOCKET ?? "",
  database =
    "l4ckos_test_admission_" + randomUUID().replaceAll("-", "").slice(0, 10);
let root: Connection, c: Connection, pool: Pool, token: string;
const query = async (s: string, p: unknown[] = []) =>
  (await c.query<any[]>(s, p))[0];
const providers = new Map<string, any>();
function review() {
  for (const [key, value] of Object.entries({
    NODE_ENV: "production",
    RAILWAY_PROJECT_ID: "2bb90c8e-eb65-43ee-826b-f93750f0499c",
    RAILWAY_ENVIRONMENT_ID: "15545eee-bc02-4b70-afc4-19a5db9e6f46",
    RAILWAY_SERVICE_ID: "9f1c7705-f2f9-48cf-b957-8f63a6bba4db",
    ASAAS_WEBHOOK_RECOVERY_MODE: "review_only",
    ASAAS_API_URL: "https://api-sandbox.asaas.com/v3",
    EMAIL_MODE: "restricted",
    STAGING_EMAIL_ALLOWLIST: "synthetic@example.invalid",
    DATABASE_URL: "synthetic-present",
    STAGING_MAINTENANCE_MODE: "false",
  }))
    vi.stubEnv(key, value);
}
async function buy(
  method: CheckoutInput["method"] = "PIX",
  connection = c,
  lines?: CheckoutInput["items"],
  overrides: Partial<CheckoutInput> = {},
  shippingPrice = 0
) {
  const request: CheckoutInput = {
    userId: 999901,
    checkoutAttemptId: randomUUID(),
    items: lines ?? [{ productId: 999901, quantity: 1 }],
    method,
    shipping: { cep: "70000000", optionId: "synthetic" },
    shippingAddress: {
      recipient: "Synthetic",
      zipCode: "70000000",
      street: "Synthetic",
      number: "1",
      neighborhood: "Synthetic",
      city: "Brasilia",
      state: "DF",
    },
    customer: {
      name: "Synthetic",
      cpfCnpj: "11144477735",
      email: "synthetic@example.invalid",
    },
  };
  Object.assign(request, overrides);
  const charge = vi.fn(async ({ orderId, value }: any) => {
    const paymentId = "pay_test" + orderId;
    providers.set(paymentId, {
      id: paymentId,
      externalReference: String(orderId),
      value,
      status: "PENDING",
      billingType: method === "CARD" ? "CREDIT_CARD" : method,
      deleted: false,
      refunds: [],
    });
    return {
      method,
      customerId: "cus_synthetic",
      paymentId,
      invoiceUrl: "https://sandbox.asaas.com/i/synthetic",
      pixQrCode: null,
      pixCopyPaste: method === "PIX" ? "synthetic-pix" : null,
      bankSlipUrl:
        method === "BOLETO" ? "https://sandbox.asaas.com/b/synthetic" : null,
      digitableLine: null,
      nossoNumero: null,
      billingType: method === "CARD" ? "CREDIT_CARD" : method,
    };
  });
  const adapters = {
    quote: async () => ({
      options: [{ id: "synthetic", label: "Synthetic", price: shippingPrice }],
    }),
    charge,
  };
  // Local-only legacy invoice fixture: production checkout remains disabled for BOLETO.
  const legacy = method === "BOLETO" ? vi.spyOn(checkoutPolicy, "assertCheckoutMethodEnabled").mockImplementationOnce(() => {}) : null;
  let result: Awaited<ReturnType<typeof checkout>>;
  try { result = await checkout(connection, request, adapters); } finally { legacy?.mockRestore(); }
  return {
    id: result.orderId,
    paymentId: result.payment.paymentId,
    method,
    result,
    request,
    adapters,
  };
}
type Purchase = Awaited<ReturnType<typeof buy>>;
function event(b: Purchase, type = "PAYMENT_RECEIVED", id = randomUUID()) {
  return {
    id,
    event: type,
    payment: {
      id: b.paymentId,
      externalReference: String(b.id),
      value: b.result.totalPrice / 100,
      currency: "BRL",
      status:
        type === "PAYMENT_CREATED"
          ? "PENDING"
          : type === "PAYMENT_CONFIRMED"
            ? "CONFIRMED"
            : "RECEIVED",
    },
  };
}
const send = (e: unknown) => receiveWebhook(e, processWebhookEnvelope);
function grant(b: Purchase, extra: any = {}) {
  return {
    action: "authorize",
    orderId: b.id,
    paymentId: b.paymentId,
    method: b.method,
    events: ["PAYMENT_CREATED", "PAYMENT_CONFIRMED", "PAYMENT_RECEIVED"],
    recipientHash: recipientHash("synthetic@example.invalid"),
    notifications: true,
    expiresAt: new Date(Date.now() + 3600_000).toISOString(),
    reason: "Authorized isolated checkout homologation fixture",
    ...extra,
  };
}
async function authorize(request: any, session = token) {
  const preview = await administerCheckoutAdmission(
    injected.orm as any,
    request,
    session,
    { dryRun: true }
  );
  const result = await administerCheckoutAdmission(
    injected.orm as any,
    request,
    session,
    { dryRun: false, expectedDigest: preview.decisionDigest }
  );
  return { preview, result };
}
function paid(b: Purchase) {
  Object.assign(providers.get(b.paymentId), {
    status: "RECEIVED",
    billingType: b.method === "CARD" ? "CREDIT_CARD" : b.method,
  });
}
async function snapshot() {
  const out: any = {};
  for (const table of [
    "orders",
    "payments",
    "products",
    "productVariants",
    "stockReservations",
    "orderItems",
    "notificationOutbox",
    "orderEmailEvents",
    "asaasWebhookEvents",
    "paymentEvents",
  ])
    out[table] = await query("SELECT * FROM `" + table + "` ORDER BY id");
  return out;
}
async function historical() {
  const out: any = {};
  for (const [table, where] of Object.entries({
    orders: "id<=14",
    payments: "orderId<=14",
    products: "id=1",
    stockReservations: "orderId<=14",
    notificationOutbox: "orderId<=14",
    orderEmailEvents: "orderId<=14",
    asaasWebhookInbox: "eventId LIKE 'evt_historical%'",
    auditLogs: "id IN (74,76,78,79)",
  }))
    out[table] = await query(
      "SELECT * FROM `" +
        table +
        "` WHERE " +
        where +
        " ORDER BY " +
        (table === "asaasWebhookInbox" ? "eventId" : "id")
    );
  return admissionHash(out);
}
describe.skipIf(process.env.L4CKOS_MYSQL_TEST !== "1")(
  "selective staging checkout admission on isolated MySQL",
  () => {
    beforeAll(async () => {
      expect(socket).toMatch(/^\/tmp\/l4ckos-[a-z0-9-]+\/mysqld\.sock$/);
      vi.stubEnv("L4CKOS_LOCAL_SCHEMA", "1");
      vi.stubEnv("L4CKOS_LOCAL_RESTORE", "1");
      root = await openBackupConnection("mysql://root@localhost/mysql", socket);
      expect(
        (await root.query<any[]>("SELECT SHA2(@@server_uuid,256) h"))[0][0].h
      ).not.toBe(
        "92e96ae744d2112c5b4a430abc9a75d557a43d293652dd68369aa81786479f09"
      );
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
      ENV.cookieSecret = "synthetic-local-secret-never-used-remotely-12345";
      ENV.ownerOpenId = "synthetic-admin";
      ENV.adminEmails = ["admin@example.invalid"];
    }, 30000);
    beforeEach(async () => {
      vi.unstubAllEnvs();
      review();
      providers.clear();
      injected.mail.mockReset();
      injected.mail.mockImplementation(async p => {
        assertEmailRecipientsAllowed({ to: p.customerEmail });
        return { id: "synthetic-mail" };
      });
      injected.provider.mockReset();
      injected.provider.mockImplementation(async id => {
        const p = providers.get(id);
        if (!p) throw Error("PROVIDER_NOT_FOUND");
        return { ...p };
      });
      for (const trigger of [
        "fail_admission",
        "fail_selected_outbox",
        "fail_candidate",
      ])
        await query("DROP TRIGGER IF EXISTS " + trigger);
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
        "productVariants",
        "products",
        "users",
      ])
        await query("DELETE FROM `" + table + "`");
      await query(
        "INSERT INTO users(id,openId,name,email,role) VALUES(14,'synthetic-admin','Admin','admin@example.invalid','admin'),(999901,'synthetic-customer','Synthetic','synthetic@example.invalid','user')"
      );
      await query(
        "INSERT INTO products(id,name,category,price,stock) VALUES(1,'Historical','fixture',9900,97),(999901,'New fixture','fixture',9900,10)"
      );
      await query(
        "INSERT INTO orders(id,userId,totalPrice,status,paymentStatus,paymentConfirmationSource,fulfillmentStatus) VALUES(1,999901,9900,'cancelled','unconfirmed',NULL,'cancelled'),(13,999901,9900,'paid','confirmed','manual','ready'),(14,999901,9900,'paid','confirmed','asaas_webhook','ready'),(2,999901,9900,'paid','confirmed','manual','ready'),(3,999901,9900,'paid','confirmed','manual','ready'),(6,999901,9900,'delivered','confirmed','manual','ready')"
      );
      await query(
        "INSERT INTO payments(id,orderId,providerPaymentId,externalReference,billingType,amount,status,creationStatus,statusSource,paidAmount,netAmount) VALUES(4,13,'pay_historical13','13','PIX',9900,'received','created','reconciliation',9900,9801)"
      );
      await query(
        "INSERT INTO orderItems(id,orderId,productId,productName,unitPrice,quantity,totalPrice) VALUES(14,13,1,'Historical',9900,1,9900)"
      );
      await query(
        "INSERT INTO stockReservations(id,orderId,userId,productId,orderItemId,quantity,status,expiresAt) VALUES(10,13,999901,1,14,1,'consumed','2026-10-11 16:09:10')"
      );
      for (const id of [74, 76]) {
        await query(
          "INSERT INTO asaasWebhookInbox(eventId,payload,payloadHash,state) VALUES(?,? ,?,'received')",
          [
            "evt_historical" + id,
            JSON.stringify({ fixture: id }),
            "a".repeat(64),
          ]
        );
        await query(
          "INSERT INTO auditLogs(id,actorType,action,entity,entityId,metadata) VALUES(?,'system',?,'asaasWebhookInbox',?,?)",
          [
            id,
            RECOVERY_HOLD_ACTION,
            "historical" + id,
            JSON.stringify({
              eventId: "evt_historical" + id,
              orderId: 13,
              financialMutation: false,
            }),
          ]
        );
        await query(
          "INSERT INTO auditLogs(id,actorUserId,actorType,action,entity,entityId,metadata) VALUES(?,14,'admin','webhook.hold_already_reconciled_noop.v1','asaasWebhookInbox',?,?)",
          [
            id === 74 ? 78 : 79,
            "historical" + id,
            JSON.stringify({
              holdId: id,
              classification: "ALREADY_RECONCILED_NOOP",
            }),
          ]
        );
      }
      for (const id of [2, 3, 13])
        await query(
          "INSERT INTO notificationOutbox(dedupeKey,type,orderId,payload) VALUES(?,'payment-approved',?,'{}')",
          ["historical-" + id, id]
        );
      await query(
        "INSERT INTO orderEmailEvents(orderId,eventType,status,idempotencyKey,attemptCount,processingToken) VALUES(6,'review_request_email','processing','unknown-external',1,'historical')"
      );
      token = await sdk.createSessionToken("synthetic-admin", {
        sessionVersion: 1,
        expiresInMs: 3600_000,
      });
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
    it.each(["BOLETO","UNDEFINED"])("disabled %s creates no local records and leaves historical inbox/claims intact",async method=>{
      const before=await snapshot(),history=await historical(),charge=vi.fn(),quote=vi.fn();
      await expect(checkout(c,{method} as any,{charge,quote})).rejects.toMatchObject({code:"CHECKOUT_PAYMENT_METHOD_DISABLED"});
      expect(await snapshot()).toEqual(before);expect(await historical()).toBe(history);
      expect(charge).not.toHaveBeenCalled();expect(quote).not.toHaveBeenCalled();expect(injected.mail).not.toHaveBeenCalled();
      expect(process.env.ASAAS_WEBHOOK_RECOVERY_MODE).toBe("review_only");
    });
    it.each(["PIX","BOLETO","CARD"] as const)("exact financial buyer %s reaches READY once with no mail permission or claims", async method => {
      const before = await historical();
      const email = "yanbezerra651@gmail.com";
      await query("UPDATE users SET email=? WHERE id=999901", [email]);
      const b = await buy(method, c, undefined, {customer:{name:"Synthetic",cpfCnpj:"11144477735",email}}, 12.34);
      expect(b.result.totalPrice).toBe(11134);
      expect(b.adapters.charge.mock.calls[0][0].value).toBe(111.34);
      const holdEvent = event(b, "PAYMENT_CREATED");
      expect((await send(holdEvent)).status).toBe(200);
      const req = grant(b, {recipientHash:recipientHash(email),notifications:false});
      await authorize(req);
      // An order grant never releases an early hold by itself.
      const release={action:"release",orderId:b.id,paymentId:b.paymentId,eventIds:[holdEvent.id],reason:"Exact early event released for isolated financial test"};
      await authorize(release);
      await recoverWebhooks(10);
      paid(b);const received=event(b);
      expect((await send(received)).status).toBe(200);
      expect((await send(received)).status).toBe(200);
      expect((await query("SELECT status,paymentStatus,fulfillmentStatus FROM orders WHERE id=?",[b.id]))[0]).toMatchObject({status:"paid",paymentStatus:"confirmed",fulfillmentStatus:"ready"});
      expect((await query("SELECT stock FROM products WHERE id=999901"))[0].stock).toBe(9);
      expect((await query("SELECT status FROM stockReservations WHERE orderId=?",[b.id]))[0].status).toBe("consumed");
      await deliverPaymentNotifications(10,b.id);
      expect(injected.mail).not.toHaveBeenCalled();
      expect(Number((await query("SELECT SUM(attempts) n FROM notificationOutbox WHERE orderId=?",[b.id]))[0].n)).toBe(0);
      expect(await historical()).toBe(before);
      expect(process.env.ASAAS_WEBHOOK_RECOVERY_MODE).toBe("review_only");
    });

    it("new grants cannot authorize historical order 14 or alter an existing PIX grant", async () => {
      const before = await historical();
      await expect(authorize({...grant({id:14,paymentId:"pay_historical14",method:"PIX"} as Purchase)})).rejects.toThrow();
      const b = await buy(); const request = grant(b, {notifications:false});
      await authorize(request);
      const saved = await query("SELECT * FROM auditLogs WHERE action=? AND entityId=?",[GRANT,String(b.id)]);
      await expect(authorize({...request,method:"BOLETO"})).rejects.toThrow();
      expect(await query("SELECT * FROM auditLogs WHERE action=? AND entityId=?",[GRANT,String(b.id)])).toEqual(saved);
      expect(await historical()).toBe(before);
    });
    it.each(["BOLETO","CARD"] as const)("%s rejects divergent method, charge and buyer without broadening admission", async method => {
      const b=await buy(method), request=grant(b,{notifications:false});
      for(const change of [{method:"PIX"},{paymentId:"pay_other"},{recipientHash:recipientHash("other@example.invalid")}])
        await expect(authorize({...request,...change})).rejects.toThrow();
      await authorize(request);
      const wrong=event(b);wrong.payment.id="pay_other";
      expect((await send(wrong)).body).toMatchObject({releaseRequired:true});
      expect((await query("SELECT status FROM orders WHERE id=?",[b.id]))[0].status).toBe("pending");
      expect(injected.mail).not.toHaveBeenCalled();
    });
    it("BOLETO cannot be granted card-only risk events",async()=>{
      const b=await buy("BOLETO");
      await expect(authorize(grant(b,{events:["PAYMENT_AWAITING_RISK_ANALYSIS"]}))).rejects.toThrow();
    });
    it("late BOLETO records CONFIRMED then RECEIVED monotonically, retaining funds for review without fulfillment",async()=>{
      const before=await historical(),b=await buy("BOLETO");
      await authorize(grant(b,{notifications:false}));
      await query("UPDATE stockReservations SET expiresAt=DATE_SUB(NOW(),INTERVAL 1 MINUTE),status='expired' WHERE orderId=?",[b.id]);
      const financial=await snapshot();paid(b);
      const confirmed=event(b,"PAYMENT_CONFIRMED"),received=event(b);
      expect((await send(confirmed)).body).toMatchObject({receiptRecorded:true,releaseRequired:true});
      expect((await query("SELECT status,financialIssue FROM payments WHERE orderId=?",[b.id]))[0]).toMatchObject({status:"confirmed",financialIssue:"BOLETO_RESERVATION_REVIEW_REQUIRED"});
      expect((await send(received)).body).toMatchObject({receiptRecorded:true,releaseRequired:true});
      await send(received);await send(event(b,"PAYMENT_CONFIRMED"));
      await recoverWebhooks(processWebhookEnvelope);
      const after=await snapshot();
      expect(after.orders).toEqual(financial.orders);expect(after.products).toEqual(financial.products);expect(after.stockReservations).toEqual(financial.stockReservations);
      expect(after.payments.find((p:any)=>p.orderId===b.id)).toMatchObject({status:"received",paidAmount:9900,financialIssue:"BOLETO_RESERVATION_REVIEW_REQUIRED"});
      expect(Number((await query("SELECT COUNT(*) n FROM asaasWebhookEvents WHERE orderId=? AND eventId=?",[b.id,received.id]))[0].n)).toBe(1);
      expect(await historical()).toBe(before);expect(injected.mail).not.toHaveBeenCalled();
    });
    it("early BOLETO receipt released only by exact eventIds after expiry records funds without stock",async()=>{
      const b=await buy("BOLETO");paid(b);const e=event(b);
      await send(e);await authorize(grant(b,{notifications:false}));
      await query("UPDATE stockReservations SET expiresAt=DATE_SUB(NOW(),INTERVAL 1 MINUTE) WHERE orderId=?",[b.id]);
      await authorize({action:"release",orderId:b.id,paymentId:b.paymentId,eventIds:[e.id],reason:"Review exact late boleto financial receipt without stock"});
      expect((await processStoredWebhook(e.id,processWebhookEnvelope)).body).toMatchObject({receiptRecorded:true,releaseRequired:true});
      expect((await query("SELECT status FROM payments WHERE orderId=?",[b.id]))[0].status).toBe("received");
      expect((await query("SELECT state,errorCode FROM asaasWebhookInbox WHERE eventId=?",[e.id]))[0]).toMatchObject({state:"received",errorCode:"SELECTIVE_REVIEW_REQUIRED"});
      expect((await query("SELECT stock FROM products WHERE id=999901"))[0].stock).toBe(10);
    });
    it.each(["PAYMENT_CREDIT_CARD_CAPTURE_REFUSED","PAYMENT_REPROVED_BY_RISK_ANALYSIS"])("%s is audited and held, including duplicates and a later conflicting approval",async type=>{
      const before=await historical(),b=await buy("CARD");
      await authorize(grant(b,{notifications:false,events:["PAYMENT_CREATED","PAYMENT_CONFIRMED","PAYMENT_RECEIVED",type]}));
      const financial=await snapshot(),e=event(b,type);e.payment.status="PENDING";
      expect((await send(e)).body).toMatchObject({releaseRequired:true,receiptRecorded:false});
      await send(e);paid(b);expect((await send(event(b))).body).toMatchObject({releaseRequired:true});
      expect(Number((await query("SELECT COUNT(*) n FROM auditLogs WHERE action='payment.card_observation.v1' AND entityId=SHA2(?,256)",[e.id]))[0].n)).toBe(1);
      const after=await snapshot();
      for(const table of ["orders","payments","stockReservations","products","notificationOutbox","orderEmailEvents"])
        expect(after[table]).toEqual(financial[table]);
      expect(after.asaasWebhookEvents.length).toBe(financial.asaasWebhookEvents.length+1);
      expect(await historical()).toBe(before);expect(injected.mail).not.toHaveBeenCalled();
    });
    it("CARD risk pending and browser return do not pay; verified approval alone consumes once",async()=>{
      const b=await buy("CARD");
      await authorize(grant(b,{notifications:false,events:["PAYMENT_CREATED","PAYMENT_CONFIRMED","PAYMENT_RECEIVED","PAYMENT_AWAITING_RISK_ANALYSIS"]}));
      const pending=event(b,"PAYMENT_AWAITING_RISK_ANALYSIS");pending.payment.status="AWAITING_RISK_ANALYSIS";
      providers.get(b.paymentId).status="AWAITING_RISK_ANALYSIS";
      expect((await send(pending)).body.handled).toBe(true);await send(pending);
      // A browser redirect/URL never invokes a trusted confirmation path.
      expect((await query("SELECT status,paymentStatus FROM orders WHERE id=?",[b.id]))[0]).toMatchObject({status:"pending",paymentStatus:"unconfirmed"});
      expect((await query("SELECT stock FROM products WHERE id=999901"))[0].stock).toBe(10);
      paid(b);await send(event(b));await send(pending);
      expect((await query("SELECT status,fulfillmentStatus FROM orders WHERE id=?",[b.id]))[0]).toMatchObject({status:"paid",fulfillmentStatus:"ready"});
      expect((await query("SELECT stock FROM products WHERE id=999901"))[0].stock).toBe(9);expect(injected.mail).not.toHaveBeenCalled();
    });
    it("CARD refusal arriving after approval cannot downgrade payment, restore stock or send mail",async()=>{
      const b=await buy("CARD");await authorize(grant(b,{notifications:false,events:["PAYMENT_RECEIVED","PAYMENT_CREDIT_CARD_CAPTURE_REFUSED"]}));
      paid(b);await send(event(b));const financial=await snapshot();
      const e=event(b,"PAYMENT_CREDIT_CARD_CAPTURE_REFUSED");e.payment.status="PENDING";
      expect((await send(e)).body).toMatchObject({releaseRequired:true});await send(e);
      const after=await snapshot();
      for(const table of ["orders","payments","stockReservations","products","notificationOutbox","orderEmailEvents"])
        expect(after[table]).toEqual(financial[table]);
      expect(after.asaasWebhookEvents.length).toBe(financial.asaasWebhookEvents.length+1);
      expect(injected.mail).not.toHaveBeenCalled();
    });


    it("legacy grant without policyVersion keeps its prior request, digest and expired-payment behavior",async()=>{
      const b=await buy("BOLETO");await authorize(grant(b,{notifications:false}));
      const [g]=await query("SELECT * FROM auditLogs WHERE action=? AND entityId=?",[GRANT,String(b.id)]);
      const m=typeof g.metadata === "string"?JSON.parse(g.metadata):g.metadata;
      delete m.decision.policyVersion;m.decisionDigest=admissionHash(m.decision);
      await query("UPDATE auditLogs SET metadata=? WHERE id=?",[JSON.stringify(m),g.id]);
      const legacy=await query("SELECT * FROM auditLogs WHERE id=?",[g.id]);
      await query("UPDATE stockReservations SET expiresAt=DATE_SUB(NOW(),INTERVAL 1 MINUTE) WHERE orderId=?",[b.id]);
      paid(b);const financial=await snapshot();await send(event(b));
      expect(await snapshot()).toEqual(financial);expect(await query("SELECT * FROM auditLogs WHERE id=?",[g.id])).toEqual(legacy);
    });
    it("BOLETO confirmed with valid lease remains fulfilled when RECEIVED follows after lease expiry",async()=>{
      const b=await buy("BOLETO");await authorize(grant(b,{notifications:false}));paid(b);
      await send(event(b,"PAYMENT_CONFIRMED"));
      await query("UPDATE stockReservations SET expiresAt=DATE_SUB(NOW(),INTERVAL 1 MINUTE) WHERE orderId=?",[b.id]);
      const reserved=await query("SELECT * FROM stockReservations WHERE orderId=?",[b.id]);
      await send(event(b));await send(event(b,"PAYMENT_CONFIRMED"));
      expect((await query("SELECT status,fulfillmentStatus FROM orders WHERE id=?",[b.id]))[0]).toMatchObject({status:"paid",fulfillmentStatus:"ready"});
      expect((await query("SELECT status,financialIssue FROM payments WHERE orderId=?",[b.id]))[0]).toMatchObject({status:"received",financialIssue:null});
      expect(await query("SELECT * FROM stockReservations WHERE orderId=?",[b.id])).toEqual(reserved);
      expect((await query("SELECT stock FROM products WHERE id=999901"))[0].stock).toBe(9);expect(injected.mail).not.toHaveBeenCalled();
    });
    it("late BOLETO concurrent distinct receipts serialize without debit or duplicate ledger keys",async()=>{
      const b=await buy("BOLETO");await authorize(grant(b,{notifications:false}));paid(b);
      await query("UPDATE stockReservations SET expiresAt=DATE_SUB(NOW(),INTERVAL 1 MINUTE) WHERE orderId=?",[b.id]);
      const financial=await snapshot(),a=event(b),other=event(b,"PAYMENT_CONFIRMED");
      await Promise.all([send(a),send(other),send(a)]);
      // Read/re-delivery of the same two identities only; never create another charge.
      await send(a);await send(other);await recoverWebhooks(processWebhookEnvelope);
      const after=await snapshot();
      expect(after.orders).toEqual(financial.orders);expect(after.products).toEqual(financial.products);expect(after.stockReservations).toEqual(financial.stockReservations);
      expect(after.payments.find((p:any)=>p.orderId===b.id)).toMatchObject({status:"received",paidAmount:9900,financialIssue:"BOLETO_RESERVATION_REVIEW_REQUIRED"});
      const ledger=await query("SELECT eventId,COUNT(*) n FROM asaasWebhookEvents WHERE orderId=? GROUP BY eventId",[b.id]);
      expect(ledger).toHaveLength(2);expect(ledger.every((r:any)=>Number(r.n)===1)).toBe(true);expect(injected.mail).not.toHaveBeenCalled();
    });
    it("BOLETO receipt with live reservation but missing physical stock records funds for review",async()=>{
      const b=await buy("BOLETO");await authorize(grant(b,{notifications:false}));paid(b);
      await query("UPDATE products SET stock=0 WHERE id=999901");
      expect((await send(event(b))).body).toMatchObject({receiptRecorded:true,releaseRequired:true});
      expect((await query("SELECT status,fulfillmentStatus FROM orders WHERE id=?",[b.id]))[0]).toMatchObject({status:"pending",fulfillmentStatus:"awaiting_payment"});
      expect((await query("SELECT stock FROM products WHERE id=999901"))[0].stock).toBe(0);expect(injected.mail).not.toHaveBeenCalled();
    });


    it.each(["PAYMENT_AWAITING_RISK_ANALYSIS","PAYMENT_CREDIT_CARD_CAPTURE_REFUSED","PAYMENT_REPROVED_BY_RISK_ANALYSIS"])("early CARD %s remains held until exact audit release",async type=>{
      const b=await buy("CARD"),e=event(b,type);e.payment.status=type === "PAYMENT_AWAITING_RISK_ANALYSIS" ? "AWAITING_RISK_ANALYSIS" : "PENDING";
      providers.get(b.paymentId).status=e.payment.status;
      expect((await send(e)).body).toMatchObject({releaseRequired:true});
      await authorize(grant(b,{notifications:false,events:["PAYMENT_RECEIVED",type]}));
      expect((await processStoredWebhook(e.id,processWebhookEnvelope)).body).toMatchObject({releaseRequired:true});
      expect(await query("SELECT * FROM asaasWebhookEvents WHERE eventId=?",[e.id])).toHaveLength(0);
      await authorize({action:"release",orderId:b.id,paymentId:b.paymentId,eventIds:[e.id],reason:"Exact early hosted card observation audited release"});
      expect((await processStoredWebhook(e.id,processWebhookEnvelope)).status).toBe(200);
      expect(await query("SELECT * FROM asaasWebhookEvents WHERE eventId=? AND status='processed'",[e.id])).toHaveLength(1);
      expect((await query("SELECT status,fulfillmentStatus FROM orders WHERE id=?",[b.id]))[0]).toMatchObject({status:"pending",fulfillmentStatus:"awaiting_payment"});
      expect(injected.mail).not.toHaveBeenCalled();
    });

    it.each(["", "11111111111", "11144477736"])("invalid document #%# creates no order, reservation or charge", async document => {
      const before=await historical();const n=(await query("SELECT COUNT(*) n FROM orders"))[0].n;
      await expect(buy("PIX",c,undefined,{customer:{name:"Synthetic",cpfCnpj:document,email:"synthetic@example.invalid"}})).rejects.toThrow("CHECKOUT_DOCUMENT_INVALID");
      expect((await query("SELECT COUNT(*) n FROM orders"))[0].n).toBe(n);expect(await historical()).toBe(before);
    });
    it("another account cannot borrow the exact financial buyer email",async()=>{
      const n=(await query("SELECT COUNT(*) n FROM orders"))[0].n;
      await expect(buy("PIX",c,undefined,{customer:{name:"Synthetic",cpfCnpj:"11144477735",email:"yanbezerra651@gmail.com"}})).rejects.toThrow("CHECKOUT_BUYER_INVALID");
      expect((await query("SELECT COUNT(*) n FROM orders"))[0].n).toBe(n);
    });
    it("unapproved buyer is refused before any financial persistence",async()=>{
      const n=(await query("SELECT COUNT(*) n FROM orders"))[0].n;
      await expect(buy("PIX",c,undefined,{customer:{name:"Synthetic",cpfCnpj:"11144477735",email:"not-authorized@example.invalid"}})).rejects.toThrow();
      expect((await query("SELECT COUNT(*) n FROM orders"))[0].n).toBe(n);
    });
    it.each(["absent","unknown","different-address"])("shipping %s blocks before order/reservation creation",async kind=>{
      const n=(await query("SELECT COUNT(*) n FROM orders"))[0].n;const r=(await query("SELECT COUNT(*) n FROM stockReservations"))[0].n;
      await expect(buy("PIX",c,undefined,{shipping:kind==="absent"?undefined as any:{cep:kind==="different-address"?"70000001":"70000000",optionId:"unknown"}})).rejects.toThrow("CHECKOUT_SHIPPING_INVALID");
      expect((await query("SELECT COUNT(*) n FROM orders"))[0].n).toBe(n);expect((await query("SELECT COUNT(*) n FROM stockReservations"))[0].n).toBe(r);
    });
    it.each(["PIX", "BOLETO", "CARD"] as const)(
      "%s permits only exact granted checkout and consumes stock once",
      async method => {
        const before = await historical(),
          b = await buy(method);
        await authorize(grant(b));
        expect((await send(event(b, "PAYMENT_CREATED"))).status).toBe(200);
        paid(b);
        const e = event(b);
        expect((await send(e)).status).toBe(200);
        expect((await send(e)).status).toBe(200);
        expect((await send(event(b, "PAYMENT_CONFIRMED"))).status).toBe(200);
        expect((await send(event(b, "PAYMENT_CREATED"))).status).toBe(200);
        expect(
          (
            await query(
              "SELECT status,paymentStatus,fulfillmentStatus FROM orders WHERE id=?",
              [b.id]
            )
          )[0]
        ).toMatchObject({
          status: "paid",
          paymentStatus: "confirmed",
          fulfillmentStatus: "ready",
        });
        expect(
          (await query("SELECT stock FROM products WHERE id=999901"))[0].stock
        ).toBe(9);
        expect(
          (
            await query(
              "SELECT status FROM stockReservations WHERE orderId=?",
              [b.id]
            )
          )[0].status
        ).toBe("consumed");
        expect(injected.mail).not.toHaveBeenCalled();
        expect((await deliverPaymentNotifications(10)).sent).toBe(2);
        expect(injected.mail).toHaveBeenCalledTimes(2);
        await deliverPaymentNotifications();
        expect(injected.mail).toHaveBeenCalledTimes(2);
        expect(await historical()).toBe(before);
        expect(process.env.ASAAS_WEBHOOK_RECOVERY_MODE).toBe("review_only");
      }
    );
    it("holds early events permanently until explicit exact audit release; worker restart is safe", async () => {
      const b = await buy(),
        early = [event(b, "PAYMENT_CREATED"), event(b)];
      paid(b);
      for (const e of early)
        expect((await send(e)).body).toMatchObject({ releaseRequired: true });
      const originals = await query("SELECT * FROM auditLogs WHERE action=?", [
        RECOVERY_HOLD_ACTION,
      ]);
      await authorize(grant(b));
      expect((await recoverWebhooks(processWebhookEnvelope)).examined).toBe(2); // unrelated synthetic historical records are first held safely
      for (const e of early)
        expect((await send(e)).body).toMatchObject({ releaseRequired: true });
      expect(
        (await query("SELECT paymentStatus FROM orders WHERE id=?", [b.id]))[0]
          .paymentStatus
      ).toBe("unconfirmed");
      const release = {
        action: "release",
        orderId: b.id,
        paymentId: b.paymentId,
        eventIds: early.map(e => e.id),
        reason: "Release only these reviewed new checkout test events",
      };
      await authorize(release);
      await authorize(release);
      expect(
        await query("SELECT * FROM auditLogs WHERE action=?", [RELEASE])
      ).toHaveLength(2);
      await recoverWebhooks(processWebhookEnvelope);
      expect(
        (await query("SELECT stock FROM products WHERE id=999901"))[0].stock
      ).toBe(9);
      expect(
        await query("SELECT * FROM auditLogs WHERE action=? AND id IN (?)", [
          RECOVERY_HOLD_ACTION,
          originals.map(r => r.id),
        ])
      ).toEqual(originals);
    });
    it("same account does not admit other orders, charge identities, values or unapproved event scope", async () => {
      const a = await buy(),
        b = await buy();
      await authorize(grant(a, { events: ["PAYMENT_RECEIVED"] }));
      paid(a);
      paid(b);
      const wrong = event(a);
      wrong.payment.id = b.paymentId;
      const amount = event(a);
      amount.payment.value = 100;
      for (const e of [event(b), wrong, amount, event(a, "PAYMENT_CONFIRMED")])
        expect((await send(e)).body).toMatchObject({ releaseRequired: true });
      expect(
        (await query("SELECT stock FROM products WHERE id=999901"))[0].stock
      ).toBe(10);
    });
    it.each([
      "PAYMENT_UPDATED",
      "PAYMENT_OVERDUE",
      "PAYMENT_DELETED",
      "PAYMENT_RESTORED",
      "PAYMENT_REFUNDED",
      "PAYMENT_PARTIALLY_REFUNDED",
      "PAYMENT_REFUND_IN_PROGRESS",
      "PAYMENT_REFUND_DENIED",
      "PAYMENT_CHARGEBACK_REQUESTED",
      "PAYMENT_CHARGEBACK_DISPUTE",
      "PAYMENT_AWAITING_CHARGEBACK_REVERSAL",
      "PAYMENT_RECEIVED_IN_CASH_UNDONE",
      "UNKNOWN_FUTURE",
    ])("%s stays held and blocks subsequent selected effects", async type => {
      const b = await buy();
      await authorize(grant(b));
      paid(b);
      const before = await snapshot();
      expect((await send(event(b, type))).body).toMatchObject({
        releaseRequired: true,
      });
      expect((await send(event(b))).body).toMatchObject({
        releaseRequired: true,
      });
      await deliverPaymentNotifications();
      expect(await snapshot()).toEqual(before);
      expect(injected.mail).not.toHaveBeenCalled();
    });
    it.each([
      { deleted: true },
      { refunds: [{ value: 1 }] },
      { refunds: {} },
      { chargeback: { status: "REQUESTED" } },
      { billingType: "BOLETO" },
      { externalReference: "13" },
      { value: 100 },
      { status: "OVERDUE" },
    ])("provider mismatch/reversal %j is retained", async extra => {
      const b = await buy();
      await authorize(grant(b));
      paid(b);
      Object.assign(providers.get(b.paymentId), extra);
      const before = await snapshot();
      expect((await send(event(b))).body).toMatchObject({
        releaseRequired: true,
      });
      expect(await snapshot()).toEqual(before);
    });
    it("grant dry-run is read-only; apply requires exact digest and is idempotent", async () => {
      const b = await buy(),
        request = grant(b),
        before = await query("SELECT * FROM auditLogs ORDER BY id");
      const p = await administerCheckoutAdmission(
        injected.orm as any,
        request,
        token,
        { dryRun: true }
      );
      expect(await query("SELECT * FROM auditLogs ORDER BY id")).toEqual(
        before
      );
      await expect(
        administerCheckoutAdmission(injected.orm as any, request, token, {
          dryRun: false,
          expectedDigest: "a".repeat(64),
        })
      ).rejects.toThrow();
      await authorize(request);
      await authorize(request);
      expect(
        await query("SELECT * FROM auditLogs WHERE action=?", [GRANT])
      ).toHaveLength(1);
      expect(p.financialMutation).toBe(false);
    });
    it("concurrent administrators serialize a single grant audit", async () => {
      const b = await buy(),
        request = grant(b),
        p = await administerCheckoutAdmission(
          injected.orm as any,
          request,
          token,
          { dryRun: true }
        );
      const results = await Promise.allSettled(
        [1, 2].map(() =>
          administerCheckoutAdmission(injected.orm as any, request, token, {
            dryRun: false,
            expectedDigest: p.decisionDigest,
          })
        )
      );
      expect(results.some(x => x.status === "fulfilled")).toBe(true);
      expect(
        await query("SELECT * FROM auditLogs WHERE action=?", [GRANT])
      ).toHaveLength(1);
    });
    it("concurrent handler and worker consume only one reservation", async () => {
      const b = await buy();
      await authorize(grant(b));
      paid(b);
      const e = event(b);
      const results = await Promise.all([
        send(e),
        send(e),
        recoverWebhooks(processWebhookEnvelope),
      ]);
      expect(results).toHaveLength(3);
      expect((await send(e)).status).toBe(200);
      expect(
        (await query("SELECT stock FROM products WHERE id=999901"))[0].stock
      ).toBe(9);
      expect(
        await query(
          "SELECT * FROM notificationOutbox WHERE orderId=? AND type='payment-approved-email-v1'",
          [b.id]
        )
      ).toHaveLength(1);
    });
    it.each(["invalid", "nonadmin", "blocked", "rotated", "expired"])(
      "%s administrative session cannot authorize",
      async kind => {
        const b = await buy();
        let t = token;
        if (kind === "invalid") t = "unsigned";
        if (kind === "nonadmin")
          t = await sdk.createSessionToken("synthetic-customer");
        if (kind === "blocked")
          await query("UPDATE users SET isBlocked=1 WHERE id=14");
        if (kind === "rotated")
          await query("UPDATE users SET sessionVersion=2 WHERE id=14");
        if (kind === "expired")
          t = await sdk.createSessionToken("synthetic-admin", {
            expiresInMs: -1000,
          });
        await expect(authorize(grant(b), t)).rejects.toThrow();
        expect(
          await query("SELECT * FROM auditLogs WHERE action=?", [GRANT])
        ).toHaveLength(0);
      }
    );
    it("historical13 and historical newer ID without provenance cannot be authorized or released", async () => {
      const before = await historical(),
        b = await buy();
      await query("DELETE FROM auditLogs WHERE action=?", [CANDIDATE]);
      await expect(authorize(grant(b))).rejects.toThrow();
      await expect(authorize(grant({ ...b, id: 13 }))).rejects.toThrow();
      await expect(
        authorize({
          action: "release",
          orderId: 13,
          paymentId: "pay_historical13",
          eventIds: ["evt_historical74", "evt_historical76"],
          reason: "Historical events must never be released here",
        })
      ).rejects.toThrow();
      expect(await historical()).toBe(before);
    });
    it("grant persistence failure rolls back authorization and never enables receipt", async () => {
      const b = await buy(),
        request = grant(b),
        p = await administerCheckoutAdmission(
          injected.orm as any,
          request,
          token,
          { dryRun: true }
        );
      await query(
        "CREATE TRIGGER fail_admission BEFORE INSERT ON auditLogs FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='synthetic failure'"
      );
      await expect(
        administerCheckoutAdmission(injected.orm as any, request, token, {
          dryRun: false,
          expectedDigest: p.decisionDigest,
        })
      ).rejects.toThrow();
      await query("DROP TRIGGER fail_admission");
      paid(b);
      expect((await send(event(b))).body).toMatchObject({
        releaseRequired: true,
      });
    });
    it("financial transaction failure rolls back stock, payments and ledger then persists review hold", async () => {
      const b = await buy();
      await authorize(grant(b));
      paid(b);
      const before = await snapshot();
      await query(
        "CREATE TRIGGER fail_selected_outbox BEFORE INSERT ON notificationOutbox FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='synthetic failure'"
      );
      const e = event(b);
      expect((await send(e)).body).toMatchObject({ releaseRequired: true });
      await query("DROP TRIGGER fail_selected_outbox");
      expect(await snapshot()).toEqual(before);
      expect((await send(e)).body).toMatchObject({ releaseRequired: true });
      await recoverWebhooks(processWebhookEnvelope);
      expect(await snapshot()).toEqual(before);
    });
    it("state changes after preview reject stale digest; recipient and method remain exact", async () => {
      const b = await buy(),
        request = grant(b),
        p = await administerCheckoutAdmission(
          injected.orm as any,
          request,
          token,
          { dryRun: true }
        );
      await query("UPDATE payments SET amount=10000 WHERE orderId=?", [b.id]);
      await expect(
        administerCheckoutAdmission(injected.orm as any, request, token, {
          dryRun: false,
          expectedDigest: p.decisionDigest,
        })
      ).rejects.toThrow();
    });
    it("expired grant and revoked administrator stop worker processing and notification claims", async () => {
      const b = await buy();
      await authorize(grant(b));
      paid(b);
      await query("UPDATE users SET isBlocked=1 WHERE id=14");
      const before = await snapshot();
      expect((await send(event(b))).body).toMatchObject({
        releaseRequired: true,
      });
      await deliverPaymentNotifications();
      expect(await snapshot()).toEqual(before);
    });
    it("notification permission false preserves selected intents and legacy claims", async () => {
      const before = await historical(),
        b = await buy();
      await authorize(grant(b, { notifications: false }));
      paid(b);
      expect((await send(event(b))).status).toBe(200);
      expect((await deliverPaymentNotifications()).sent).toBe(0);
      expect(injected.mail).not.toHaveBeenCalled();
      expect(await historical()).toBe(before);
    });
    it("wrong recipient stays pending without consuming a notification attempt", async () => {
      const b = await buy();
      await authorize(grant(b));
      await query(
        "UPDATE notificationOutbox SET payload=JSON_SET(payload,'$.customerEmail','other@example.invalid') WHERE orderId=?",
        [b.id]
      );
      const before = await query(
        "SELECT * FROM notificationOutbox ORDER BY id"
      );
      await deliverPaymentNotifications();
      expect(
        await query("SELECT * FROM notificationOutbox ORDER BY id")
      ).toEqual(before);
      expect(injected.mail).not.toHaveBeenCalled();
    });
    it("expired reservation retains financial non-regression and stock; no implicit renewal", async () => {
      const b = await buy();
      await authorize(grant(b));
      paid(b);
      await query(
        "UPDATE stockReservations SET expiresAt=DATE_SUB(NOW(),INTERVAL 1 MINUTE) WHERE orderId=?",
        [b.id]
      );
      expect((await send(event(b))).body).toMatchObject({
        releaseRequired: true,
      });
      expect(
        (await query("SELECT paymentStatus FROM orders WHERE id=?", [b.id]))[0]
          .paymentStatus
      ).toBe("unconfirmed");
      expect(
        (await query("SELECT stock FROM products WHERE id=999901"))[0].stock
      ).toBe(10);
    });
    it("expiry while a financial transaction is in flight rolls back before commit", async () => {
      const b = await buy();
      await authorize(grant(b));
      paid(b);
      const before = await snapshot();
      const original = Date.now();
      let clock: ReturnType<typeof vi.spyOn> | undefined;
      try {
        const reply = await receiveWebhook(event(b), async e => {
          const r = await processWebhookEnvelope(e);
          clock = vi.spyOn(Date, "now").mockReturnValue(original + 7200_000);
          return r;
        });
        expect(reply.body).toMatchObject({ releaseRequired: true });
      } finally {
        clock?.mockRestore();
      }
      expect(await snapshot()).toEqual(before);
      expect((await recoverWebhooks(processWebhookEnvelope)).examined).toBe(2);
    });
    it("expired grant and changed recipient cannot become a global exception", async () => {
      const b = await buy();
      await authorize(grant(b));
      paid(b);
      const before = await snapshot();
      const original = Date.now(),
        clock = vi.spyOn(Date, "now").mockReturnValue(Date.now() + 7200_000);
      try {
        expect((await send(event(b))).body).toMatchObject({
          releaseRequired: true,
        });
        await deliverPaymentNotifications();
      } finally {
        clock.mockRestore();
      }
      expect(await snapshot()).toEqual(before);
      expect(Date.now()).toBeGreaterThanOrEqual(original);
    });
    it("candidate provenance failure rolls checkout back before provider creation", async () => {
      const before = await snapshot();
      await query(
        "CREATE TRIGGER fail_candidate BEFORE INSERT ON auditLogs FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='synthetic failure'"
      );
      await expect(buy()).rejects.toThrow();
      await query("DROP TRIGGER fail_candidate");
      expect(await snapshot()).toEqual(before);
      expect(providers.size).toBe(0);
    });
    it("provider read failure retains event without business mutations", async () => {
      const b = await buy();
      await authorize(grant(b));
      paid(b);
      const before = await snapshot();
      injected.provider.mockRejectedValue(Error("unavailable"));
      expect((await send(event(b))).body).toMatchObject({
        releaseRequired: true,
      });
      expect(await snapshot()).toEqual(before);
    });
    it("release cannot change identity, hash or target and never releases unrelated held work", async () => {
      const a = await buy(),
        b = await buy();
      paid(a);
      paid(b);
      const e = event(a),
        other = event(b);
      await send(e);
      await send(other);
      await authorize(grant(a));
      await expect(
        authorize({
          action: "release",
          orderId: a.id,
          paymentId: a.paymentId,
          eventIds: [other.id],
          reason: "Wrong order release must be rejected locally",
        })
      ).rejects.toThrow();
      await query(
        "UPDATE asaasWebhookInbox SET payloadHash=? WHERE eventId=?",
        ["b".repeat(64), e.id]
      );
      await expect(
        authorize({
          action: "release",
          orderId: a.id,
          paymentId: a.paymentId,
          eventIds: [e.id],
          reason: "Corrupt payload release must be rejected locally",
        })
      ).rejects.toThrow();
      expect(
        await query("SELECT * FROM auditLogs WHERE action=?", [RELEASE])
      ).toHaveLength(0);
    });
    it("admission audit failure prevents ACK and rolls back inbox admission", async () => {
      const b = await buy();
      await authorize(grant(b));
      paid(b);
      const e = event(b),
        before = await snapshot();
      await query(
        "CREATE TRIGGER fail_admission BEFORE INSERT ON auditLogs FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='synthetic failure'"
      );
      expect((await send(e)).status).toBe(503);
      await query("DROP TRIGGER fail_admission");
      expect(
        await query("SELECT * FROM asaasWebhookInbox WHERE eventId=?", [e.id])
      ).toHaveLength(0);
      expect(await snapshot()).toEqual(before);
    });
    it("notification workers claim only authorized new intents once under concurrency", async () => {
      const before = await historical(),
        b = await buy();
      await authorize(grant(b));
      const results = await Promise.all([
        deliverPaymentNotifications(2),
        deliverPaymentNotifications(2),
      ]);
      expect(results.reduce((n, r) => n + r.sent, 0)).toBe(2);
      expect(injected.mail).toHaveBeenCalledTimes(2);
      expect(await historical()).toBe(before);
    });
    it("ambiguous notification result uses the existing key and cannot reclaim a historical claim", async () => {
      const before = await historical(),
        b = await buy();
      await authorize(grant(b));
      injected.mail.mockRejectedValueOnce(Error("synthetic ambiguous"));
      await deliverPaymentNotifications(1, b.id, "order-created-email-v1");
      await query(
        "UPDATE notificationOutbox SET nextAttemptAt=NOW() WHERE orderId=?",
        [b.id]
      );
      await deliverPaymentNotifications(1, b.id, "order-created-email-v1");
      expect(injected.mail).toHaveBeenCalledTimes(2);
      expect(injected.mail.mock.calls[0][0].idempotencyKey).toBe(
        injected.mail.mock.calls[1][0].idempotencyKey
      );
      expect(await historical()).toBe(before);
    });
    it("recipient recovery context cannot authorize financial helpers or legacy notifications", async () => {
      const { withRecoveryRecipient } = await import(
        "../services/email/recipientPolicy.js"
      );
      const { markOrderPaid } = await import("../db");
      expect(() =>
        assertEmailRecipientsAllowed({ to: "synthetic@example.invalid" })
      ).toThrow("ASAAS_WEBHOOK_RECOVERY_EMAIL_BLOCKED");
      await expect(
        withRecoveryRecipient("synthetic@example.invalid", () =>
          markOrderPaid(13, { source: "manual", actorUserId: 14 })
        )
      ).rejects.toThrow("WEBHOOK_RECOVERY_EFFECTS_BLOCKED");
      expect(() =>
        withRecoveryRecipient("synthetic@example.invalid", () =>
          assertEmailRecipientsAllowed({ to: "other@example.invalid" })
        )
      ).toThrow();
    });
    it("historical event identities cannot be rebound to a new authorized order", async () => {
      const b = await buy();
      await authorize(grant(b));
      paid(b);
      const before = await snapshot();
      for (const id of [
        "evt_05b708f961d739ea7eba7e4db318f621&21683762",
        "evt_d26e303b238e509335ac9ba210e51b0f&21684231",
      ])
        expect(
          (await send(event(b, "PAYMENT_RECEIVED", id))).body
        ).toMatchObject({ releaseRequired: true });
      expect(await snapshot()).toEqual(before);
      expect(
        await query("SELECT * FROM auditLogs WHERE action=?", [ADMIT])
      ).toHaveLength(0);
    });
    it("selected transaction cannot operate on another order or event identity", async () => {
      const b = await buy();
      await authorize(grant(b));
      paid(b);
      const { markOrderPaid, runAsaasWebhookOnce } = await import("../db");
      const reply = await receiveWebhook(event(b), async e => {
        await expect(
          markOrderPaid(13, { source: "manual", actorUserId: 14 })
        ).rejects.toThrow();
        await expect(
          runAsaasWebhookOnce(
            {
              eventId: "wrong-event",
              eventType: "PAYMENT_RECEIVED",
              orderId: 13,
              paymentId: b.paymentId,
              payload: e,
            },
            async () => ({})
          )
        ).rejects.toThrow();
        return processWebhookEnvelope(e);
      });
      expect(reply.status).toBe(200);
      expect(
        (await query("SELECT stock FROM products WHERE id=1"))[0].stock
      ).toBe(97);
    });
    it("a released event that fails business persistence is blocked from automatic reprocessing", async () => {
      const b = await buy();
      paid(b);
      const e = event(b);
      await send(e);
      await authorize(grant(b));
      const release = {
        action: "release",
        orderId: b.id,
        paymentId: b.paymentId,
        eventIds: [e.id],
        reason: "Release only the exact reviewed synthetic event",
      };
      await authorize(release);
      await query(
        "CREATE TRIGGER fail_selected_outbox BEFORE INSERT ON notificationOutbox FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='synthetic failure'"
      );
      expect(
        (await processStoredWebhook(e.id, processWebhookEnvelope)).body
      ).toMatchObject({ releaseRequired: true });
      await query("DROP TRIGGER fail_selected_outbox");
      expect((await recoverWebhooks(processWebhookEnvelope)).examined).toBe(2);
      await expect(authorize(release)).rejects.toThrow();
      expect(
        (await query("SELECT stock FROM products WHERE id=999901"))[0].stock
      ).toBe(10);
    });
    it("cancelled selected order is retained without refund, confirmation or stock mutation", async () => {
      const b = await buy();
      await authorize(grant(b));
      paid(b);
      await query("UPDATE orders SET status='cancelled' WHERE id=?", [b.id]);
      const before = await snapshot();
      expect((await send(event(b))).body).toMatchObject({
        releaseRequired: true,
      });
      expect(await snapshot()).toEqual(before);
    });
    it.each(["PIX", "BOLETO", "CARD"] as const)(
      "%s payment/provider receipt after lease expiry stays held and cannot become READY",
      async method => {
        const before = await historical(),
          b = await buy(method);
        await authorize(grant(b));
        await query(
          "UPDATE stockReservations SET createdAt=DATE_SUB(NOW(),INTERVAL 21 MINUTE),expiresAt=DATE_SUB(NOW(),INTERVAL 1 MINUTE) WHERE orderId=?",
          [b.id]
        );
        paid(b);
        const financial = await snapshot(),
          e = event(b);
        expect((await send(e)).body).toMatchObject({ releaseRequired: true });
        await send(e);
        await recoverWebhooks(processWebhookEnvelope);
        if (method !== "BOLETO") expect(await snapshot()).toEqual(financial);
        else {
          const after = await snapshot();
          expect(after.payments.find((p:any)=>p.orderId===b.id)).toMatchObject({status:"received",paidAmount:9900,financialIssue:"BOLETO_RESERVATION_REVIEW_REQUIRED"});
          expect(after.products).toEqual(financial.products);
          expect(after.stockReservations).toEqual(financial.stockReservations);
        }
        expect(await historical()).toBe(before);
        expect(
          (
            await query("SELECT fulfillmentStatus FROM orders WHERE id=?", [
              b.id,
            ])
          )[0].fulfillmentStatus
        ).toBe("awaiting_payment");
      }
    );
    it("early held payment released after 20 minutes cannot silently recreate a reservation", async () => {
      const b = await buy();
      paid(b);
      const e = event(b);
      await send(e);
      await authorize(grant(b));
      await query(
        "UPDATE stockReservations SET expiresAt=DATE_SUB(NOW(),INTERVAL 1 MINUTE) WHERE orderId=?",
        [b.id]
      );
      const before = await snapshot();
      await authorize({
        action: "release",
        orderId: b.id,
        paymentId: b.paymentId,
        eventIds: [e.id],
        reason: "Explicit selective release of the exact new test event",
      });
      expect(
        (await processStoredWebhook(e.id, processWebhookEnvelope)).body
      ).toMatchObject({ releaseRequired: true });
      expect(await snapshot()).toEqual(before);
    });
    it.each([
      "expired",
      "released",
      "consumed",
      "restocked",
      "missing",
      "quantity",
      "wrong-item",
    ])(
      "reservation %s cannot commit fulfillment or financial changes",
      async kind => {
        const b = await buy();
        await authorize(grant(b));
        paid(b);
        if (kind === "missing")
          await query("DELETE FROM stockReservations WHERE orderId=?", [b.id]);
        else if (kind === "quantity")
          await query(
            "UPDATE stockReservations SET quantity=2 WHERE orderId=?",
            [b.id]
          );
        else if (kind === "wrong-item")
          await query(
            "UPDATE stockReservations SET orderItemId=NULL WHERE orderId=?",
            [b.id]
          );
        else
          await query("UPDATE stockReservations SET status=? WHERE orderId=?", [
            kind,
            b.id,
          ]);
        const before = await snapshot();
        expect((await send(event(b))).body).toMatchObject({
          releaseRequired: true,
        });
        expect(await snapshot()).toEqual(before);
      }
    );
    it.each(["on_hold", "inventory_exception", "issue"])(
      "fulfillment %s cannot be overwritten with READY",
      async kind => {
        const b = await buy();
        await authorize(grant(b));
        paid(b);
        if (kind === "issue")
          await query(
            "UPDATE orders SET fulfillmentIssue='REVIEW_REQUIRED' WHERE id=?",
            [b.id]
          );
        else
          await query("UPDATE orders SET fulfillmentStatus=? WHERE id=?", [
            kind,
            b.id,
          ]);
        const before = await snapshot();
        expect((await send(event(b))).body).toMatchObject({
          releaseRequired: true,
        });
        expect(await snapshot()).toEqual(before);
      }
    );
    it("missing physical stock is retained even if the reservation is live", async () => {
      const b = await buy();
      await authorize(grant(b));
      paid(b);
      await query("UPDATE products SET stock=0 WHERE id=999901");
      const before = await snapshot();
      expect((await send(event(b))).body).toMatchObject({
        releaseRequired: true,
      });
      expect(await snapshot()).toEqual(before);
    });
    it("two concurrent checkouts cannot reserve the last unit twice", async () => {
      await query("UPDATE products SET stock=1 WHERE id=999901");
      const a = await openBackupConnection(
          "mysql://root@localhost/" + database,
          socket
        ),
        b = await openBackupConnection(
          "mysql://root@localhost/" + database,
          socket
        );
      try {
        const results = await Promise.allSettled([
          buy("PIX", a),
          buy("BOLETO", b),
        ]);
        expect(results.filter(r => r.status === "fulfilled")).toHaveLength(1);
        expect(results.filter(r => r.status === "rejected")).toHaveLength(1);
        expect(
          await query(
            "SELECT * FROM stockReservations WHERE productId=999901 AND status='active'"
          )
        ).toHaveLength(1);
        const winner = (
          results.find(
            r => r.status === "fulfilled"
          ) as PromiseFulfilledResult<Purchase>
        ).value;
        await authorize(grant(winner));
        paid(winner);
        await send(event(winner));
        expect(
          (await query("SELECT stock FROM products WHERE id=999901"))[0].stock
        ).toBe(0);
        expect(
          (
            await query("SELECT fulfillmentStatus FROM orders WHERE id=?", [
              winner.id,
            ])
          )[0].fulfillmentStatus
        ).toBe("ready");
      } finally {
        await a.end();
        await b.end();
      }
    });
    it("expired last-unit reservation does not steal the unit newly reserved by another checkout", async () => {
      await query("UPDATE products SET stock=1 WHERE id=999901");
      const a = await buy();
      await authorize(grant(a));
      await query(
        "UPDATE stockReservations SET expiresAt=DATE_SUB(NOW(),INTERVAL 1 MINUTE) WHERE orderId=?",
        [a.id]
      );
      const b = await buy();
      await authorize(grant(b));
      paid(a);
      paid(b);
      expect((await send(event(a))).body).toMatchObject({
        releaseRequired: true,
      });
      expect((await send(event(b))).status).toBe(200);
      expect(
        (await query("SELECT stock FROM products WHERE id=999901"))[0].stock
      ).toBe(0);
      expect(
        (await query("SELECT paymentStatus FROM orders WHERE id=?", [a.id]))[0]
          .paymentStatus
      ).toBe("unconfirmed");
    });
    it("aggregate multiple item reservations debit each product once without overdrawing stock", async () => {
      const b = await buy("PIX", c, [
        { productId: 999901, quantity: 1 },
        { productId: 999901, quantity: 1 },
      ]);
      await authorize(grant(b));
      paid(b);
      expect((await send(event(b))).status).toBe(200);
      expect(
        (await query("SELECT stock FROM products WHERE id=999901"))[0].stock
      ).toBe(8);
      expect(
        await query(
          "SELECT * FROM stockReservations WHERE orderId=? AND status='consumed'",
          [b.id]
        )
      ).toHaveLength(2);
    });
    it.each(["PIX","BOLETO"] as const)("%s expiration while waiting on the product lock rolls back every debit", async method => {
      const b = await buy(method);
      await authorize(grant(b));
      paid(b);
      await query(
        "UPDATE stockReservations SET expiresAt=DATE_ADD(NOW(),INTERVAL 2 SECOND) WHERE orderId=?",
        [b.id]
      );
      const before = await snapshot();
      await c.beginTransaction();
      await query("SELECT id FROM products WHERE id=999901 FOR UPDATE");
      const pending = send(event(b));
      try {
        let waiting = false;
        for (let i = 0; i < 100; i++) {
          const [r] = await root.query<any[]>(
            "SELECT COUNT(*) n FROM performance_schema.data_lock_waits w JOIN performance_schema.data_locks l ON l.ENGINE_LOCK_ID=w.REQUESTING_ENGINE_LOCK_ID WHERE l.OBJECT_SCHEMA=? AND l.OBJECT_NAME='products'",
            [database]
          );
          if (Number(r[0].n)) {
            waiting = true;
            break;
          }
          await new Promise(r => setTimeout(r, 5));
        }
        expect(waiting).toBe(true);
        for (let i = 0; i < 300; i++) {
          const [r] = await root.query<any[]>(
            "SELECT expiresAt<=CURRENT_TIMESTAMP(3) expired FROM `" +
              database +
              "`.stockReservations WHERE orderId=?",
            [b.id]
          );
          if (Number(r[0].expired)) break;
          await new Promise(r => setTimeout(r, 10));
        }
      } finally {
        await c.commit();
      }
      expect((await pending).body).toMatchObject({ releaseRequired: true });
      const after=await snapshot();
      if(method === "PIX") expect(after).toEqual(before);
      else {
        expect(after.products).toEqual(before.products);expect(after.stockReservations).toEqual(before.stockReservations);expect(after.orders).toEqual(before.orders);
        expect(after.payments.find((p:any)=>p.orderId===b.id)).toMatchObject({status:"received",financialIssue:"BOLETO_RESERVATION_REVIEW_REQUIRED"});
      }
    }, 10000);
    it("preorder fulfillment is not inferred or authorized by the stock homologation gate", async () => {
      const b = await buy();
      await query(
        "UPDATE orderItems SET salesModeAtPurchase='PREORDER' WHERE orderId=?",
        [b.id]
      );
      await expect(authorize(grant(b))).rejects.toThrow();
    });
    it.each([1, 0])(
      "variant stock %s is checked atomically with the parent product",
      async remaining => {
        await query(
          "INSERT INTO productVariants(id,productId,name,stock) VALUES(999902,999901,'Synthetic variant',1)"
        );
        const b = await buy("PIX", c, [
          { productId: 999901, variantId: 999902, quantity: 1 },
        ]);
        await authorize(grant(b));
        paid(b);
        await query("UPDATE productVariants SET stock=? WHERE id=999902", [
          remaining,
        ]);
        const before = await snapshot();
        const result = await send(event(b));
        if (remaining === 0) {
          expect(result.body).toMatchObject({ releaseRequired: true });
          expect(await snapshot()).toEqual(before);
        } else {
          expect(result.status).toBe(200);
          expect(
            (
              await query("SELECT stock FROM productVariants WHERE id=999902")
            )[0].stock
          ).toBe(0);
          expect(
            (await query("SELECT stock FROM products WHERE id=999901"))[0].stock
          ).toBe(9);
        }
      }
    );
    it("rollback after variant/product debits also preserves reservation and fulfillment", async () => {
      await query(
        "INSERT INTO productVariants(id,productId,name,stock) VALUES(999902,999901,'Synthetic variant',1)"
      );
      const b = await buy("PIX", c, [
        { productId: 999901, variantId: 999902, quantity: 1 },
      ]);
      await authorize(grant(b));
      paid(b);
      const before = await snapshot();
      await query(
        "CREATE TRIGGER fail_selected_outbox BEFORE INSERT ON notificationOutbox FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='synthetic failure'"
      );
      try {
        expect((await send(event(b))).body).toMatchObject({
          releaseRequired: true,
        });
      } finally {
        await query("DROP TRIGGER fail_selected_outbox");
      }
      expect(await snapshot()).toEqual(before);
    });
    it("confirmation timestamp preserves UTC independently of host timezone serialization", async () => {
      const b = await buy();
      await authorize(grant(b));
      paid(b);
      expect((await send(event(b))).status).toBe(200);
      expect(
        Number(
          (
            await query(
              "SELECT ABS(TIMESTAMPDIFF(SECOND,paymentConfirmedAt,UTC_TIMESTAMP())) age FROM orders WHERE id=?",
              [b.id]
            )
          )[0].age
        )
      ).toBeLessThan(5);
    });
    it("CLI rejects actor/token argv and requires explicit order, charge, digest", () => {
      expect(() =>
        parseAdmissionArguments([
          "--request",
          "fixture.json",
          "--session-stdin",
          "--actor",
          "14",
        ])
      ).toThrow();
      expect(() =>
        parseAdmissionArguments([
          "--request",
          "fixture.json",
          "--session-stdin",
          "--apply",
        ])
      ).toThrow();
      expect(
        parseAdmissionArguments([
          "--request",
          "fixture.json",
          "--session-stdin",
        ]).apply
      ).toBe(false);
    });
  }
);
