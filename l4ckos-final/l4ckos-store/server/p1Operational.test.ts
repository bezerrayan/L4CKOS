import mysql, { type Connection } from "mysql2/promise";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  confirmManualPayment,
  getOrdersByFilters,
  processAsaasPaymentEvent,
  releaseExpiredStockReservations,
  resolveInventoryException,
  setOrderAdminData,
} from "./db";
import { buildCheckoutFingerprint } from "./services/checkoutIntegrity";
import { createCheckoutOrderAtomically } from "./db";
import { projectLegacyOrderStatus, transitionPaymentStatus } from "./services/orderStateMachine";
import { runNotificationOutbox } from "./jobs/notificationOutboxWorker";
import { runPaymentReconciliation } from "./jobs/paymentReconciliation";

const testDatabaseUrl = process.env.TEST_DATABASE_URL?.trim() || "";
const canRun = /(?:^|[/:_-])test(?:[/?_-]|$)/i.test(testDatabaseUrl);
let connection: Connection;

async function clean() {
  for (const table of ["notificationOutbox", "paymentEvents", "payments", "stockReservations", "orderItems", "orders", "productVariants", "products", "coupons", "auditLogs", "users"]) {
    await connection.query(`DELETE FROM \`${table}\``);
  }
}

async function seed(stock = 1, couponCode?: string) {
  const [user] = await connection.query<any>("INSERT INTO users (openId,name,email,role) VALUES (?,?,?,'admin')", [`p1-${crypto.randomUUID()}`, "Cliente P1", `p1-${crypto.randomUUID()}@example.test`]);
  const [product] = await connection.query<any>("INSERT INTO products (name,category,price,stock) VALUES ('Produto P1','teste',10000,?)", [stock]);
  const userId = Number(user.insertId);
  const productId = Number(product.insertId);
  const checkoutAttemptId = crypto.randomUUID();
  const items = [{ productId, variantId: null, quantity: 1 }];
  const checkout = await createCheckoutOrderAtomically({
    userId,
    checkoutAttemptId,
    checkoutFingerprint: buildCheckoutFingerprint({ userId, method: "PIX", items, shipping: { cep: "70000000", optionId: "local" }, shippingAddress: { recipient: "Cliente P1" } }),
    method: "PIX",
    items,
    shippingCents: 0,
    couponCode,
    shippingAddress: { recipient: "Cliente P1", zipCode: "70000000", street: "Rua", number: "1", neighborhood: "Centro", city: "Brasília", state: "DF" },
  });
  await connection.query("UPDATE payments SET providerPaymentId=? WHERE id=?", [`pay_${checkout.payment!.id}`, checkout.payment!.id]);
  return { ...checkout, userId, productId, providerPaymentId: `pay_${checkout.payment!.id}` };
}

function event(checkout: Awaited<ReturnType<typeof seed>>, eventType: string, suffix = crypto.randomUUID(), extra: Record<string, unknown> = {}) {
  return processAsaasPaymentEvent({
    providerEventId: `evt-${suffix}`,
    eventType,
    providerPaymentId: checkout.providerPaymentId,
    externalReference: checkout.payment!.externalReference,
    amountCents: checkout.payment!.amount,
    sanitizedPayload: "{}",
    ...extra,
  });
}

async function paid(checkout: Awaited<ReturnType<typeof seed>>) {
  await event(checkout, "PAYMENT_RECEIVED");
}

async function row(table: string, id: number) {
  const [rows] = await connection.query<any[]>(`SELECT * FROM \`${table}\` WHERE id=?`, [id]);
  return rows[0];
}

describe.skipIf(!canRun)("P1 operational reliability (MySQL integration)", () => {
  beforeAll(async () => { connection = await mysql.createConnection(testDatabaseUrl); });
  beforeEach(clean);

  it("01 transição financeira válida", async () => { const c = await seed(); await event(c, "PAYMENT_CONFIRMED"); expect((await row("payments", c.payment!.id)).status).toBe("confirmed"); });
  it("02 transição financeira inválida", () => { expect(transitionPaymentStatus("refunded", "overdue", { source: "webhook" }).decision).toBe("invalid"); });
  it("03 evento antigo não rebaixa", async () => { const c = await seed(); await paid(c); await event(c, "PAYMENT_CONFIRMED"); expect((await row("payments", c.payment!.id)).status).toBe("received"); });
  it("04 refund total persiste valores e repõe antes da separação", async () => { const c = await seed(); await paid(c); await event(c, "PAYMENT_REFUNDED"); const p=await row("payments",c.payment!.id); expect([p.status,p.refundedAmount,p.netAmount]).toEqual(["refunded",10000,0]); expect((await row("products",c.productId)).stock).toBe(1); });
  it("05 refund total duplicado é idempotente", async () => { const c=await seed(); await paid(c); const id="refund-dup"; await event(c,"PAYMENT_REFUNDED",id); await event(c,"PAYMENT_REFUNDED",id); const [rows]=await connection.query<any[]>("SELECT * FROM paymentEvents WHERE providerEventId='evt-refund-dup'"); expect(rows).toHaveLength(1); });
  it("06 refund parcial mantém saldo líquido", async () => { const c=await seed(); await paid(c); await event(c,"PAYMENT_PARTIALLY_REFUNDED","partial",{refundedAmountCents:2000}); const p=await row("payments",c.payment!.id); expect([p.status,p.paidAmount,p.refundedAmount,p.netAmount]).toEqual(["partially_refunded",10000,2000,8000]); });
  it("07 dois refunds parciais atualizam acumulado", async () => { const c=await seed(); await paid(c); await event(c,"PAYMENT_PARTIALLY_REFUNDED","p1",{refundedAmountCents:2000}); await event(c,"PAYMENT_PARTIALLY_REFUNDED","p2",{refundedAmountCents:3500}); expect((await row("payments",c.payment!.id)).refundedAmount).toBe(3500); });
  it("08 refund maior que pago é rejeitado", async () => { const c=await seed(); await paid(c); const r=await event(c,"PAYMENT_PARTIALLY_REFUNDED","excess",{refundedAmountCents:12000}); expect(r.conflict).toBe(true); expect((await row("payments",c.payment!.id)).financialIssue).toBe("REFUND_EXCEEDS_PAID_AMOUNT"); });
  it("09 chargeback antes do envio bloqueia fulfillment", async () => { const c=await seed(); await paid(c); await event(c,"PAYMENT_CHARGEBACK_REQUESTED"); const o=await row("orders",c.order.id); expect([o.fulfillmentStatus,o.fulfillmentIssue]).toEqual(["on_hold","CHARGEBACK"]); });
  it("10 chargeback depois do envio registra problema sem estoque", async () => { const c=await seed(); await paid(c); await setOrderAdminData(c.order.id,{status:"processing",actorUserId:c.userId}); await setOrderAdminData(c.order.id,{status:"shipped",actorUserId:c.userId}); await event(c,"PAYMENT_CHARGEBACK_REQUESTED"); const o=await row("orders",c.order.id); expect([o.fulfillmentStatus,o.fulfillmentIssue]).toEqual(["shipped","CHARGEBACK_AFTER_SHIPMENT"]); expect((await row("products",c.productId)).stock).toBe(0); });
  it("11 pagamento recusado fica failed e não libera imediatamente", async () => { const c=await seed(); await event(c,"PAYMENT_CREDIT_CARD_CAPTURE_REFUSED"); expect((await row("payments",c.payment!.id)).status).toBe("failed"); expect((await row("stockReservations",(await connection.query<any[]>("SELECT id FROM stockReservations WHERE orderId=?",[c.order.id]))[0][0].id)).status).toBe("active"); });
  it("12 pagamento vencido continua recuperável", async () => { const c=await seed(); await event(c,"PAYMENT_OVERDUE"); await paid(c); expect((await row("payments",c.payment!.id)).status).toBe("received"); });
  it("13 cancelamento não pago libera reserva", async () => { const c=await seed(); await setOrderAdminData(c.order.id,{status:"cancelled",actorUserId:c.userId}); expect((await row("products",c.productId)).stock).toBe(1); expect((await row("orders",c.order.id)).fulfillmentStatus).toBe("cancelled"); });
  it("14 cancelamento pago exige resolução financeira", async () => { const c=await seed(); await paid(c); await expect(setOrderAdminData(c.order.id,{status:"cancelled",actorUserId:c.userId})).rejects.toThrow("CANCELLATION_REQUIRES_FINANCIAL_RESOLUTION"); });
  it("15 cancelamento enviado é bloqueado", async () => { const c=await seed(); await paid(c); await setOrderAdminData(c.order.id,{status:"processing",actorUserId:c.userId}); await setOrderAdminData(c.order.id,{status:"shipped",actorUserId:c.userId}); await expect(setOrderAdminData(c.order.id,{status:"cancelled",actorUserId:c.userId})).rejects.toThrow("CANCELLATION_BLOCKED_AFTER_SHIPMENT"); });
  it("16 expiração libera reserva", async () => { const c=await seed(); await connection.query("UPDATE stockReservations SET expiresAt=DATE_SUB(NOW(),INTERVAL 1 MINUTE) WHERE orderId=?",[c.order.id]); const r=await releaseExpiredStockReservations(new Date()); expect(r.released).toBe(1); expect((await row("products",c.productId)).stock).toBe(1); });
  it("17 dois jobs de expiração não devolvem duas vezes", async () => { const c=await seed(); await connection.query("UPDATE stockReservations SET expiresAt=DATE_SUB(NOW(),INTERVAL 1 MINUTE) WHERE orderId=?",[c.order.id]); await Promise.all([releaseExpiredStockReservations(new Date()),releaseExpiredStockReservations(new Date())]); expect((await row("products",c.productId)).stock).toBe(1); });
  it("18 outbox envia uma vez", async () => { const c=await seed(); await paid(c); let sends=0; await runNotificationOutbox({workerId:"w1",send:async()=>{sends++;}}); await runNotificationOutbox({workerId:"w2",send:async()=>{sends++;}}); expect(sends).toBe(1); });
  it("19 workers concorrentes não duplicam envio", async () => { const c=await seed(); await paid(c); let sends=0; await Promise.all([runNotificationOutbox({workerId:"wa",send:async()=>{sends++;}}),runNotificationOutbox({workerId:"wb",send:async()=>{sends++;}})]); expect(sends).toBe(1); });
  it("20 retry da outbox agenda próxima tentativa", async () => { const c=await seed(); await paid(c); await runNotificationOutbox({workerId:"wf",send:async()=>{throw new Error("smtp")}}); const [rows]=await connection.query<any[]>("SELECT status,attempts,nextAttemptAt FROM notificationOutbox WHERE paymentId=?",[c.payment!.id]); expect([rows[0].status,rows[0].attempts]).toEqual(["failed",1]); expect(rows[0].nextAttemptAt).toBeTruthy(); });
  it("21 máximo de retry vira dead", async () => { const c=await seed(); await paid(c); await connection.query("UPDATE notificationOutbox SET attempts=4 WHERE paymentId=?",[c.payment!.id]); await runNotificationOutbox({workerId:"wd",maxAttempts:5,send:async()=>{throw new Error("smtp")}}); expect((await connection.query<any[]>("SELECT status FROM notificationOutbox WHERE paymentId=?",[c.payment!.id]))[0][0].status).toBe("dead"); });
  it("22 inventory_exception aparece na API administrativa", async () => { const c=await seed(); await connection.query("UPDATE stockReservations SET status='expired' WHERE orderId=?",[c.order.id]); await paid(c); const rows=await getOrdersByFilters(); expect(rows.find(o=>o.id===c.order.id)?.fulfillmentStatus).toBe("inventory_exception"); });
  it("23 exceção é resolvida após reposição atômica", async () => { const c=await seed(); await connection.query("UPDATE stockReservations SET status='expired' WHERE orderId=?",[c.order.id]); await paid(c); await connection.query("UPDATE products SET stock=1 WHERE id=?",[c.productId]); const r=await resolveInventoryException({orderId:c.order.id,actorUserId:c.userId,action:"stock_replenished",note:"contagem física confirmada"}); expect(r.fulfillmentStatus).toBe("ready"); expect((await row("products",c.productId)).stock).toBe(0); });
  it("24 admin não falsifica pagamento Asaas pelo status legado", async () => { const c=await seed(); await expect(setOrderAdminData(c.order.id,{status:"paid",actorUserId:c.userId})).rejects.toThrow("ADMIN_FINANCIAL_STATUS_FORBIDDEN"); });
  it("25 pagamento manual deixa origem e evidência", async () => { const c=await seed(); await confirmManualPayment({orderId:c.order.id,actorUserId:c.userId,amount:10000,reason:"recebimento presencial confirmado",evidence:"recibo caixa 123"}); const p=await row("payments",c.payment!.id); expect([p.status,p.statusSource,p.manualEvidence]).toEqual(["received","manual","recibo caixa 123"]); });
  it("26 webhook refund duplicado não duplica outbox", async () => { const c=await seed(); await paid(c); await event(c,"PAYMENT_REFUNDED","rd"); await event(c,"PAYMENT_REFUNDED","rd"); const [rows]=await connection.query<any[]>("SELECT * FROM notificationOutbox WHERE type='payment-refunded' AND paymentId=?",[c.payment!.id]); expect(rows).toHaveLength(1); });
  it("27 webhook chargeback duplicado não duplica efeitos", async () => { const c=await seed(); await paid(c); await event(c,"PAYMENT_CHARGEBACK_REQUESTED","cd"); await event(c,"PAYMENT_CHARGEBACK_REQUESTED","cd"); const [rows]=await connection.query<any[]>("SELECT * FROM paymentEvents WHERE providerEventId='evt-cd'"); expect(rows).toHaveLength(1); });
  it("28 reconciliação atualiza pendente", async () => { const c=await seed(); const r=await runPaymentReconciliation({fetchPayment:async()=>({id:c.providerPaymentId,status:"RECEIVED",externalReference:c.payment!.externalReference,value:100})}); expect(r.updated).toBe(1); expect((await row("payments",c.payment!.id)).status).toBe("received"); });
  it("29 webhook e reconciliação concorrentes convergem", async () => { const c=await seed(); await Promise.all([paid(c),runPaymentReconciliation({fetchPayment:async()=>({id:c.providerPaymentId,status:"RECEIVED",externalReference:c.payment!.externalReference,value:100})})]); expect((await row("payments",c.payment!.id)).status).toBe("received"); expect((await row("products",c.productId)).stock).toBe(0); });
  it("30 divergência financeira bloqueia fulfillment", async () => { const c=await seed(); const r=await event(c,"PAYMENT_RECEIVED","mismatch",{amountCents:9900}); expect(r.conflict).toBe(true); const o=await row("orders",c.order.id); expect([o.fulfillmentStatus,o.fulfillmentIssue]).toEqual(["on_hold","FINANCIAL_EXCEPTION"]); });
  it("31 sequência fora de ordem preserva terminal", async () => { const c=await seed(); await paid(c); await event(c,"PAYMENT_REFUNDED"); await event(c,"PAYMENT_CONFIRMED"); expect((await row("payments",c.payment!.id)).status).toBe("refunded"); });
  it("32 projection legado é consistente", async () => { const c=await seed(); await paid(c); const o=await row("orders",c.order.id); expect(o.status).toBe(projectLegacyOrderStatus("received",o.fulfillmentStatus)); });
  it("33 expiração cancela pedido e libera cupom uma vez", async () => { await connection.query("INSERT INTO coupons (code,type,value,maxUses,usedCount,isActive) VALUES ('P1CUPOM','fixed',10,10,0,1)"); const c=await seed(1,"P1CUPOM"); await connection.query("UPDATE stockReservations SET expiresAt=DATE_SUB(NOW(),INTERVAL 1 MINUTE) WHERE orderId=?",[c.order.id]); await Promise.all([releaseExpiredStockReservations(new Date()),releaseExpiredStockReservations(new Date())]); const [coupon]=await connection.query<any[]>("SELECT usedCount FROM coupons WHERE code='P1CUPOM'"); expect(coupon[0].usedCount).toBe(0); expect((await row("orders",c.order.id)).fulfillmentStatus).toBe("cancelled"); });
});
