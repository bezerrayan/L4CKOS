/** Existing webhook transaction only; never reconciles historical or expired commitments. */
import { sql } from "drizzle-orm";
import {
  admissionRows as rows,
  requireAdmission,
  assertSelectiveStage,
  selectiveOrderAllowed,
  type Executor,
  selectedBoletoReview,
  BOLETO_REVIEW,
} from "./stagingCheckoutAdmission";
import type { buildPaymentConfirmationValues } from "./confirmation";
export async function confirmSelectedCheckoutStock(
  db: Executor,
  orderId: number,
  values: ReturnType<typeof buildPaymentConfirmationValues>
) {
  assertSelectiveStage();
  requireAdmission(
    selectiveOrderAllowed(orderId) &&
      values.paymentConfirmationSource === "asaas_webhook" &&
      values.paymentConfirmationReference
  );
  const [order] = await rows(
    db,
    sql`SELECT * FROM orders WHERE id=${orderId} FOR UPDATE`
  );
  requireAdmission(
    order &&
      ["pending", "processing"].includes(order.status) &&
      order.paymentStatus === "unconfirmed" &&
      order.paymentConfirmationSource === null &&
      order.fulfillmentStatus === "awaiting_payment" &&
      order.fulfillmentIssue === null
  );
  const items = await rows(
    db,
    sql`SELECT * FROM orderItems WHERE orderId=${orderId} ORDER BY id FOR UPDATE`
  );
  // This homologation admits stock checkouts only; no inferred manufacturing/fulfillment policy for preorders.
  requireAdmission(
    items.length > 0 &&
      items.every(
        i =>
          i.salesModeAtPurchase === "STOCK" &&
          Number.isSafeInteger(i.quantity) &&
          i.quantity > 0
      )
  );
  const reservations = await rows(
    db,
    sql`SELECT *,expiresAt>CURRENT_TIMESTAMP(3) live FROM stockReservations WHERE orderId=${orderId} ORDER BY id FOR UPDATE`
  );
  if (selectedBoletoReview(orderId)) {
    const [payment] = await rows(db, sql`SELECT financialIssue FROM payments WHERE orderId=${orderId} FOR UPDATE`);
    // Receipt is a financial fact; it does not authorize fulfillment or a replacement reservation.
    if (payment?.financialIssue === BOLETO_REVIEW || reservations.length !== items.length ||
        reservations.some(r => r.status !== "active" || Number(r.live) !== 1))
      return { updated: false, invalidTransition: true, reviewReceiptRecorded: true,
        status: order.status, lowStockProducts: [] } as const;
  }
  requireAdmission(
    reservations.length === items.length &&
      reservations.every(
        r =>
          r.status === "active" &&
          Number(r.live) === 1 &&
          r.userId === order.userId
      )
  );
  for (const item of items) {
    const matching = reservations.filter(r => r.orderItemId === item.id);
    requireAdmission(
      matching.length === 1 &&
        matching[0].productId === item.productId &&
        matching[0].variantId === item.variantId &&
        matching[0].quantity === item.quantity
    );
  }
  const boletoReview = selectedBoletoReview(orderId);
  const retainReceipt = async () => {
    await db.execute(sql`ROLLBACK TO SAVEPOINT selected_stock_receipt`);
    return { updated: false, invalidTransition: true, reviewReceiptRecorded: true,
      status: order.status, lowStockProducts: [] } as const;
  };
  if (boletoReview) await db.execute(sql`SAVEPOINT selected_stock_receipt`);
  const productIds = [...new Set(items.map(i => Number(i.productId)))].sort(
    (a, b) => a - b
  );
  const products = [];
  for (const id of productIds) {
    const [p] = await rows(
      db,
      sql`SELECT id,name,stock FROM products WHERE id=${id} FOR UPDATE`
    );
    requireAdmission(p);
    products.push(p);
  }
  const variantIds = [
    ...new Set(
      items.filter(i => i.variantId !== null).map(i => Number(i.variantId))
    ),
  ].sort((a, b) => a - b);
  for (const id of variantIds) {
    const lines = items.filter(i => i.variantId === id),
      qty = lines.reduce((n, i) => n + i.quantity, 0);
    const [v] = await rows(
      db,
      sql`SELECT id,productId,stock FROM productVariants WHERE id=${id} FOR UPDATE`
    );
    requireAdmission(v && lines.every(i => i.productId === v.productId));
    if (v.stock < qty && boletoReview) return retainReceipt();
    requireAdmission(v.stock >= qty);
    const [changed] = (await db.execute(
      sql`UPDATE productVariants SET stock=stock-${qty} WHERE id=${id} AND stock>=${qty}`
    )) as any;
    requireAdmission(changed.affectedRows === 1);
  }
  const lowStockProducts = [];
  for (const p of products) {
    const productLines = items.filter(item => Number(item.productId) === Number(p.id));
    const [existingVariant] = await rows(db, sql`SELECT id FROM productVariants WHERE productId=${p.id} LIMIT 1 FOR UPDATE`);
    if (existingVariant) {
      requireAdmission(productLines.every(item => item.variantId !== null));
      const [aggregate] = await rows(db, sql`SELECT COALESCE(SUM(stock),0) stock FROM productVariants WHERE productId=${p.id}`);
      const nextAggregate = Number(aggregate.stock);
      const [changed] = (await db.execute(
        sql`UPDATE products SET stock=${nextAggregate} WHERE id=${p.id}`
      )) as any;
      requireAdmission(changed.affectedRows === 1);
      if (p.stock > 5 && nextAggregate <= 5)
        lowStockProducts.push({ id: p.id, name: p.name, stock: nextAggregate });
      continue;
    }
    requireAdmission(productLines.every(item => item.variantId === null));
    const qty = productLines.reduce((n, item) => n + item.quantity, 0);
    if (p.stock < qty && boletoReview) return retainReceipt();
    requireAdmission(p.stock >= qty);
    const [changed] = (await db.execute(
      sql`UPDATE products SET stock=stock-${qty} WHERE id=${p.id} AND stock>=${qty}`
    )) as any;
    requireAdmission(changed.affectedRows === 1);
    if (p.stock > 5 && p.stock - qty <= 5)
      lowStockProducts.push({ id: p.id, name: p.name, stock: p.stock - qty });
  }
  // Recheck the lease AFTER potentially waiting on product locks. Any mismatch rolls back all debits.
  for (const r of reservations) {
    const [changed] = (await db.execute(
      sql`UPDATE stockReservations SET status='consumed' WHERE id=${r.id} AND orderId=${orderId} AND status='active' AND expiresAt>CURRENT_TIMESTAMP(3)`
    )) as any;
    if (changed.affectedRows !== 1 && boletoReview) return retainReceipt();
    requireAdmission(changed.affectedRows === 1);
  }
  const [changed] =
    (await db.execute(sql`UPDATE orders SET status='paid',paymentStatus='confirmed',paymentConfirmationSource='asaas_webhook',
 paymentConfirmedAt=${values.paymentConfirmedAt.toISOString().slice(0, 19).replace("T", " ")},paymentConfirmedBy=NULL,paymentConfirmationReference=${values.paymentConfirmationReference},fulfillmentStatus='ready'
 WHERE id=${orderId} AND status IN ('pending','processing') AND paymentStatus='unconfirmed' AND paymentConfirmationSource IS NULL
 AND fulfillmentStatus='awaiting_payment' AND fulfillmentIssue IS NULL`)) as any;
  requireAdmission(changed.affectedRows === 1);
  return {
    updated: true,
    status: "paid" as const,
    paymentConfirmedAt: values.paymentConfirmedAt,
    lowStockProducts,
  };
}
