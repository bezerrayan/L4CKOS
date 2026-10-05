import { createHash } from "node:crypto";
import type { Connection, RowDataPacket, ResultSetHeader } from "mysql2/promise";
import { z } from "zod";
import { orderItemMoney } from "./orderItemMoney";
import { DEFAULT_COLORS, DEFAULT_SIZES } from "../../shared/catalogOptions";
import type { createAsaasChargeForOrder } from "../services/asaas";

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
type Snapshot = { productId: number; variantId: number | null; productName: string; variantName: string | null; sku: string | null; size: string | null; color: string | null; imageUrl: string | null; quantity: number; unitPrice: number; totalPrice: number };
export class CheckoutError extends Error { constructor(public code: string) { super(code); } }
function fail(code: string): never { throw new CheckoutError(code); }
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
  return items.map(item => {
    const product = products.get(item.productId)!;
    let variant = item.variantId ? variants.get(item.variantId) : null;
    if(item.variantId && !variant) fail("CHECKOUT_VARIANT_NOT_FOUND");
    if (variant && variant.productId !== product.id) fail("CHECKOUT_VARIANT_OWNERSHIP");
    if (!variant && (item.size || item.color)) {
      const matching = [...variants.values()].filter(v=>v.productId===product.id && (!item.size || v.size===item.size) && (!item.color || v.color===item.color));
      if(matching.length>1) fail("CHECKOUT_VARIANT_AMBIGUOUS");
      variant=matching[0]??null;
    }
    if (variant && ((item.size && item.size!==variant.size) || (item.color && item.color!==variant.color))) fail("CHECKOUT_VARIANT_OWNERSHIP");
    const options = (raw: unknown, fallback: string[]) => {
      try { const list=JSON.parse(String(raw));return Array.isArray(list)&&list.length ? list : fallback; } catch { return fallback; }
    };
    if (!variant && ((item.size && !options(product.optionSizes,DEFAULT_SIZES).includes(item.size)) || (item.color && !options(product.optionColors,DEFAULT_COLORS).includes(item.color)))) fail("CHECKOUT_OPTION_INVALID");
    const money = orderItemMoney(Number(variant?.price ?? product.price), item.quantity);
    return { productId: product.id, variantId: variant?.id ?? null, productName: product.name, variantName: variant?.name ?? null,
      sku: variant?.sku ?? null, size: variant?.size ?? item.size ?? null, color: variant?.color ?? item.color ?? null, imageUrl: product.imageUrl ?? null, ...money };
  });
}
export async function previewCheckoutItems(c: Connection, items: CheckoutItem[]) {
  return snapshots(c,items.map(item=>checkoutItemSchema.parse(item)),false);
}
async function checkStock(c: Connection, items: Snapshot[]) {
  for (const id of [...new Set(items.map(i => i.productId))]) {
    const quantity = items.filter(i => i.productId === id).reduce((n,i) => n+i.quantity,0);
    const stock = Number((await rows(c, "SELECT stock FROM products WHERE id=?", [id]))[0].stock);
    const reserved = Number((await rows(c, "SELECT COALESCE(SUM(quantity),0) n FROM stockReservations WHERE productId=? AND status='active' AND expiresAt>NOW()", [id]))[0].n);
    if (quantity > stock-reserved) fail("CHECKOUT_STOCK_INSUFFICIENT");
  }
  for (const id of [...new Set(items.flatMap(i => i.variantId ? [i.variantId] : []))]) {
    const quantity = items.filter(i => i.variantId === id).reduce((n,i) => n+i.quantity,0);
    const stock = Number((await rows(c, "SELECT stock FROM productVariants WHERE id=?", [id]))[0].stock);
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
  quote: (input: { cep: string; itemCount: number; subtotal: number }) => Promise<{ options: { id: string; label: string; price: number }[] }>;
  charge: typeof createAsaasChargeForOrder;
};
/** Caller owns the dedicated connection. Only the advisory attempt lock spans provider IO. */
export async function checkout(c: Connection, input: CheckoutInput, adapters: CheckoutAdapters) {
  if (!Number.isInteger(input.userId) || input.userId <= 0 || !z.string().uuid().safeParse(input.checkoutAttemptId).success || !input.items.length) fail("CHECKOUT_INPUT_INVALID");
  const items = input.items.map(i => checkoutItemSchema.parse(i));
  const fingerprint = hash({ ...input, items });
  const attempt = hash([input.userId,input.checkoutAttemptId]);
  const lock = "l4ckos_checkout_"+attempt.slice(0,40);
  let acquired = false, transaction = false, orderId = 0, couponId: number | null = null;
  try {
    acquired = Number((await rows(c,"SELECT GET_LOCK(?, 2) acquired",[lock]))[0].acquired) === 1;
    if (!acquired) fail("CHECKOUT_ATTEMPT_BUSY");
    await c.query("SET time_zone='+00:00'");
    const existing = (await rows(c,"SELECT id,checkoutFingerprint FROM orders WHERE checkoutAttemptId=?",[attempt]))[0];
    if (existing) {
      if (existing.checkoutFingerprint !== fingerprint) fail("CHECKOUT_ATTEMPT_CHANGED");
      const event = (await rows(c,"SELECT metadata FROM auditLogs WHERE entity='order' AND entityId=? AND action='checkout.charge_created' ORDER BY id LIMIT 1",[String(existing.id)]))[0];
      if (!event) fail("CHECKOUT_RECOVERY_REQUIRED");
      const saved = JSON.parse(event.metadata) as { payment: Charge; totalPrice: number; items: Snapshot[]; description: string };
      return { orderId: Number(existing.id), ...saved, replayed: true };
    }
    const quoted = await snapshots(c, items, false);
    const subtotal = cents(quoted.reduce((n,i) => n+i.totalPrice,0));
    const quote = await adapters.quote({ cep: input.shipping.cep, itemCount: items.reduce((n,i)=>n+i.quantity,0), subtotal: subtotal/100 });
    const option = quote.options.find(o => o.id === input.shipping.optionId);
    if (!option || !Number.isFinite(option.price) || option.price < 0) fail("CHECKOUT_SHIPPING_INVALID");
    const shippingCents = cents(Math.round(option.price*100));
    await c.query("SET TRANSACTION ISOLATION LEVEL READ COMMITTED");
    await c.beginTransaction(); transaction = true;
    const frozen = await snapshots(c,items,true);
    if (hash(frozen) !== hash(quoted)) fail("CHECKOUT_CATALOG_CHANGED");
    await checkStock(c,frozen);
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
    for (const item of frozen) {
      const itemId = await insert(c,"INSERT INTO orderItems (orderId,productId,variantId,productName,variantName,sku,size,color,imageUrl,quantity,unitPrice,totalPrice) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",[orderId,item.productId,item.variantId,item.productName,item.variantName,item.sku,item.size,item.color,item.imageUrl,item.quantity,item.unitPrice,item.totalPrice]);
      await insert(c,"INSERT INTO stockReservations (orderId,userId,productId,variantId,orderItemId,quantity,status,expiresAt) VALUES (?,?,?,?,?,?,'active',DATE_ADD(NOW(),INTERVAL 20 MINUTE))",[orderId,input.userId,item.productId,item.variantId,itemId,item.quantity]);
    }
    await insert(c,"INSERT INTO auditLogs (actorUserId,actorType,action,entity,entityId,metadata) VALUES (?,'user','checkout.created','order',?,?)",[input.userId,String(orderId),JSON.stringify({subtotalCents:subtotal,shippingCents,discountCents,totalPrice})]);
    await c.commit(); transaction = false;
    const description = `${frozen.slice(0,2).map(i=>i.productName).join(" + ")} | Frete: ${option.label}`;
    let payment: Charge;
    try { payment = await adapters.charge({ orderId,method:input.method,value:totalPrice/100,description,dueDate:input.dueDate,customer:input.customer }); }
    catch { fail("CHECKOUT_RECOVERY_REQUIRED"); }
    // Persist successful provider evidence before returning. Failure leaves a complete
    // pending order, blocks automatic provider retries, and never confirms payment.
    const saved = {payment,totalPrice,items:frozen,description};
    const metadata=JSON.stringify(saved); if(Buffer.byteLength(metadata)>65_535) fail("CHECKOUT_RECOVERY_REQUIRED");
    try {
      await c.beginTransaction(); transaction=true;
      if(couponId) {
        const [updated]=await c.query<ResultSetHeader>("UPDATE coupons SET usedCount=usedCount+1 WHERE id=?",[couponId]);
        if(updated.affectedRows!==1) fail("CHECKOUT_RECOVERY_REQUIRED");
      }
      await insert(c,"INSERT INTO auditLogs (actorUserId,actorType,action,entity,entityId,metadata) VALUES (NULL,'system','checkout.charge_created','order',?,?)",[String(orderId),metadata]);
      await c.commit();transaction=false;
    }
    catch { fail("CHECKOUT_RECOVERY_REQUIRED"); }
    return {orderId,...saved,replayed:false};
  } finally {
    try { if(transaction) await c.rollback(); }
    finally { if(acquired) await c.query("SELECT RELEASE_LOCK(?)",[lock]); }
  }
}
