import { assertCheckoutMethodEnabled } from "../../shared/checkoutMethods";
import { normalizeBuyerDocument } from "../../shared/buyerDocument";
import { stagingFinancialScope, assertSelectiveFinancialBuyer } from "../payments/stagingFinancialBuyer";
import { formatCurrency } from "../utils/email/formatCurrency.js";
import { batchAcceptsSales, civilDate, manufacturingEstimate, shippingEstimate, type BatchPreview } from "../../shared/preorder";
import { CAPACITY_SQL } from "./productionBatches";
import { createHash } from "node:crypto";
import type { Connection, RowDataPacket, ResultSetHeader } from "mysql2/promise";
import { z } from "zod";
import { orderItemMoney } from "./orderItemMoney";
import { DEFAULT_COLORS, DEFAULT_SIZES } from "../../shared/catalogOptions";
import type { createAsaasChargeForOrder } from "../services/asaas";
import {captureRecoveryFence} from '../payments/webhookRecovery';
import {CANDIDATE,candidateMetadata} from '../payments/stagingCheckoutAdmission';
import { assertPublicCheckoutEnabled } from "../_core/publicStore";
import { createVariantOptionKey, normalizeVariantLabel } from "./productVariantIdentity";
import { isRestrictedPublicPurchase } from "./publicPurchasePolicy";

export const checkoutItemSchema = z.object({
  productId: z.number().int().positive(),
  variantId: z.number().int().positive().optional(),
  size: z.string().trim().min(1).max(60).optional(),
  color: z.string().trim().min(1).max(60).optional(),
  quantity: z.number().int().positive().max(99),
}).strict();
export type CheckoutItem = z.infer<typeof checkoutItemSchema>;
type Address = { recipient: string; zipCode: string; street: string; number: string; complement?: string; neighborhood: string; city: string; state: string };
export type CheckoutInput = {
  userId: number; checkoutAttemptId: string; items: CheckoutItem[];
  method: "PIX" | "BOLETO" | "CARD"; shipping: { cep: string; optionId: string };
  shippingAddress: Address; couponCode?: string; dueDate?: string;
  customer: { name: string; cpfCnpj: string; email?: string };
};
type Charge = Awaited<ReturnType<typeof createAsaasChargeForOrder>>;
type Snapshot = { estimatedManufacturingStartAtPurchase: string | null; estimatedManufacturingEndAtPurchase: string | null; salesModeAtPurchase: "STOCK" | "PREORDER"; productionBatchId: number | null; productionBatchNameAtPurchase: string | null; estimatedShippingStartAtPurchase: string | null; estimatedShippingEndAtPurchase: string | null; productId: number; variantId: number | null; productName: string; variantName: string | null; sku: string | null; size: string | null; color: string | null; imageUrl: string | null; quantity: number; unitPrice: number; totalPrice: number };
export class CheckoutError extends Error { constructor(public code: string) { super(code); } }
function fail(code: string): never { throw new CheckoutError(code); }
export type CheckoutVariantRow = {
  id: number;
  productId: number;
  name?: string | null;
  isActive: number;
  color: string | null;
  size: string | null;
  sku: string | null;
  optionKey: string | null;
  price: number | null;
};
export function resolveCheckoutVariant(item: CheckoutItem, productId: number, productName: string, variants: CheckoutVariantRow[]) {
  const productVariants = variants.filter(variant => Number(variant.productId) === productId);
  let variant = item.variantId === undefined ? null : variants.find(candidate => Number(candidate.id) === item.variantId) ?? null;
  if (isRestrictedPublicPurchase(productName, variant?.sku)) fail("CHECKOUT_PRODUCT_REQUIRES_AUTHORIZATION");
  if (productVariants.length > 0 && item.variantId === undefined) fail("CHECKOUT_VARIANT_REQUIRED");
  if (item.variantId !== undefined && !variant) fail("CHECKOUT_VARIANT_NOT_FOUND");
  if (variant && Number(variant.productId) !== productId) fail("CHECKOUT_VARIANT_OWNERSHIP");
  if (!variant) return null;
  if (Number(variant.isActive) !== 1) fail("CHECKOUT_VARIANT_INACTIVE");
  const color = normalizeVariantLabel(String(variant.color ?? ""));
  const size = normalizeVariantLabel(String(variant.size ?? ""));
  const sku = String(variant.sku ?? "").trim();
  if (!color || !size || !sku || !variant.optionKey || variant.optionKey !== createVariantOptionKey(color, size)) fail("CHECKOUT_VARIANT_IDENTITY_INVALID");
  const normalizedSku = sku.normalize("NFKC").toLowerCase();
  if (productVariants.some(candidate => Number(candidate.id) !== Number(variant.id) &&
    String(candidate.sku ?? "").normalize("NFKC").trim().toLowerCase() === normalizedSku)) fail("CHECKOUT_VARIANT_SKU_DUPLICATE");
  if (!item.color || !item.size || normalizeVariantLabel(item.color) !== color || normalizeVariantLabel(item.size) !== size) fail("CHECKOUT_VARIANT_DIMENSIONS_MISMATCH");
  return variant;
}
const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const cents = (value: number) => { if (!Number.isSafeInteger(value) || value < 0 || value > 2_147_483_647) fail("CHECKOUT_MONEY_INVALID"); return value; };
const utcTime = (value: Date | string) => value instanceof Date ? value.getTime() : Date.parse(value.replace(" ","T")+(/Z$|[+-]\d\d:\d\d$/.test(value)?"":"Z"));
async function rows(c: Connection, sql: string, values: unknown[] = []) { return (await c.query<RowDataPacket[]>(sql, values))[0]; }
async function insert(c: Connection, sql: string, values: unknown[]) { return (await c.query<ResultSetHeader>(sql, values))[0].insertId; }

/** Reads authoritative catalog data, sorted locks also serialize stock claims across attempts. */
async function snapshots(c: Connection, items: CheckoutItem[], lock: boolean): Promise<Snapshot[]> {
  const products = new Map<number, RowDataPacket>();
  for (const id of [...new Set(items.map(i => i.productId))].sort((a,b) => a-b)) {
    const product = (await rows(c, `SELECT * FROM products WHERE id=?${lock ? " FOR UPDATE" : ""}`, [id]))[0];
    if (!product) fail("CHECKOUT_PRODUCT_NOT_FOUND"); products.set(id, product);
  }
  const variants = new Map<number, RowDataPacket>();
  for (const id of [...products.keys()].sort((a,b) => a-b)) {
    for (const variant of await rows(c, `SELECT * FROM productVariants WHERE productId=? ORDER BY id${lock ? " FOR UPDATE" : ""}`, [id])) variants.set(variant.id, variant);
  }
  const assignments = new Map<number, number>();
  for (const product of products.values()) {
    if (!['STOCK','PREORDER'].includes(product.salesMode)) fail("CHECKOUT_SALES_MODE_INVALID");
    if (product.salesMode !== 'PREORDER') continue;
    const assignment=(await rows(c,"SELECT productionBatchId FROM productionBatchProducts WHERE productId=?",[product.id]))[0];
    if(!assignment) fail("CHECKOUT_BATCH_REQUIRED");
    assignments.set(product.id,Number(assignment.productionBatchId));
  }
  const batches=new Map<number,RowDataPacket>();
  for(const id of [...new Set(assignments.values())].sort((a,b)=>a-b)) {
    const batch=(await rows(c,`SELECT * FROM productionBatches WHERE id=?${lock ? " FOR UPDATE" : ""}`,[id]))[0];
    if(!batch || !batchAcceptsSales(batch as BatchPreview)) fail("CHECKOUT_BATCH_UNAVAILABLE");
    batches.set(id,batch);
  }
  const iso=(value: Date | string | null): string | null => value ? new Date(utcTime(value)).toISOString() : null;
  return items.map(item => {
    const product = products.get(item.productId)!;
    const variant = resolveCheckoutVariant(item, Number(product.id), String(product.name), [...variants.values()] as CheckoutVariantRow[]);
    const options = (raw: unknown, fallback: string[]) => {
      try { const list=JSON.parse(String(raw));return Array.isArray(list)&&list.length ? list : fallback; } catch { return fallback; }
    };
    if (!variant && ((item.size && !options(product.optionSizes,DEFAULT_SIZES).includes(item.size)) || (item.color && !options(product.optionColors,DEFAULT_COLORS).includes(item.color)))) fail("CHECKOUT_OPTION_INVALID");
    const money = orderItemMoney(Number(variant?.price ?? product.price), item.quantity);
    const batch=batches.get(assignments.get(product.id) ?? 0);
    return { salesModeAtPurchase: product.salesMode, productionBatchId: batch ? Number(batch.id) : null,
      productionBatchNameAtPurchase: batch?.name ?? null,
      estimatedManufacturingStartAtPurchase: civilDate(batch?.estimatedManufacturingStart),
      estimatedManufacturingEndAtPurchase: civilDate(batch?.estimatedManufacturingEnd),
      estimatedShippingStartAtPurchase: iso(batch?.estimatedShippingStart ?? null),
      estimatedShippingEndAtPurchase: iso(batch?.estimatedShippingEnd ?? null), productId: product.id, variantId: variant?.id ?? null, productName: product.name, variantName: variant?.name ?? null,
      sku: variant?.sku ?? null, size: variant?.size ?? item.size ?? null, color: variant?.color ?? item.color ?? null, imageUrl: product.imageUrl ?? null, ...money };
  });
}
export async function previewCheckoutItems(c: Connection, items: CheckoutItem[]) {
  return snapshots(c,items.map(item=>checkoutItemSchema.parse(item)),false);
}
async function checkStock(c: Connection, items: Snapshot[]) {
  for (const id of [...new Set(items.filter(item => item.variantId === null).map(i => i.productId))]) {
    const quantity = items.filter(i => i.productId === id && i.variantId === null).reduce((n,i) => n+i.quantity,0);
    const stock = Number((await rows(c, "SELECT stock FROM products WHERE id=?", [id]))[0].stock);
    const reserved = Number((await rows(c, "SELECT COALESCE(SUM(quantity),0) n FROM stockReservations WHERE productId=? AND variantId IS NULL AND status='active' AND expiresAt>NOW()", [id]))[0].n);
    if (quantity > stock-reserved) fail("CHECKOUT_STOCK_INSUFFICIENT");
  }
  for (const id of [...new Set(items.flatMap(i => i.variantId !== null ? [i.variantId] : []))]) {
    const quantity = items.filter(i => i.variantId === id).reduce((n,i) => n+i.quantity,0);
    const stockRow = (await rows(c, "SELECT stock FROM productVariants WHERE id=? FOR UPDATE", [id]))[0];
    if (!stockRow) fail("CHECKOUT_VARIANT_NOT_FOUND");
    const stock = Number(stockRow.stock);
    const reserved = Number((await rows(c, "SELECT COALESCE(SUM(quantity),0) n FROM stockReservations WHERE variantId=? AND status='active' AND expiresAt>NOW()", [id]))[0].n);
    if (quantity > stock-reserved) fail("CHECKOUT_STOCK_INSUFFICIENT");
  }
}
export function orderTotal(subtotal: number, shipping: number, coupon?: { type: string; value: number }) {
  const gross = cents(cents(subtotal)+cents(shipping));
  // Existing rule: fixed coupon value is in reais; percent applies to items + shipping.
  let discount = 0;
  if (coupon) {
    if (!Number.isSafeInteger(coupon.value) || coupon.value < 0) fail("CHECKOUT_COUPON_INVALID");
    discount = coupon.type === "percent" ? Number((BigInt(gross)*BigInt(coupon.value)+50n)/100n) : coupon.value*100;
  }
  return { totalPrice: cents(Math.max(0,gross-Math.min(gross,discount))), discountCents: Math.min(gross,discount) };
}

export type CheckoutAdapters = {
  quote: (input: { cep: string; itemCount: number; subtotal: number }) => Promise<{ options: { id: string; label: string; price: number; minDays?: number | null; maxDays?: number | null }[] }>;
  charge: typeof createAsaasChargeForOrder;
};
/** Caller owns the dedicated connection. Only the advisory attempt lock spans provider IO. */
export async function checkout(c: Connection, input: CheckoutInput, adapters: CheckoutAdapters) {
  assertCheckoutMethodEnabled(input.method);
  // This runs before the idempotency lookup: closed or checkout-disabled
  // deployments must not return an old payment URL to a public caller.
  assertPublicCheckoutEnabled();
  if (!Number.isInteger(input.userId) || input.userId <= 0 || !z.string().uuid().safeParse(input.checkoutAttemptId).success || !input.items.length) fail("CHECKOUT_INPUT_INVALID");
  if (!normalizeBuyerDocument(input.customer.cpfCnpj)) fail("CHECKOUT_DOCUMENT_INVALID");
  if (stagingFinancialScope()) {
    const buyer = (await rows(c, "SELECT email,isBlocked FROM users WHERE id=?", [input.userId]))[0];
    if (!buyer || buyer.isBlocked || String(buyer.email || "").trim().toLowerCase() !== String(input.customer.email || "").trim().toLowerCase()) fail("CHECKOUT_BUYER_INVALID");
    assertSelectiveFinancialBuyer(buyer.email, false, input.method);
  }
  if (!input.shipping || !input.shippingAddress || input.shipping.cep !== input.shippingAddress.zipCode || !/^\d{8}$/.test(input.shipping.cep)) fail("CHECKOUT_SHIPPING_INVALID");
  const items = input.items.map(i => checkoutItemSchema.parse(i));
  const fingerprint = hash({ ...input, items });
  const attempt = hash([input.userId,input.checkoutAttemptId]);
  const lock = "l4ckos_checkout_"+attempt.slice(0,40);
  let acquired = false, transaction = false, orderId = 0, couponId: number | null = null;
  try {
    acquired = Number((await rows(c,"SELECT GET_LOCK(?, 2) acquired",[lock]))[0].acquired) === 1;
    if (!acquired) fail("CHECKOUT_ATTEMPT_BUSY");
    await c.query("SET time_zone='+00:00'");
    const existing = (await rows(c,"SELECT id,checkoutFingerprint,status FROM orders WHERE checkoutAttemptId=?",[attempt]))[0];
    if (existing) {
      if (existing.status === 'cancelled') fail("CHECKOUT_ORDER_CANCELLED");
      if (existing.checkoutFingerprint !== fingerprint) fail("CHECKOUT_ATTEMPT_CHANGED");
      const event = (await rows(c,"SELECT metadata FROM auditLogs WHERE entity='order' AND entityId=? AND action='checkout.charge_created' ORDER BY id LIMIT 1",[String(existing.id)]))[0];
      if (!event) fail("CHECKOUT_RECOVERY_REQUIRED");
      const saved = JSON.parse(event.metadata) as { payment: Charge; totalPrice: number; items: Snapshot[]; description: string };
      if (saved.items.some(item => item.salesModeAtPurchase === "PREORDER")) fail("CHECKOUT_PREORDER_DISABLED");
      return { orderId: Number(existing.id), ...saved, replayed: true };
    }
    const quoted = await snapshots(c, items, false);
    if (quoted.some(item => item.salesModeAtPurchase === "PREORDER")) fail("CHECKOUT_PREORDER_DISABLED");
    const subtotal = cents(quoted.reduce((n,i) => n+i.totalPrice,0));
    const quote = await adapters.quote({ cep: input.shipping.cep, itemCount: items.reduce((n,i)=>n+i.quantity,0), subtotal: subtotal/100 });
    const option = quote.options.find(o => o.id === input.shipping.optionId);
    if (!option || !Number.isFinite(option.price) || option.price < 0) fail("CHECKOUT_SHIPPING_INVALID");
    const shippingCents = cents(Math.round(option.price*100));
    await c.query("SET TRANSACTION ISOLATION LEVEL READ COMMITTED");
    await c.beginTransaction(); transaction = true;
    const frozen = await snapshots(c,items,true);
    if (hash(frozen) !== hash(quoted)) fail("CHECKOUT_CATALOG_CHANGED");
    if (frozen.some(item => item.salesModeAtPurchase === "PREORDER")) fail("CHECKOUT_PREORDER_DISABLED");
    await checkStock(c,frozen.filter(item=>item.salesModeAtPurchase==='STOCK'));
    for(const batchId of [...new Set(frozen.flatMap(i=>i.productionBatchId ? [i.productionBatchId] : []))].sort((a,b)=>a-b)) {
      const batch=(await rows(c,"SELECT maximumQuantity FROM productionBatches WHERE id=?",[batchId]))[0];
      if(batch.maximumQuantity===null) continue;
      const claimed=Number((await rows(c,CAPACITY_SQL,[batchId]))[0].n);
      const requested=frozen.filter(i=>i.productionBatchId===batchId).reduce((n,i)=>n+i.quantity,0);
      if(claimed+requested>Number(batch.maximumQuantity)) fail("CHECKOUT_BATCH_CAPACITY_EXCEEDED");
    }
    let coupon: RowDataPacket | undefined;
    if (input.couponCode) {
      coupon = (await rows(c,"SELECT * FROM coupons WHERE code=? FOR UPDATE",[input.couponCode.trim().toUpperCase()]))[0];
      const now = Date.now();
      if (!coupon || coupon.isActive!==1 || (coupon.startsAt && utcTime(coupon.startsAt)>now) || (coupon.expiresAt && utcTime(coupon.expiresAt)<now) || (coupon.maxUses!==null && coupon.usedCount>=coupon.maxUses)) fail("CHECKOUT_COUPON_INVALID");
      // Pending, complete attempts reserve quota without counting as a successful
      // coupon use. The success transaction swaps this claim for usedCount.
      const pending = Number((await rows(c,"SELECT COUNT(*) n FROM orders o WHERE couponId=? AND EXISTS (SELECT 1 FROM auditLogs a WHERE a.entity='order' AND a.entityId=CAST(o.id AS CHAR) AND a.action='checkout.created') AND NOT EXISTS (SELECT 1 FROM auditLogs a WHERE a.entity='order' AND a.entityId=CAST(o.id AS CHAR) AND a.action='checkout.charge_created')",[coupon.id]))[0].n);
      if(coupon.maxUses!==null && coupon.usedCount+pending>=coupon.maxUses) fail("CHECKOUT_COUPON_INVALID");
      couponId=coupon.id;
    }
    const { totalPrice, discountCents } = orderTotal(subtotal,shippingCents,coupon ? {type:coupon.type,value:coupon.value} : undefined);
    const address = input.shippingAddress;
    orderId = await insert(c,"INSERT INTO orders (userId,totalPrice,checkoutAttemptId,checkoutFingerprint,couponId,shippingRecipient,shippingZipCode,shippingStreet,shippingNumber,shippingComplement,shippingNeighborhood,shippingCity,shippingState) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)",[input.userId,totalPrice,attempt,fingerprint,coupon?.id??null,address.recipient,address.zipCode,address.street,address.number,address.complement??null,address.neighborhood,address.city,address.state]);
    if(captureRecoveryFence().reviewOnly){
      const metadata=candidateMetadata({orderId,userId:input.userId,attempt,fingerprint,method:input.method});
      await insert(c,"INSERT INTO auditLogs(actorType,action,entity,entityId,metadata) VALUES('system',?,'order',?,?)",[CANDIDATE,String(orderId),JSON.stringify(metadata)]);
    }
    for (const item of frozen) {
      const itemId = await insert(c,"INSERT INTO orderItems (orderId,productId,variantId,productName,variantName,sku,size,color,imageUrl,quantity,unitPrice,totalPrice,salesModeAtPurchase,productionBatchId,productionBatchNameAtPurchase,estimatedShippingStartAtPurchase,estimatedShippingEndAtPurchase,estimatedManufacturingStartAtPurchase,estimatedManufacturingEndAtPurchase) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",[orderId,item.productId,item.variantId,item.productName,item.variantName,item.sku,item.size,item.color,item.imageUrl,item.quantity,item.unitPrice,item.totalPrice,item.salesModeAtPurchase,item.productionBatchId,item.productionBatchNameAtPurchase,item.estimatedShippingStartAtPurchase ? new Date(item.estimatedShippingStartAtPurchase) : null,item.estimatedShippingEndAtPurchase ? new Date(item.estimatedShippingEndAtPurchase) : null,item.estimatedManufacturingStartAtPurchase,item.estimatedManufacturingEndAtPurchase]);
      if(item.salesModeAtPurchase==='STOCK') await insert(c,"INSERT INTO stockReservations (orderId,userId,productId,variantId,orderItemId,quantity,status,expiresAt) VALUES (?,?,?,?,?,?,'active',DATE_ADD(NOW(),INTERVAL 20 MINUTE))",[orderId,input.userId,item.productId,item.variantId,itemId,item.quantity]);
    }
    await insert(c,"INSERT INTO payments(orderId,provider,billingType,amount,creationStatus,externalReference) VALUES (?,'asaas',?,?,'creating',?)",
      [orderId,input.method==='CARD'?'CREDIT_CARD':input.method,totalPrice,String(orderId)]);
    // Persist transport conditions before provider IO, alongside the existing immutable checkout evidence.
    const shippingAtPurchase = { id: option.id, label: option.label, minDays: option.minDays ?? null, maxDays: option.maxDays ?? null };
    await insert(c,"INSERT INTO auditLogs (actorUserId,actorType,action,entity,entityId,metadata) VALUES (?,'user','checkout.created','order',?,?)",[input.userId,String(orderId),JSON.stringify({subtotalCents:subtotal,shippingCents,discountCents,totalPrice,shippingAtPurchase})]);
    await c.commit(); transaction = false;
    const description = `${frozen.slice(0,2).map(i=>i.productName).join(" + ")} | Frete: ${option.label}`;
    let payment: Charge;
    try { payment = await adapters.charge({ orderId,method:input.method,value:totalPrice/100,description,dueDate:input.dueDate,customer:input.customer }); }
    catch {
      await c.query("UPDATE payments SET creationStatus='unknown' WHERE orderId=? AND creationStatus='creating'",[orderId]);
      fail("CHECKOUT_RECOVERY_REQUIRED");
    }
    // Persist successful provider evidence before returning. Failure leaves a complete
    // pending order, blocks automatic provider retries, and never confirms payment.
    const saved = {payment,totalPrice,items:frozen,description};
    const metadata=JSON.stringify(saved); if(Buffer.byteLength(metadata)>65_535) fail("CHECKOUT_RECOVERY_REQUIRED");
    try {
      await c.beginTransaction(); transaction=true;
      if(!payment.paymentId || !payment.customerId) fail("CHECKOUT_RECOVERY_REQUIRED");
      // A webhook may already have confirmed this order while the provider response was in flight.
      const current=(await rows(c,"SELECT paymentStatus FROM orders WHERE id=? FOR UPDATE",[orderId]))[0];
      const received=(await rows(c,"SELECT eventId FROM asaasWebhookEvents WHERE orderId=? AND paymentId=? AND eventType='PAYMENT_RECEIVED' AND status='processed' LIMIT 1",[orderId,payment.paymentId])).length>0;
      const status=current.paymentStatus==='confirmed' ? (received?'received':'confirmed') : 'pending';
      await c.query("UPDATE payments SET providerPaymentId=?,providerCustomerId=?,creationStatus='created',invoiceUrl=?,bankSlipUrl=?,pixQrCode=?,pixCopyPaste=?,digitableLine=?,status=?,paidAmount=?,confirmedAt=IF(?='pending',NULL,NOW()) WHERE orderId=? AND creationStatus='creating'",
        [payment.paymentId,payment.customerId,payment.invoiceUrl,payment.bankSlipUrl,payment.pixQrCode,payment.pixCopyPaste,payment.digitableLine,status,status==='pending'?0:totalPrice,status,orderId]);
      if(couponId) {
        const [updated]=await c.query<ResultSetHeader>("UPDATE coupons SET usedCount=usedCount+1 WHERE id=?",[couponId]);
        if(updated.affectedRows!==1) fail("CHECKOUT_RECOVERY_REQUIRED");
      }
      await insert(c,"INSERT INTO auditLogs (actorUserId,actorType,action,entity,entityId,metadata) VALUES (NULL,'system','checkout.charge_created','order',?,?)",[String(orderId),metadata]);
      const customerEmail=input.customer.email;
      if(customerEmail){
        const total=formatCurrency(totalPrice/100);
        const orderUrlBase=String(process.env.APP_URL||process.env.APP_BASE_URL||process.env.FRONTEND_URL||'https://l4ckos.com.br').replace(/\/$/,'');
        const messages=[
          {type:'order-created-email-v1',payload:{customerEmail,customerName:input.customer.name,orderNumber:String(orderId),total,
            items:frozen.map(item=>({name:item.salesModeAtPurchase==='PREORDER'?`${item.productName} — Pré-venda — ${item.productionBatchNameAtPurchase}. ${manufacturingEstimate(item.estimatedManufacturingStartAtPurchase,item.estimatedManufacturingEndAtPurchase,true)} ${shippingEstimate(item.estimatedShippingStartAtPurchase,item.estimatedShippingEndAtPurchase,{historical:true})}`:item.productName,quantity:item.quantity,price:formatCurrency(item.totalPrice/100)})),orderUrl:orderUrlBase+'/meus-pedidos/'+orderId}},
          {type:'payment-pending-email-v1',payload:{customerEmail,customerName:input.customer.name,orderNumber:String(orderId),total,paymentUrl:payment.invoiceUrl||payment.bankSlipUrl||undefined,dueLabel:input.dueDate||'Aguardando compensação'}},
        ];
        for(const message of messages)await insert(c,"INSERT INTO notificationOutbox(dedupeKey,type,orderId,payload) VALUES (?,?,?,?)",[`${message.type}:order:${orderId}`,message.type,orderId,JSON.stringify(message.payload)]);
      }
      await c.commit();transaction=false;
    }
    catch { fail("CHECKOUT_RECOVERY_REQUIRED"); }
    return {orderId,...saved,replayed:false};
  } finally {
    try { if(transaction) await c.rollback(); }
    finally { if(acquired) await c.query("SELECT RELEASE_LOCK(?)",[lock]); }
  }
}
