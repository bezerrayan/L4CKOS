import type { Connection } from "mysql2/promise";
import { readFile, readdir } from "node:fs/promises";
import {
  TARGET,
  digest,
  type Checkpoint,
  type RecoveryRequest,
} from "../../database/financialRecovery/policy";
export async function setupWindowFixture(c: Connection) {
  await c.query("SET FOREIGN_KEY_CHECKS=0");
  for (const f of (await readdir("database/bootstrap/v2")).filter(x =>
    x.endsWith(".sql")
  )) {
    let ddl = await readFile("database/bootstrap/v2/" + f, "utf8");
    const cols =
      f === "orderItems.sql"
        ? "`estimatedManufacturingStartAtPurchase` date DEFAULT NULL,`estimatedManufacturingEndAtPurchase` date DEFAULT NULL,"
        : f === "productionBatches.sql"
          ? "`estimatedManufacturingStart` date DEFAULT NULL,`estimatedManufacturingEnd` date DEFAULT NULL,`manufacturingScheduleRequired` tinyint NOT NULL DEFAULT '1',"
          : "";
    await c.query(ddl.replace("  PRIMARY KEY", "  " + cols + " PRIMARY KEY"));
  }
  await c.query("SET FOREIGN_KEY_CHECKS=1");
  await c.query(
    await readFile("database/migrations/0023_asaas_webhook_inbox.sql", "utf8")
  );
  await c.query(await readFile("database/governance/ledger.sql", "utf8"));
  await c.query(await readFile("database/governance/executions.sql", "utf8"));
  const query = async (sql: string, values: unknown[] = []) =>
    c.query(sql, values);
  for (const table of [
    "notificationOutbox",
    "orderEmailEvents",
    "paymentEvents",
    "payments",
    "asaasWebhookInbox",
    "asaasWebhookEvents",
    "auditLogs",
    "stockReservations",
    "orderItems",
    "orders",
    "products",
    "users",
  ])
    await query("DELETE FROM `" + table + "`");
  await query(
    "INSERT INTO users(id,openId,name,email,role) VALUES(14,'synthetic-admin','Fixture Admin','admin@example.invalid','admin')"
  );
  await query(
    "INSERT INTO users(id,openId,name,email) VALUES(594,'synthetic-created-customer','STAGING RC2 synthetic','synthetic@example.invalid')"
  );
  await query(
    "INSERT INTO products(id,name,category,price,stock) VALUES(1,'STAGING RC2 synthetic','fixture',9900,98)"
  );
  await query(
    "INSERT INTO orders(id,userId,totalPrice,createdAt) VALUES(13,594,9900,DATE_SUB(NOW(),INTERVAL 2 HOUR))"
  );
  await query(
    "INSERT INTO orderItems(id,orderId,productId,productName,unitPrice,quantity,totalPrice) VALUES(14,13,1,'STAGING RC2 synthetic',9900,1,9900)"
  );
  await query(
    "INSERT INTO stockReservations(id,userId,orderId,orderItemId,productId,quantity,status,expiresAt) VALUES(10,594,13,14,1,1,'active',DATE_SUB(NOW(),INTERVAL 1 HOUR))"
  );
  await query(
    "INSERT INTO auditLogs(id,actorUserId,actorType,action,entity,entityId,metadata) VALUES(72,594,'user','checkout.charge_created','order','13',?)",
    [
      JSON.stringify({
        payment: { paymentId: "pay_dog6ppexq4gyw3k6", method: "PIX" },
      }),
    ]
  );
  for (const id of [2, 3, 6, 12])
    await query(
      "INSERT INTO orders(id,userId,totalPrice,status,paymentStatus) VALUES(?,594,9900,'paid','confirmed')",
      [id]
    );
  await query(
    "UPDATE orders SET paymentStatus='unconfirmed',fulfillmentStatus='inventory_exception' WHERE id=2"
  );
  await query(
    "UPDATE orders SET paymentConfirmationSource='manual',paymentConfirmedBy=14,paymentConfirmedAt='2026-10-11 04:47:24',fulfillmentStatus='ready' WHERE id=3"
  );
  await query(
    "UPDATE orders SET status='delivered',paymentConfirmationSource='asaas_webhook',paymentConfirmedAt='2026-10-09 02:00:53',paymentConfirmationReference='synthetic-historical-12',fulfillmentStatus='awaiting_payment' WHERE id=12"
  );
  await query(
    "INSERT INTO auditLogs(id,actorUserId,actorType,action,entity,entityId,metadata) VALUES(69,14,'admin','order.payment_confirmed_manual','order','3','{}')"
  );
  await query(
    "INSERT INTO notificationOutbox(id,dedupeKey,type,orderId,status,attempts) VALUES(1,'fixture-historical-2','payment-approved',2,'pending',0),(2,'fixture-historical-3','payment-approved',3,'pending',0)"
  );
  await query(
    "INSERT INTO orderEmailEvents(orderId,eventType,status,idempotencyKey,attemptCount,processingAt) VALUES(6,'order_delivered_email','sent','fixture-delivered-6',1,'2026-09-27 01:43:32'),(6,'review_request_email','sent','fixture-review-6',1,'2026-09-27 01:43:32')"
  );

  const payload = {
    id: TARGET.eventId,
    event: "PAYMENT_CREATED",
    payment: {
      id: TARGET.paymentId,
      externalReference: "13",
      status: "PENDING",
      value: 99,
      netValue: 98.01,
    },
    sourcePayloadHash: TARGET.sourcePayloadHash,
  };
  const hashable = { ...payload } as any;
  delete hashable.sourcePayloadHash;
  if (digest(hashable) !== TARGET.payloadHash)
    throw Error("SYNTHETIC_PAYLOAD_HASH");
  await query(
    "INSERT INTO asaasWebhookInbox(eventId,payload,payloadHash,state,attempts,errorCode,completedAt) VALUES(?,?,?,'rejected',1,'WEBHOOK_VALIDATION_REJECTED',NOW())",
    [TARGET.eventId, JSON.stringify(payload), TARGET.payloadHash]
  );

  await c.query(
    "INSERT INTO _l4ckos_schema_migrations(name,kind,checksum,applicationCommit,description,preFingerprint,postFingerprint,manifestVersion,runnerVersion,executionDurationMs) VALUES('0023_asaas_webhook_inbox','MIGRATION',?,?, 'synthetic fixture',?,?,2,'fixture',0)",
    [
      "b0b588463e5318fdc63761fd6a8261827478fe058f2152a8a630fa5fa87bae8a",
      "a".repeat(40),
      TARGET.schemaHash,
      TARGET.schemaHash,
    ]
  );
}
export const fixtureEnvironment = () => ({
  RAILWAY_PROJECT_ID: TARGET.projectId,
  RAILWAY_ENVIRONMENT_ID: TARGET.environmentId,
  RAILWAY_SERVICE_ID: TARGET.serviceId,
  RAILWAY_DEPLOYMENT_ID: TARGET.deploymentId,
  ASAAS_API_URL: "https://api-sandbox.asaas.com/v3",
  ASAAS_CHECKOUT_BASE_URL: "https://sandbox.asaas.com",
  ASAAS_API_KEY: "$aact_hmlg_synthetic",
  DATABASE_URL:
    "mysql://fixture:synthetic@mysql.railway.internal/l4ckos_staging",
});
export function fixtureExecute(checkpoint: Checkpoint): RecoveryRequest {
  return {
    operation: "financial-b",
    mode: "execute",
    checkpoint,
    approval: {
      operation: "financial-b",
      projectId: TARGET.projectId,
      environmentId: TARGET.environmentId,
      serviceId: TARGET.serviceId,
      deploymentId: TARGET.deploymentId,
      artifactHash: checkpoint.artifactHash,
      checkpointHash: digest(checkpoint),
      reference: "LOCAL_APPROVAL_FIN13",
      actorUserId: 14,
      justification:
        "Synthetic integrated recovery: expired reserve, unknown historical receipt time",
      validFrom: new Date(Date.now() - 1000).toISOString(),
      validUntil: new Date(Date.now() + 60000).toISOString(),
      confirmation: "AUTHORIZE_ONE_STAGING_OPERATION_ONLY",
      expiredReservationException: true,
      unknownFinancialReceiptTime: true,
      createdRetryMayAck: false,
      pendingNotificationIntent: "create-one-order13",
      notificationDispatch: false,
      queueResume: false,
      writersQuiesced: true,
      dispatchersQuiesced: true,
      backupRestoreReference: "LOCAL_RESTORE_PROVEN",
      financialReceiptHash: null,
    },
  };
}
