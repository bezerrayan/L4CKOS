import type {
  Connection,
  RowDataPacket,
  ResultSetHeader,
} from "mysql2/promise";
import { z } from "zod";
import {
  BATCH_STATUSES,
  BATCH_TRANSITIONS,
  utcMillis,
  type BatchStatus,
} from "../../shared/preorder";

// Same evidence as isTrustedPaymentConfirmation; order.status alone never proves payment.
export const CONFIRMED_DEMAND_SQL = `o.paymentStatus='confirmed' AND o.paymentConfirmedAt IS NOT NULL
 AND ((o.paymentConfirmationSource='manual' AND o.paymentConfirmedBy>0)
 OR (o.paymentConfirmationSource='asaas_webhook' AND LENGTH(TRIM(o.paymentConfirmationReference))>0))
 AND o.status IN ('paid','processing','shipped','delivered')`;
export const CAPACITY_SQL = `SELECT COALESCE(SUM(i.quantity),0) n FROM orderItems i JOIN orders o ON o.id=i.orderId
 WHERE i.productionBatchId=? AND i.salesModeAtPurchase='PREORDER' AND o.status<>'cancelled'`;
export class BatchError extends Error {}
const fail = (message: string): never => {
  throw new BatchError(message);
};
export async function query(
  c: Connection,
  sql: string,
  values: unknown[] = []
) {
  return (await c.query<RowDataPacket[]>(sql, values))[0];
}
const id = z.number().int().positive();
const date = z.string().datetime({ offset: true }).nullable();
export const batchEditSchema = z
  .object({
    id: id.optional(),
    name: z.string().trim().min(1).max(255),
    salesOpenAt: date,
    salesCloseAt: date,
    estimatedShippingStart: date,
    estimatedShippingEnd: date,
    minimumQuantity: z.number().int().nonnegative().max(2147483647),
    maximumQuantity: z.number().int().positive().max(2147483647).nullable(),
  })
  .strict()
  .superRefine((v, ctx) => {
    if (v.maximumQuantity !== null && v.maximumQuantity < v.minimumQuantity)
      ctx.addIssue({ code: "custom", message: "Máximo menor que mínimo." });
    for (const [start, end] of [
      [v.salesOpenAt, v.salesCloseAt],
      [v.estimatedShippingStart, v.estimatedShippingEnd],
    ])
      if (start && end && utcMillis(start) >= utcMillis(end))
        ctx.addIssue({ code: "custom", message: "Janela de datas inválida." });
  });
export const batchTransitionSchema = z
  .object({
    id,
    status: z.enum(BATCH_STATUSES),
    acknowledgePaidOrders: z.boolean().default(false),
  })
  .strict();
export const batchAssignmentSchema = z
  .object({ id, productIds: z.array(id).max(200) })
  .strict();
async function audit(
  c: Connection,
  actor: number,
  action: string,
  batchId: number,
  before: unknown,
  after: unknown
) {
  await c.query(
    "INSERT INTO auditLogs (actorUserId,actorType,action,entity,entityId,beforeState,afterState) VALUES (?,'admin',?,'productionBatch',?,?,?)",
    [
      actor,
      action,
      String(batchId),
      JSON.stringify(before),
      JSON.stringify(after),
    ]
  );
}
async function atomic<T>(c: Connection, fn: () => Promise<T>) {
  await c.query("SET time_zone='+00:00'");
  await c.query("SET TRANSACTION ISOLATION LEVEL READ COMMITTED");
  await c.beginTransaction();
  try {
    const result = await fn();
    await c.commit();
    return result;
  } catch (e) {
    await c.rollback();
    throw e;
  }
}
export async function listBatches(c: Connection) {
  return query(c, "SELECT * FROM productionBatches ORDER BY id DESC");
}
export async function productionSummary(c: Connection, batchId: number) {
  const batch = (
    await query(c, "SELECT * FROM productionBatches WHERE id=?", [batchId])
  )[0];
  if (!batch) fail("Lote não encontrado.");
  // One InnoDB consistent read supplies groups, totals and pending demand, including
  // when called inside the READ COMMITTED transition transaction. No nested
  // transaction or write lock: payment cannot move between separate SELECTs.
  const demand = await query(c, `SELECT i.orderId,i.productId,i.productName,i.variantId,i.variantName,i.size,i.color,
    i.quantity,i.totalPrice,COALESCE((${CONFIRMED_DEMAND_SQL}),0) confirmed
    FROM orderItems i JOIN orders o ON o.id=i.orderId
    WHERE i.productionBatchId=? AND i.salesModeAtPurchase='PREORDER' AND o.status<>'cancelled'
    ORDER BY i.productId,i.size,i.color`, [batchId]);
  const groupMap = new Map<string, RowDataPacket>();
  const confirmedOrders = new Set<number>(), pendingOrders = new Set<number>();
  const totals = { paidOrders: 0, confirmedQuantity: 0, confirmedItemValueCents: 0 };
  const pending = { pendingOrders: 0, pendingQuantity: 0 };
  for (const row of demand) {
    if (!Number(row.confirmed)) {
      pendingOrders.add(Number(row.orderId));
      pending.pendingQuantity += Number(row.quantity);
      continue;
    }
    confirmedOrders.add(Number(row.orderId));
    totals.confirmedQuantity += Number(row.quantity);
    totals.confirmedItemValueCents += Number(row.totalPrice);
    const key = JSON.stringify([row.productId,row.productName,row.variantId,row.variantName,row.size,row.color]);
    const group = groupMap.get(key) ?? {
      productId: row.productId,
      productName: row.productName,
      variantId: row.variantId,
      variantName: row.variantName,
      size: row.size,
      color: row.color,
      quantity: 0,
      itemValueCents: 0,
    } as RowDataPacket;
    group.quantity += Number(row.quantity);
    group.itemValueCents += Number(row.totalPrice);
    groupMap.set(key, group);
  }
  totals.paidOrders = confirmedOrders.size;
  pending.pendingOrders = pendingOrders.size;
  const groups = [...groupMap.values()];
  const assignments = await query(
    c,
    "SELECT p.id,p.name,p.salesMode FROM productionBatchProducts bp JOIN products p ON p.id=bp.productId WHERE bp.productionBatchId=? ORDER BY p.id",
    [batchId]
  );
  return {
    batch,
    products: assignments,
    groups: groups.map(g => ({
      productId: Number(g.productId),
      productName: String(g.productName),
      variantId: g.variantId === null ? null : Number(g.variantId),
      variantName: g.variantName as string | null,
      size: g.size as string | null,
      color: g.color as string | null,
      quantity: Number(g.quantity),
      itemValueCents: Number(g.itemValueCents),
    })),
    paidOrders: Number(totals.paidOrders),
    confirmedQuantity: Number(totals.confirmedQuantity),
    confirmedItemValueCents: Number(totals.confirmedItemValueCents),
    pendingOrders: Number(pending.pendingOrders),
    pendingQuantity: Number(pending.pendingQuantity),
    minimumRemaining: Math.max(
      0,
      Number(batch.minimumQuantity) - Number(totals.confirmedQuantity)
    ),
  };
}
export async function saveBatch(
  c: Connection,
  input: z.infer<typeof batchEditSchema>,
  actor: number
) {
  const data = batchEditSchema.parse(input);
  return atomic(c, async () => {
    const before = data.id
      ? (
          await query(
            c,
            "SELECT * FROM productionBatches WHERE id=? FOR UPDATE",
            [data.id]
          )
        )[0]
      : null;
    if (data.id && !before) fail("Lote não encontrado.");
    if (before && ["COMPLETED", "CANCELLED"].includes(before.status))
      fail("Lote finalizado não pode ser editado.");
    if (
      data.maximumQuantity !== null &&
      data.id &&
      Number((await query(c, CAPACITY_SQL, [data.id]))[0].n) >
        data.maximumQuantity
    )
      fail("Máximo inferior à capacidade já comprometida.");
    const columns = [
      "name",
      "salesOpenAt",
      "salesCloseAt",
      "estimatedShippingStart",
      "estimatedShippingEnd",
      "minimumQuantity",
      "maximumQuantity",
    ] as const;
    const values = columns.map(k =>
      k.endsWith("At") || k.startsWith("estimated")
        ? data[k]
          ? new Date(String(data[k]))
          : null
        : data[k]
    );
    let batchId = data.id;
    if (batchId)
      await c.query(
        `UPDATE productionBatches SET ${columns.map(k => `\`${k}\`=?`).join(",")} WHERE id=?`,
        [...values, batchId]
      );
    else
      batchId = (
        await c.query<ResultSetHeader>(
          `INSERT INTO productionBatches (${columns.map(k => `\`${k}\``).join(",")}) VALUES (${columns.map(() => "?").join(",")})`,
          values
        )
      )[0].insertId;
    await audit(
      c,
      actor,
      before ? "batch.edited" : "batch.created",
      batchId,
      before,
      data
    );
    return { id: batchId };
  });
}
export async function assignBatchProducts(
  c: Connection,
  input: z.infer<typeof batchAssignmentSchema>,
  actor: number
) {
  const data = batchAssignmentSchema.parse(input);
  return atomic(c, async () => {
    const current = await query(
      c,
      "SELECT productId FROM productionBatchProducts WHERE productionBatchId=?",
      [data.id]
    );
    const all = [
      ...new Set([
        ...current.map(r => Number(r.productId)),
        ...data.productIds,
      ]),
    ].sort((a, b) => a - b);
    for (const productId of all)
      if (
        !(
          await query(c, "SELECT id FROM products WHERE id=? FOR UPDATE", [
            productId,
          ])
        ).length
      )
        fail("Produto não encontrado.");
    const batch = (
      await query(c, "SELECT * FROM productionBatches WHERE id=? FOR UPDATE", [
        data.id,
      ])
    )[0];
    if (!batch) fail("Lote não encontrado.");
    if (!["DRAFT", "OPEN", "CLOSED"].includes(batch.status))
      fail("Associações encerradas para este lote.");
    const lockedCurrent = await query(
      c,
      "SELECT productId FROM productionBatchProducts WHERE productionBatchId=?",
      [data.id]
    );
    if (
      JSON.stringify(lockedCurrent.map(r => r.productId).sort()) !==
      JSON.stringify(current.map(r => r.productId).sort())
    )
      fail("Associações mudaram; tente novamente.");
    for (const productId of data.productIds) {
      const assigned = (
        await query(
          c,
          "SELECT bp.productionBatchId,b.status FROM productionBatchProducts bp JOIN productionBatches b ON b.id=bp.productionBatchId WHERE bp.productId=?",
          [productId]
        )
      )[0];
      if (
        assigned &&
        assigned.productionBatchId !== data.id &&
        !["COMPLETED", "CANCELLED"].includes(assigned.status)
      )
        fail("Produto já pertence a outro lote ativo.");
      await c.query(
        "INSERT INTO productionBatchProducts (productionBatchId,productId) VALUES (?,?) ON DUPLICATE KEY UPDATE productionBatchId=VALUES(productionBatchId)",
        [data.id, productId]
      );
      await c.query("UPDATE products SET salesMode='PREORDER' WHERE id=?", [
        productId,
      ]);
    }
    for (const row of lockedCurrent)
      if (!data.productIds.includes(Number(row.productId))) {
        await c.query(
          "DELETE FROM productionBatchProducts WHERE productionBatchId=? AND productId=?",
          [data.id, row.productId]
        );
        await c.query("UPDATE products SET salesMode='STOCK' WHERE id=?", [
          row.productId,
        ]);
      }
    await audit(
      c,
      actor,
      "batch.products_assigned",
      data.id,
      current.map(r => r.productId),
      data.productIds
    );
    return { success: true };
  });
}
export async function transitionBatch(
  c: Connection,
  input: z.infer<typeof batchTransitionSchema>,
  actor: number
) {
  const data = batchTransitionSchema.parse(input);
  return atomic(c, async () => {
    const before = (
      await query(c, "SELECT * FROM productionBatches WHERE id=? FOR UPDATE", [
        data.id,
      ])
    )[0];
    if (!before) fail("Lote não encontrado.");
    if (!BATCH_TRANSITIONS[before.status as BatchStatus].includes(data.status))
      fail("Transição de lote inválida.");
    if (data.status === "OPEN") {
      if (
        !(
          await query(
            c,
            "SELECT bp.id FROM productionBatchProducts bp JOIN products p ON p.id=bp.productId WHERE bp.productionBatchId=? AND p.salesMode='PREORDER'",
            [data.id]
          )
        ).length
      )
        fail("Associe produtos antes de abrir a pré-venda.");
      if (before.salesCloseAt && utcMillis(before.salesCloseAt) <= Date.now())
        fail("Janela de vendas encerrada.");
    }
    // Always acknowledge cancellation: payment can arrive while the admin reviews the warning.
    const summary = await productionSummary(c, data.id);
    if (data.status === "CANCELLED" && !data.acknowledgePaidOrders)
      fail(
        "Este lote pode possuir pedidos pagos. Confirme a resolução operacional; não haverá reembolso automático."
      );
    const stamp = {
      IN_PRODUCTION: "productionStartedAt",
      RECEIVED: "receivedAt",
      SHIPPING: "shippingStartedAt",
      COMPLETED: "completedAt",
    }[data.status as string];
    await c.query(
      `UPDATE productionBatches SET status=?${stamp ? `, \`${stamp}\`=UTC_TIMESTAMP()` : ""} WHERE id=?`,
      [data.status, data.id]
    );
    await audit(
      c,
      actor,
      "batch.transition",
      data.id,
      { status: before.status },
      {
        status: data.status,
        paidOrders: summary.paidOrders,
        acknowledgePaidOrders: data.acknowledgePaidOrders,
      }
    );
    return { success: true };
  });
}
