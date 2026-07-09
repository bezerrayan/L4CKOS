import "dotenv/config";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { mkdir, readdir, stat } from "node:fs/promises";
import path from "node:path";
import { getDb } from "../server/db";
import { asaasWebhookEvents, auditLogs, orderItems, orders, products, stockReservations, users } from "../drizzle/schema";

type Args = {
  confirm: boolean;
  confirmAllOrders: boolean;
  confirmProduction: boolean;
  confirmNoRecentBackup: boolean;
  allOrders: boolean;
  ids: number[];
  from?: Date;
  to?: Date;
  maxTotalCents: number;
  backupMaxAgeHours: number;
};

type CandidateReason = {
  code: string;
  description: string;
};

type OrderRow = typeof orders.$inferSelect & {
  customerName: string | null;
  customerEmail: string | null;
};

type RelatedRows = {
  orderItems: Array<typeof orderItems.$inferSelect & { productName?: string | null }>;
  reservations: Array<typeof stockReservations.$inferSelect & { productName?: string | null }>;
  webhooks: Array<typeof asaasWebhookEvents.$inferSelect>;
};

const paidOrderStatuses = new Set(["paid", "processing", "shipped", "delivered"]);
const paidWebhookEvents = new Set(["PAYMENT_RECEIVED", "PAYMENT_CONFIRMED", "PAYMENT_CREDIT_CARD_CAPTURE_REFUSED"]);
const testIdentityPattern = /\b(teste|test|example|cliente exemplo)\b/i;

function parseArgs(argv: string[]): Args {
  const args: Args = {
    confirm: process.env.CONFIRM_RESET_TEST_ORDERS === "true",
    confirmAllOrders: process.env.CONFIRM_RESET_ALL_ORDERS === "true",
    confirmProduction: process.env.CONFIRM_PRODUCTION_RESET === "true",
    confirmNoRecentBackup: process.env.CONFIRM_NO_RECENT_BACKUP === "true",
    allOrders: process.env.RESET_ALL_ORDERS === "true",
    ids: [],
    maxTotalCents: Number(process.env.TEST_ORDER_MAX_TOTAL_CENTS || 1_000),
    backupMaxAgeHours: Number(process.env.BACKUP_MAX_AGE_HOURS || 24),
  };

  for (const raw of argv) {
    if (raw === "--confirm-reset-test-orders") args.confirm = true;
    if (raw === "--confirm-reset-all-orders") args.confirmAllOrders = true;
    if (raw === "--confirm-production-reset") args.confirmProduction = true;
    if (raw === "--confirm-no-recent-backup") args.confirmNoRecentBackup = true;
    if (raw === "--all-orders") args.allOrders = true;
    if (raw.startsWith("--ids=")) {
      args.ids = raw
        .slice("--ids=".length)
        .split(",")
        .map(item => Number(item.trim()))
        .filter(item => Number.isInteger(item) && item > 0);
    }
    if (raw.startsWith("--from=")) args.from = parseDateArg(raw.slice("--from=".length), "--from");
    if (raw.startsWith("--to=")) args.to = parseDateArg(raw.slice("--to=".length), "--to");
    if (raw.startsWith("--max-total-cents=")) {
      const parsed = Number(raw.slice("--max-total-cents=".length));
      if (Number.isFinite(parsed) && parsed >= 0) args.maxTotalCents = parsed;
    }
    if (raw.startsWith("--backup-max-age-hours=")) {
      const parsed = Number(raw.slice("--backup-max-age-hours=".length));
      if (Number.isFinite(parsed) && parsed > 0) args.backupMaxAgeHours = parsed;
    }
  }

  return args;
}

function parseDateArg(raw: string, flagName: string) {
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) {
    throw new Error(`Data inválida em ${flagName}: ${raw}`);
  }
  return date;
}

function centsToBRL(cents: number | string | null | undefined) {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(Number(cents ?? 0) / 100);
}

function normalizeText(value: unknown) {
  return String(value ?? "").trim().toLowerCase();
}

function formatDate(value: Date | string | null | undefined) {
  if (!value) return "n/a";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "n/a" : date.toISOString();
}

function hasPaidWebhook(webhooks: Array<typeof asaasWebhookEvents.$inferSelect>) {
  return webhooks.some(row => row.status === "processed" && paidWebhookEvents.has(String(row.eventType ?? "").toUpperCase()));
}

function hasAnyProcessedWebhook(webhooks: Array<typeof asaasWebhookEvents.$inferSelect>) {
  return webhooks.some(row => row.status === "processed");
}

function isMissingDatabaseObjectError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error ?? "");
  return /(unknown column|unknown table|doesn't exist|does not exist|no such table)/i.test(message);
}

function isOptionalWebhookTableError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error ?? "");
  return /asaasWebhookEvents/i.test(message);
}

function evaluateOrder(order: OrderRow, related: RelatedRows, args: Args) {
  const reasons: CandidateReason[] = [];
  const warnings: CandidateReason[] = [];
  const name = normalizeText(order.customerName);
  const email = normalizeText(order.customerEmail);
  const identityLooksTest = testIdentityPattern.test(name) || testIdentityPattern.test(email);
  const manualIdMatch = args.ids.includes(order.id);
  const dateMatch = (!args.from || new Date(order.createdAt).getTime() >= args.from.getTime())
    && (!args.to || new Date(order.createdAt).getTime() <= args.to.getTime());
  const lowValue = Number(order.totalPrice ?? 0) <= args.maxTotalCents;
  const noCheckout = !String(order.asaasCheckoutId ?? "").trim();
  const nonPaidStatus = !paidOrderStatuses.has(String(order.status ?? ""));
  const paidWebhook = hasPaidWebhook(related.webhooks);
  const processedWebhook = hasAnyProcessedWebhook(related.webhooks);

  if (args.allOrders) {
    const allOrderWarnings: CandidateReason[] = [];
    if (paidWebhook) allOrderWarnings.push({ code: "paid_webhook", description: "Há webhook Asaas processado com evento de pagamento recebido/confirmado." });
    if (paidOrderStatuses.has(String(order.status ?? ""))) allOrderWarnings.push({ code: "paid_like_status", description: `Status atual é ${order.status}.` });
    if (processedWebhook && !paidWebhook) allOrderWarnings.push({ code: "processed_webhook", description: "Há webhook Asaas processado relacionado ao pedido." });
    return {
      isCandidate: true,
      isSuspect: false,
      reasons: [{ code: "all_orders", description: "Modo explícito --all-orders selecionado." }],
      warnings: allOrderWarnings,
    };
  }

  if (identityLooksTest) reasons.push({ code: "test_identity", description: "Nome/e-mail contém teste, test, example ou cliente exemplo." });
  if (manualIdMatch) reasons.push({ code: "manual_id", description: "ID informado manualmente em --ids." });
  if (args.from || args.to) {
    if (dateMatch) reasons.push({ code: "date_range", description: "Pedido está dentro do intervalo informado." });
    else warnings.push({ code: "outside_date_range", description: "Pedido está fora do intervalo informado." });
  }
  if (lowValue) reasons.push({ code: "low_value", description: `Valor menor ou igual a ${centsToBRL(args.maxTotalCents)}.` });
  if (noCheckout) reasons.push({ code: "no_asaas_checkout", description: "Pedido sem checkout Asaas registrado." });
  if (nonPaidStatus) reasons.push({ code: "non_paid_status", description: "Status não indica pagamento/entrega real." });
  if (process.env.NODE_ENV !== "production") reasons.push({ code: "non_production_env", description: "Ambiente atual não é production." });

  if (paidWebhook) warnings.push({ code: "paid_webhook", description: "Há webhook Asaas processado com evento de pagamento recebido/confirmado." });
  if (paidOrderStatuses.has(String(order.status ?? ""))) warnings.push({ code: "paid_like_status", description: `Status atual é ${order.status}.` });
  if (processedWebhook && !paidWebhook) warnings.push({ code: "processed_webhook", description: "Há webhook Asaas processado relacionado ao pedido." });

  const strongSignals = reasons.filter(reason => ["test_identity", "manual_id", "date_range"].includes(reason.code)).length;
  const safetySignals = reasons.filter(reason => ["no_asaas_checkout", "non_paid_status", "non_production_env"].includes(reason.code)).length;
  const isCandidate = !paidWebhook && (manualIdMatch || (strongSignals >= 1 && safetySignals >= 1) || (identityLooksTest && lowValue && nonPaidStatus));

  return {
    isCandidate,
    isSuspect: !isCandidate && reasons.length > 0,
    reasons,
    warnings,
  };
}

async function loadOrders(args: Args) {
  const db = await getDb();
  if (!db) throw new Error("Database not available. Configure DATABASE_URL antes de rodar.");

  const rows = await db
    .select({
      id: orders.id,
      userId: orders.userId,
      status: orders.status,
      trackingCode: orders.trackingCode,
      totalPrice: orders.totalPrice,
      asaasCheckoutId: orders.asaasCheckoutId,
      shippingRecipient: orders.shippingRecipient,
      shippingZipCode: orders.shippingZipCode,
      shippingStreet: orders.shippingStreet,
      shippingNumber: orders.shippingNumber,
      shippingComplement: orders.shippingComplement,
      shippingNeighborhood: orders.shippingNeighborhood,
      shippingCity: orders.shippingCity,
      shippingState: orders.shippingState,
      createdAt: orders.createdAt,
      updatedAt: orders.updatedAt,
      customerName: users.name,
      customerEmail: users.email,
    })
    .from(orders)
    .leftJoin(users, eq(users.id, orders.userId))
    .orderBy(desc(orders.id));

  const filtered = rows.filter(row => {
    if (args.ids.length > 0 && !args.ids.includes(row.id)) return false;
    const createdAt = new Date(row.createdAt).getTime();
    if (args.from && createdAt < args.from.getTime()) return false;
    if (args.to && createdAt > args.to.getTime()) return false;
    return true;
  });

  const orderIds = filtered.map(row => row.id);
  if (orderIds.length === 0) return { rows: filtered, relatedByOrder: new Map<number, RelatedRows>() };

  const [items, reservations, webhooks] = await Promise.all([
    db
      .select({
        id: orderItems.id,
        orderId: orderItems.orderId,
        productId: orderItems.productId,
        quantity: orderItems.quantity,
        price: orderItems.price,
        createdAt: orderItems.createdAt,
        productName: products.name,
      })
      .from(orderItems)
      .leftJoin(products, eq(products.id, orderItems.productId))
      .where(inArray(orderItems.orderId, orderIds))
      .catch(error => {
        if (isMissingDatabaseObjectError(error)) return [];
        throw error;
      }),
    db
      .select({
        id: stockReservations.id,
        orderId: stockReservations.orderId,
        userId: stockReservations.userId,
        productId: stockReservations.productId,
        quantity: stockReservations.quantity,
        status: stockReservations.status,
        expiresAt: stockReservations.expiresAt,
        createdAt: stockReservations.createdAt,
        updatedAt: stockReservations.updatedAt,
        productName: products.name,
      })
      .from(stockReservations)
      .leftJoin(products, eq(products.id, stockReservations.productId))
      .where(inArray(stockReservations.orderId, orderIds))
      .catch(error => {
        if (isMissingDatabaseObjectError(error)) return [];
        throw error;
      }),
    db
      .select()
      .from(asaasWebhookEvents)
      .where(inArray(asaasWebhookEvents.orderId, orderIds))
      .catch(error => {
        if (args.allOrders || isMissingDatabaseObjectError(error) || isOptionalWebhookTableError(error)) return [];
        throw error;
      }),
  ]);

  const relatedByOrder = new Map<number, RelatedRows>();
  for (const id of orderIds) {
    relatedByOrder.set(id, { orderItems: [], reservations: [], webhooks: [] });
  }
  for (const item of items) relatedByOrder.get(item.orderId)?.orderItems.push(item);
  for (const reservation of reservations) relatedByOrder.get(reservation.orderId)?.reservations.push(reservation);
  for (const webhook of webhooks) {
    if (webhook.orderId != null) relatedByOrder.get(webhook.orderId)?.webhooks.push(webhook);
  }

  return { rows, relatedByOrder };
}

async function getRecentBackupInfo(maxAgeHours: number) {
  const dir = process.env.BACKUP_DIR || "backups";
  await mkdir(dir, { recursive: true });
  const files = (await readdir(dir)).filter(file => /^(auto-)?backup-.+\.json$/.test(file));
  const entries = await Promise.all(
    files.map(async file => {
      const filePath = path.join(dir, file);
      const info = await stat(filePath);
      return { file, filePath, mtimeMs: info.mtimeMs };
    }),
  );
  const newest = entries.sort((a, b) => b.mtimeMs - a.mtimeMs)[0] ?? null;
  if (!newest) return { hasRecentBackup: false, newest: null, maxAgeHours };
  const ageHours = (Date.now() - newest.mtimeMs) / 3_600_000;
  return { hasRecentBackup: ageHours <= maxAgeHours, newest: { ...newest, ageHours }, maxAgeHours };
}

function printReport(input: {
  candidates: Array<{ order: OrderRow; related: RelatedRows; reasons: CandidateReason[]; warnings: CandidateReason[] }>;
  suspects: Array<{ order: OrderRow; related: RelatedRows; reasons: CandidateReason[]; warnings: CandidateReason[] }>;
  args: Args;
}) {
  const affectedTables = ["orders", "orderItems", "stockReservations", "asaasWebhookEvents", "auditLogs (insert de registro)"];
  const totalCents = input.candidates.reduce((sum, item) => sum + Number(item.order.totalPrice ?? 0), 0);

  console.log("\n=== DRY-RUN RESET DE PEDIDOS DE TESTE L4CKOS ===");
  if (input.args.allOrders) console.log("Escopo: TODOS OS PEDIDOS (--all-orders)");
  console.log(`Modo: ${input.args.confirm ? "EXECUÇÃO REAL SOLICITADA" : "DRY-RUN (nenhuma exclusão será feita)"}`);
  console.log(`Ambiente NODE_ENV: ${process.env.NODE_ENV || "não definido"}`);
  console.log(`Pedidos candidatos: ${input.candidates.length}`);
  console.log(`Pedidos suspeitos não removíveis automaticamente: ${input.suspects.length}`);
  console.log(`Total financeiro candidato: ${centsToBRL(totalCents)}`);
  console.log(`Tabelas que seriam afetadas: ${affectedTables.join(", ")}`);

  for (const item of input.candidates) {
    printOrder("CANDIDATO", item);
  }

  for (const item of input.suspects) {
    printOrder("SUSPEITO - NÃO REMOVE AUTOMATICAMENTE", item);
  }
}

function printOrder(label: string, item: { order: OrderRow; related: RelatedRows; reasons: CandidateReason[]; warnings: CandidateReason[] }) {
  const { order, related, reasons, warnings } = item;
  const paymentStatus = related.webhooks.length
    ? related.webhooks.map(row => `${row.eventType}:${row.status}`).join(", ")
    : order.asaasCheckoutId
      ? "checkout Asaas registrado sem webhook local"
      : "sem checkout/webhook local";
  const itemRows = related.orderItems.length > 0 ? related.orderItems : related.reservations;

  console.log(`\n[${label}] Pedido #${order.id}`);
  console.log(`Cliente: ${order.customerName || "n/a"} <${order.customerEmail || "n/a"}>`);
  console.log(`Valor: ${centsToBRL(order.totalPrice)} | Status: ${order.status} | Payment status: ${paymentStatus}`);
  console.log(`Criado em: ${formatDate(order.createdAt)} | Checkout Asaas: ${order.asaasCheckoutId ? "sim" : "não"}`);
  console.log(`Itens: ${itemRows.length ? itemRows.map(row => `${row.productName || `Produto #${row.productId}`} x${row.quantity}`).join("; ") : "nenhum item relacionado"}`);
  console.log(`Dependências: orderItems=${related.orderItems.length}, stockReservations=${related.reservations.length}, asaasWebhookEvents=${related.webhooks.length}`);
  console.log(`Motivos: ${reasons.map(reason => reason.code).join(", ") || "n/a"}`);
  if (warnings.length) console.log(`Avisos: ${warnings.map(warning => `${warning.code}: ${warning.description}`).join(" | ")}`);
}

async function deleteCandidates(candidates: Array<{ order: OrderRow; related: RelatedRows }>) {
  if (candidates.length === 0) {
    console.log("\nNenhum pedido candidato para remover.");
    return;
  }

  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const ids = candidates.map(item => item.order.id);

  await db.transaction(async tx => {
    for (const deleteRelated of [
      () => tx.delete(orderItems).where(inArray(orderItems.orderId, ids)),
      () => tx.delete(stockReservations).where(inArray(stockReservations.orderId, ids)),
      () => tx.delete(asaasWebhookEvents).where(inArray(asaasWebhookEvents.orderId, ids)),
    ]) {
      try {
        await deleteRelated();
      } catch (error) {
        if (!isMissingDatabaseObjectError(error) && !isOptionalWebhookTableError(error)) throw error;
      }
    }
    await tx.delete(orders).where(inArray(orders.id, ids));
    try {
      await tx.insert(auditLogs).values({
        actorUserId: 0,
        action: "orders.resetTestOrders",
        entity: "orders",
        entityId: ids.join(","),
        metadata: JSON.stringify({
          script: "scripts/reset-test-orders.ts",
          removedOrderIds: ids,
          removedAt: new Date().toISOString(),
          totalRemovedCents: candidates.reduce((sum, item) => sum + Number(item.order.totalPrice ?? 0), 0),
        }),
      });
    } catch (error) {
      if (!isMissingDatabaseObjectError(error)) throw error;
    }
  });

  console.log(`\nRemoção concluída em transação. Pedidos removidos: ${ids.join(", ")}`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const { rows, relatedByOrder } = await loadOrders(args);

  const candidates: Array<{ order: OrderRow; related: RelatedRows; reasons: CandidateReason[]; warnings: CandidateReason[] }> = [];
  const suspects: Array<{ order: OrderRow; related: RelatedRows; reasons: CandidateReason[]; warnings: CandidateReason[] }> = [];

  for (const order of rows) {
    const related = relatedByOrder.get(order.id) ?? { orderItems: [], reservations: [], webhooks: [] };
    const result = evaluateOrder(order, related, args);
    if (result.isCandidate) candidates.push({ order, related, reasons: result.reasons, warnings: result.warnings });
    else if (result.isSuspect) suspects.push({ order, related, reasons: result.reasons, warnings: result.warnings });
  }

  printReport({ candidates, suspects, args });

  if (!args.confirm) {
    console.log("\nDry-run concluído. Nada foi apagado.");
    console.log("Para executar de verdade, rode com --confirm-reset-test-orders ou CONFIRM_RESET_TEST_ORDERS=true.");
    if (args.allOrders) {
      console.log("Para zerar TODOS os pedidos, rode também com --confirm-reset-all-orders ou CONFIRM_RESET_ALL_ORDERS=true.");
    }
    return;
  }

  if (args.allOrders && !args.confirmAllOrders) {
    throw new Error("Modo --all-orders detectado. Use também --confirm-reset-all-orders para zerar todos os pedidos.");
  }

  if (process.env.NODE_ENV === "production" && !args.confirmProduction) {
    throw new Error("Ambiente production detectado. Use também --confirm-production-reset para execução real.");
  }

  const backupInfo = await getRecentBackupInfo(args.backupMaxAgeHours);
  if (!backupInfo.hasRecentBackup && !args.confirmNoRecentBackup) {
    const newestText = backupInfo.newest ? `${backupInfo.newest.file} (${backupInfo.newest.ageHours.toFixed(1)}h)` : "nenhum backup encontrado";
    throw new Error(
      `Backup recente não encontrado em ${process.env.BACKUP_DIR || "backups"}. Mais novo: ${newestText}. ` +
        "Crie um backup ou use --confirm-no-recent-backup para assumir o risco.",
    );
  }

  await deleteCandidates(candidates);
}

main().catch(error => {
  console.error("\nFalha no reset seguro de pedidos de teste:");
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
