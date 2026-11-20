import { createHash } from "node:crypto";
import { assertEnabledBillingTypes, DEFAULT_CHECKOUT_BILLING_TYPES, CheckoutMethodDisabledError } from "../../shared/checkoutMethods";
import { CARD_OBSERVATION_EVENTS, selectedMethodPolicy, insertAdmissionAudit, eventKey, loadSelectedGrant, AdmissionDenied } from "../payments/stagingCheckoutAdmission";
import { stagingFinancialScope } from "../payments/stagingFinancialBuyer";
import { verifyAsaasCustomerNotifications } from "../services/asaasService";
import { validatePaymentBinding, validatePaymentObservationBinding, recordTrustedPaymentReceipt, recordSelectedBoletoReview } from "../payments/paymentRecord";
import { enqueuePaymentApproved, deliverPaymentNotifications } from "../payments/paymentNotificationOutbox";
import { receiveWebhook, type WebhookPreflight, type WebhookReply } from "../payments/webhookInbox";
import { attestAuthenticatedIngress, hasVerifiedIngressProvenance } from "../payments/ingressProvenance";
import { afterWebhookCommit, webhookDb } from "../database/webhookTransaction";
import { parseStockPaymentReference, STOCK_PAYMENT_CUSTOMER_ACTION } from "../stock/stockPaymentReference";
import { alertExecutorForDrizzle, recordReconciliationAlert, resolveStrongStockReferenceOrderId, truncateIdentifier } from "../payments/reconciliationAlerts";
import {assertNoRecoveryHold, captureRecoveryFence} from '../payments/webhookRecovery';
import { purchasedSalesMode, purchasedScheduleMessages } from "../../shared/preorder";
import { PAYMENT_EXCEPTION_EVENTS } from "../../shared/paymentExceptions";
import { parseAsaasOrderReference } from "../../shared/asaasWebhookSemantics";
import { sql } from "drizzle-orm";
import { auditLogs, users } from "../../drizzle/schema";
import { isRestrictedPublicPurchase } from "../database/publicPurchasePolicy";
import type { Request, Response } from "express";
import { z } from "zod";
import {
  getDb,
  getOrderByAsaasCheckoutId,
  getOrderById,
  getOrderReservationItems,
  getOrderByIdAndUser,
  isLegacyCheckoutOrderRestricted,
  markOrderPaid,
  getUserById,
  getUserPhoneById,
  runAsaasWebhookOnce,
  recordPaymentException,
  reserveExternalCheckoutCreation,
  setOrderAsaasCheckoutId,
  updateUserAsaasCustomerId,
} from "../db";
import {
  createAsaasCheckout,
  createAsaasCustomer,
  getAsaasPayment,
  validateAsaasWebhookSignature,
} from "../services/asaasService";
import { securityLog } from "../_core/security";
import { getConfiguredStockCheckoutRuntime } from "../_core/context";
import { buildApiErrorResponse } from "../_core/appErrors";
import { getAllowedOrigins } from "../_core/corsPolicy";
import { formatCurrency } from "../utils/email/formatCurrency.js";
import { createAsaasStockWebhookBoundary } from "../stock/asaasStockWebhookBoundary";
import { assertStagingSyntheticBuyer, syntheticBuyerGateHttpFailure } from "../payments/syntheticBuyerGate";
import type { StockCheckoutRuntime } from "../stock/stockCheckoutRuntime";
import { StockCheckoutError } from "../stock/stockCheckout";
import {
  sendInternalLowStockAlertEmail,
  sendInternalNewSaleAlertEmail,
  sendInternalPaymentFailedAlertEmail,
  sendPaymentFailedEmail,
} from "../services/emailService.js";

type AuthenticatedRequest = Request & {
  authUser?: {
    id: number;
  };
};

function sendControllerError(
  res: Response,
  status: number,
  code: string,
  message: string,
  details?: string[],
) {
  res.status(status).json(buildApiErrorResponse({ status, code, message, details }));
}

// Explicit nonfinancial provider observations; unknown events still fail closed.
const OBSERVATION_EVENTS = new Set(["PAYMENT_BANK_SLIP_VIEWED", "PAYMENT_CHECKOUT_VIEWED"]);
const PAID_EVENTS = new Set(["PAYMENT_RECEIVED", "PAYMENT_CONFIRMED", "PAYMENT_OVERDUE_RECEIVED"]);
const FAILED_EVENTS = new Set(["PAYMENT_REFUSED", "PAYMENT_REPROVED", "PAYMENT_FAILED"]);
// STOCK-only provider states: processed solely by the STOCK webhook owner; legacy orders never consume them.
const STOCK_PENDING_EVENTS = new Set(["PAYMENT_CREATED", "PAYMENT_AWAITING_RISK_ANALYSIS", "PAYMENT_PENDING"]);
const PAID_PAYMENT_STATUSES = new Set(["RECEIVED", "CONFIRMED"]);
const PAYMENT_RECEIVED_PROVIDER_STATUS_PENDING_CODE = "PAYMENT_RECEIVED_PROVIDER_STATUS_PENDING";
const FAILED_PAYMENT_STATUSES = new Set(["REFUSED", "DELETED", "REPROVED", "FAILED"]);

const forbiddenClientPaymentFields = new Set(["value", "amount", "price", "total", "totalPrice", "paymentStatus", "status"]);

const createCustomerSchema = z
  .object({
    cpf: z.string().trim().max(18).optional(),
    phone: z.string().trim().max(40).optional(),
  })
  .strict();

const createCheckoutSchema = z
  .object({
    orderId: z.number().int().positive().or(z.string().regex(/^\d+$/).transform(Number)),
    redirectUrl: z.string().trim().url().max(2048),
    billingTypes: z.array(z.enum(["PIX", "CREDIT_CARD", "BOLETO"])).max(3).optional(),
    checkoutName: z.string().trim().max(120).optional(),
    cpf: z.string().trim().max(18).optional(),
    phone: z.string().trim().max(40).optional(),
  })
  .strict();

export function hasForbiddenClientPaymentField(body: unknown): boolean {
  if (!body || typeof body !== "object") return false;
  if (Array.isArray(body)) return body.some(item => hasForbiddenClientPaymentField(item));

  return Object.entries(body as Record<string, unknown>).some(([key, value]) => {
    if (forbiddenClientPaymentFields.has(key)) return true;
    return hasForbiddenClientPaymentField(value);
  });
}

function isTrustedRedirectUrl(redirectUrl: string) {
  try {
    const url = new URL(redirectUrl);
    const configuredOrigins = getAllowedOrigins({
      isProduction: process.env.NODE_ENV === "production",
      configuredOrigins: process.env.CORS_ORIGINS,
    });

    return configuredOrigins.some(origin => {
      try {
        const allowed = new URL(origin);
        return allowed.protocol === url.protocol && allowed.host === url.host;
      } catch {
        return false;
      }
    });
  } catch {
    return false;
  }
}

function onlyDigits(value: string) {
  return value.replace(/\D/g, "");
}

function parseOrderIdFromWebhook(payload: any): number | null {
  const ref = payload?.payment?.externalReference ?? payload?.externalReference;
  return parseAsaasOrderReference(ref);
}

function parseCheckoutIdFromWebhook(payload: any): string | null {
  const direct = payload?.checkout?.id;
  if (typeof direct === "string" && direct.trim()) return direct.trim();

  const nested = payload?.payment?.checkout?.id;
  if (typeof nested === "string" && nested.trim()) return nested.trim();

  return null;
}

function parsePaymentIdFromWebhook(payload: any): string | null {
  const direct = payload?.payment?.id;
  if (typeof direct === "string" && direct.trim()) return direct.trim();
  return null;
}

function parseEventIdFromWebhook(payload: any, fallback: { event: string; paymentId: string | null; checkoutId: string | null; orderId: number | null }) {
  const direct = payload?.id ?? payload?.eventId ?? payload?.event_id;
  if (typeof direct === "string" && direct.trim()) return direct.trim();
  if (fallback.paymentId) return `${fallback.event}:${fallback.paymentId}`;
  if (fallback.checkoutId) return `${fallback.event}:checkout:${fallback.checkoutId}`;
  if (fallback.orderId) return `${fallback.event}:order:${fallback.orderId}`;
  return null;
}

function parsePaymentStatusFromWebhook(payload: any): string | null {
  const status = payload?.payment?.status ?? payload?.status;
  return typeof status === "string" && status.trim() ? status.trim().toUpperCase() : null;
}

function parseCurrencyFromWebhook(payload: any): string | null {
  const currency = payload?.payment?.currency ?? payload?.currency;
  return typeof currency === "string" && currency.trim() ? currency.trim().toUpperCase() : null;
}

/** Account currency is a separate, explicit operator attestation. It is never inferred from a missing payment field.
 * Keep this fallback scoped to PAYMENT_RECEIVED; confirm events retain the stricter existing policy.
 */
function pinnedAccountCurrencyForReceived(payload: any, event: string): "BRL" | null {
  if (event !== "PAYMENT_RECEIVED") return null;
  const configuredId = process.env.ASAAS_WEBHOOK_ACCOUNT_ID?.trim() ?? "";
  const receivedId = typeof payload?.account?.id === "string" ? payload.account.id.trim() : "";
  const configuredCurrency = process.env.ASAAS_WEBHOOK_ACCOUNT_CURRENCY?.trim().toUpperCase();
  return configuredId && receivedId === configuredId && configuredCurrency === "BRL" ? "BRL" : null;
}

function parsePaidValueCentsFromWebhook(payload: any): number | null {
  const value = payload?.payment?.value ?? payload?.payment?.netValue ?? payload?.value;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) return null;
  return Math.round(parsed * 100);
}

function reconciliationAlertKindForEvent(event: string): string {
  return /REFUND|CHARGEBACK/.test(event) || event === "PAYMENT_RESTORED" || event === "PAYMENT_UPDATED" ||
    event === "PAYMENT_RECEIVED_IN_CASH_UNDONE" || event.startsWith("PAYMENT_SPLIT_")
    ? "ASAAS_WEBHOOK_FINANCIAL_EXCEPTION" : "ASAAS_WEBHOOK_RECONCILIATION";
}

async function persistAsaasReconciliationObservation(payload: any, input: {
  event: string; reason: string; orderId?: number | null; attemptId?: string | null; paymentId?: string | null;
  unresolvedOrderReference?: string | null;
  providerObservedStatus?: string | null;
  observedBillingType?: string | null; providerObservedBillingType?: string | null;
  observedAmountCents?: number | null; expectedAmountCents?: number | null; alertKind?: string;
}) {
  const db = webhookDb();
  if (!db) throw Error("PAYMENT_RECORD_TRANSACTION_REQUIRED");
  const eventId = String(payload?.id ?? payload?.eventId ?? payload?.event_id ?? "").trim();
  if (!eventId) throw Error("WEBHOOK_EVENT_ID_REQUIRED");
  const key = eventKey(eventId);
  const paymentId = input.paymentId ?? parsePaymentIdFromWebhook(payload);
  const rawReference = payload?.payment?.externalReference ?? payload?.externalReference ?? input.unresolvedOrderReference ?? null;
  const normalizedReference = rawReference === null || rawReference === undefined ? null : String(rawReference).trim();
  const referenceHash = normalizedReference ? createHash("sha256").update(normalizedReference).digest("hex") : null;
  const referenceHint = normalizedReference ? truncateIdentifier(normalizedReference) : null;
  const observedStatus = parsePaymentStatusFromWebhook(payload);
  const observedAmountCents = input.observedAmountCents ?? parsePaidValueCentsFromWebhook(payload);
  await insertAdmissionAudit(db, "payment.webhook_reconciliation_required.v1", "asaasWebhookInbox", key, {
    eventId, payloadHash: typeof payload?.sourcePayloadHash === "string" ? payload.sourcePayloadHash : null,
    event: input.event, orderId: input.orderId ?? null, observedOrderReference: input.unresolvedOrderReference ?? normalizedReference,
    observedOrderReferenceHint: referenceHint, observedOrderReferenceHash: referenceHash,
    observedStatus, providerObservedStatus: input.providerObservedStatus ?? null,
    observedBillingType: input.observedBillingType ?? null,
    providerObservedBillingType: input.providerObservedBillingType ?? null, observedAmountCents,
    attemptId: input.attemptId ?? null, paymentId: paymentId ?? null,
    reason: input.reason, reconciliationRequired: true, financialMutation: false,
    stockMutation: false, notificationMutation: false,
  });
  await recordReconciliationAlert(alertExecutorForDrizzle(db), {
    kind: input.alertKind ?? "ASAAS_WEBHOOK_RECONCILIATION",
    // For a known attempt, distinct authenticated events can describe the same
    // provider/attempt divergence. Keep the audit per event, but dedupe the
    // operator case by its stable financial subject instead of delivery ID.
    subject: { attemptId: input.attemptId, orderId: input.orderId ?? input.unresolvedOrderReference, paymentId,
      ...(input.attemptId ? {} : { eventKey: key }) },
    orderId: input.orderId ?? null, providerEventId: eventId, reference: normalizedReference,
    observed: { status: input.providerObservedStatus ?? observedStatus,
      billingType: input.providerObservedBillingType ?? null, amountCents: observedAmountCents,
      expectedAmountCents: input.expectedAmountCents ?? null },
    reason: input.reason,
  });
}

async function ensureAsaasCustomerForUser(input: {
  userId: number;
  cpf?: string;
  phone?: string;
}) {
  assertStagingSyntheticBuyer(input.userId);
  const user = await getUserById(input.userId);
  if (!user) {
    throw new Error("User not found");
  }

  if (user.asaasCustomerId) {
    await verifyAsaasCustomerNotifications(user.asaasCustomerId);
    return { user, asaasCustomerId: user.asaasCustomerId, created: false };
  }

  const email = String(user.email || "").trim();
  const cpf = String(input.cpf || user.cpf || "").trim();
  const phoneFromProfile = await getUserPhoneById(user.id);
  const phone = String(input.phone || user.phone || phoneFromProfile || "").trim();

  if (!user.name || !email || !cpf) {
    throw new Error("Missing required customer fields: name, email, cpf");
  }

  const customer = await createAsaasCustomer({
    name: user.name,
    email,
    cpfCnpj: onlyDigits(cpf),
    mobilePhone: phone ? onlyDigits(phone) : undefined,
  });

  await updateUserAsaasCustomerId(user.id, customer.id);
  return { user, asaasCustomerId: customer.id, created: true };
}

export async function createCustomerHandler(req: Request, res: Response) {
  try {
    const authReq = req as AuthenticatedRequest;
    const userId = authReq.authUser?.id;
    if (!userId) {
      sendControllerError(res, 401, "AUTH_REQUIRED", "Faça login para continuar.");
      return;
    }
    assertStagingSyntheticBuyer(userId);

    const parsedBody = createCustomerSchema.safeParse(req.body ?? {});
    if (!parsedBody.success) {
      sendControllerError(res, 400, "INVALID_CUSTOMER_INPUT", "Dados de cliente inválidos.");
      return;
    }

    const result = await ensureAsaasCustomerForUser({
      userId,
      cpf: parsedBody.data.cpf,
      phone: parsedBody.data.phone,
    });

    res.status(result.created ? 201 : 200).json({
      asaasCustomerId: result.asaasCustomerId,
      created: result.created,
    });
  } catch (error) {
    const gateFailure = syntheticBuyerGateHttpFailure(error);
    if (gateFailure) {
      sendControllerError(res, gateFailure.status, gateFailure.code, "A homologação está restrita a compradores sintéticos autorizados.");
      return;
    }
    securityLog("warn", "payment.create_customer_failed", {
      requestIp: req.ip || "unknown",
      reason: error instanceof Error ? error.message : "unknown",
    });
    sendControllerError(res, 400, "CUSTOMER_CREATE_FAILED", "Não foi possível preparar o cadastro de pagamento.");
  }
}

export async function createCheckoutHandler(req: Request, res: Response) {
  try {
    const authReq = req as AuthenticatedRequest;
    const userId = authReq.authUser?.id;
    if (!userId) {
      sendControllerError(res, 401, "AUTH_REQUIRED", "Faça login para continuar.");
      return;
    }
    assertStagingSyntheticBuyer(userId);

    if (hasForbiddenClientPaymentField(req.body)) {
      securityLog("warn", "payment.forbidden_client_field_rejected", {
        userId,
        requestIp: req.ip || "unknown",
      });
      sendControllerError(res, 400, "FORBIDDEN_PAYMENT_FIELD", "O valor e o status do pagamento são definidos pelo servidor.");
      return;
    }

    const parsedBody = createCheckoutSchema.safeParse(req.body ?? {});
    if (!parsedBody.success) {
      sendControllerError(res, 400, "INVALID_CHECKOUT_INPUT", "Dados de checkout inválidos.");
      return;
    }
    const body = parsedBody.data;
    const billingTypes = body.billingTypes?.length ? body.billingTypes : [...DEFAULT_CHECKOUT_BILLING_TYPES];
    assertEnabledBillingTypes(billingTypes);
    if (stagingFinancialScope()) {
      sendControllerError(res, 409, "STAGING_OFFICIAL_CHECKOUT_REQUIRED", "Use o checkout protegido da loja para esta homologação.");
      return;
    }

    const orderId = Number(body.orderId);
    if (!Number.isInteger(orderId) || orderId <= 0) {
      sendControllerError(res, 400, "INVALID_ORDER_ID", "Pedido inválido.");
      return;
    }

    const redirectUrl = String(body.redirectUrl || "").trim();
    if (!redirectUrl || !isTrustedRedirectUrl(redirectUrl)) {
      sendControllerError(res, 400, "INVALID_REDIRECT_URL", "Não foi possível iniciar o checkout.");
      return;
    }

    const order = await getOrderByIdAndUser(orderId, userId);
    if (!order) {
      sendControllerError(res, 404, "ORDER_NOT_FOUND", "Pedido não encontrado.");
      return;
    }

    if (order.status !== "pending" || order.asaasCheckoutId || order.checkoutAttemptId) {
      sendControllerError(res, 409, "PAYMENT_RECONCILIATION_REQUIRED", "Pedido indisponível para nova cobrança. Confira a cobrança existente antes de tentar novamente.");
      return;
    }

    // This legacy endpoint can only charge an existing order. Revalidate its
    // persisted lines before any Asaas customer/checkout request so historical
    // PREORDER or restricted collaboration orders cannot bypass modern checkout.
    const orderItems = await getOrderReservationItems(order.id);
    if (!orderItems.length) {
      sendControllerError(res, 409, "CHECKOUT_ORDER_ITEMS_UNAVAILABLE", "Não foi possível validar os itens deste pedido.");
      return;
    }
    if (orderItems.some(item => item.salesModeAtPurchase === "PREORDER")) {
      sendControllerError(res, 409, "CHECKOUT_PREORDER_DISABLED", "A pré-venda ainda não está disponível para compra.");
      return;
    }
    // Whole-product exclusivity: name or ANY persisted SKU (active or not), not only the purchased line. If the policy
    // cannot be evaluated this throws and the generic catch below fails closed, before any provider call.
    if (
      orderItems.some(item => isRestrictedPublicPurchase(item.productName, item.sku)) ||
      await isLegacyCheckoutOrderRestricted(order.id)
    ) {
      sendControllerError(res, 403, "CHECKOUT_PRODUCT_REQUIRES_AUTHORIZATION", "Este produto exige autorização para compra.");
      return;
    }

    // The transaction rechecks the whole product under its locks. Commit that claim before *any* Asaas IO
    // (including customer verification/creation); failures below keep the durable evidence and require reconciliation.
    await reserveExternalCheckoutCreation(order.id, userId);

    const { asaasCustomerId } = await ensureAsaasCustomerForUser({
      userId,
      cpf: body.cpf,
      phone: body.phone,
    });

    const checkout = await createAsaasCheckout({
      name: body.checkoutName?.trim() || `Pedido #${order.id}`,
      value: Number((order.totalPrice / 100).toFixed(2)),
      billingTypes,
      customer: asaasCustomerId,
      redirectUrl,
      externalReference: String(order.id),
    });

    await setOrderAsaasCheckoutId(order.id, checkout.id);

    res.status(201).json({
      orderId: order.id,
      asaasCheckoutId: checkout.id,
      checkoutUrl: checkout.checkoutUrl,
    });
  } catch (error) {
    const gateFailure = syntheticBuyerGateHttpFailure(error);
    if (gateFailure) {
      sendControllerError(res, gateFailure.status, gateFailure.code, "A homologação está restrita a compradores sintéticos autorizados.");
      return;
    }
    if (error instanceof CheckoutMethodDisabledError) {
      sendControllerError(res, 400, error.code, error.message);
      return;
    }
    // Restriction confirmed under the transaction locks (duck-typed: stable code, no internal detail).
    if ((error as { code?: unknown } | null)?.code === "CHECKOUT_PRODUCT_REQUIRES_AUTHORIZATION") {
      sendControllerError(res, 403, "CHECKOUT_PRODUCT_REQUIRES_AUTHORIZATION", "Este produto exige autorização para compra.");
      return;
    }
    securityLog("warn", "payment.create_checkout_failed", {
      requestIp: req.ip || "unknown",
      reason: error instanceof Error ? error.message : "unknown",
    });
    sendControllerError(res, 400, "CHECKOUT_CREATE_FAILED", "Não foi possível gerar a cobrança agora.");
  }
}

export function createAsaasWebhookHandler(resolveStockRuntime: () => StockCheckoutRuntime | undefined = () => undefined) {
  return async function asaasWebhookHandler(req: Request, res: Response) {
  try {
    const signatureValid = validateAsaasWebhookSignature(req.headers as Record<string, unknown>);
    if (!signatureValid) {
      securityLog("warn", "payment.asaas_webhook_invalid_signature", {
        requestIp: req.ip || "unknown",
        hasTokenHeader: Boolean((req.headers as Record<string, unknown>)["asaas-access-token"]),
      });
      sendControllerError(res, 401, "INVALID_WEBHOOK_SIGNATURE", "A solicitação não pôde ser validada.");
      return;
    }

    // The durable inbox keeps the V6 recovery guarantees; the STOCK owner resolver travels with the processor.
    const deliveryHeaders = req.headers as Record<string, string | string[] | undefined>;
    await attestAuthenticatedIngress(req.body);
    const outcome = await receiveWebhook(req.body,
      (payload, preflightResult) => processWebhookEnvelope(payload, resolveStockRuntime, deliveryHeaders, preflightResult as AsaasWebhookPreflight | undefined),
      preflightAsaasWebhookEnvelope);
    res.status(outcome.status).json(outcome.body);
  } catch {
    sendControllerError(res, 503, "WEBHOOK_PERSISTENCE_FAILED", "Não foi possível receber a notificação.");
  }
  };
}

/** Internal recovery entrypoint; HTTP authentication is required before persistence. */
export type AsaasWebhookPreflight = {
  currentPayment?: Awaited<ReturnType<typeof getAsaasPayment>>;
  currencyVerification?: { status: "verified" | "unavailable" | "unverifiable"; reason: string; providerStatus?: number };
};

/** Provider reads run before the inbox transaction acquires locks; only the result is passed into processing. */
export const preflightAsaasWebhookEnvelope: WebhookPreflight = async payload => {
  const event = String((payload as any)?.event ?? "").trim();
  const paymentId = parsePaymentIdFromWebhook(payload as any);
  const needsCurrentState = event === "PAYMENT_DELETED";
  if (needsCurrentState && (!paymentId || (payload as any)?.payment?.deleted !== true)) return {};
  const body = payload as any;
  const rawReference = body?.payment?.externalReference ?? body?.externalReference;
  const parsedReference = parseStockPaymentReference(typeof rawReference === "string" ? rawReference.trim() : rawReference);
  let isStockPayment = parsedReference.kind === "strong";
  let isKnownLegacyOrder = false;
  if (!isStockPayment) {
    const numericOrderId = parseAsaasOrderReference(rawReference);
    if (numericOrderId) {
      const existingOrder = await getOrderById(numericOrderId);
      isStockPayment = Boolean(existingOrder?.stockAttemptId);
      isKnownLegacyOrder = Boolean(existingOrder && !existingOrder.stockAttemptId);
    }
  } else if (parsedReference.kind === "strong") {
    const db = await getDb();
    if (!db || !await resolveStrongStockReferenceOrderId(alertExecutorForDrizzle(db), parsedReference.reference))
      isStockPayment = false;
  }
  // STOCK runs on PIX: only PAYMENT_RECEIVED can settle it, but every eligible
  // receipt requires an authoritative provider read even when the webhook
  // asserts currency: "BRL". Legacy paid events keep the same provider proof.
  const requiresPaidProviderProof = isStockPayment
    ? event === "PAYMENT_RECEIVED"
    : isKnownLegacyOrder && PAID_EVENTS.has(event);
  if (requiresPaidProviderProof) {
    const observedStatus = parsePaymentStatusFromWebhook(body);
    if (observedStatus && !PAID_PAYMENT_STATUSES.has(observedStatus))
      return { currencyVerification: { status: "unverifiable", reason: "WEBHOOK_EVENT_STATUS_CONFLICT" } };
    const expectedAccount = process.env.ASAAS_WEBHOOK_ACCOUNT_ID?.trim();
    const accountId = typeof body?.account?.id === "string" ? body.account.id.trim() : "";
    const valueCents = parsePaidValueCentsFromWebhook(body);
    if (!paymentId || typeof body?.id !== "string" || !body.id.trim() ||
        typeof rawReference !== "string" || !rawReference.trim() || valueCents === null || valueCents <= 0 ||
        !expectedAccount || !accountId || accountId !== expectedAccount) {
      return { currencyVerification: { status: "unverifiable", reason: !expectedAccount ? "PROVIDER_ACCOUNT_ID_UNCONFIGURED" : "WEBHOOK_BINDING_INCOMPLETE" } };
    }
    let currentPayment: Awaited<ReturnType<typeof getAsaasPayment>>;
    try {
      currentPayment = await getAsaasPayment(paymentId);
    } catch (error) {
      const providerStatus = Number((error as { providerStatus?: unknown; statusCode?: unknown } | null)?.providerStatus ??
        (error as { statusCode?: unknown } | null)?.statusCode);
      const failure = new Error("PAYMENT_CURRENCY_PROVIDER_READ_FAILED");
      if (Number.isInteger(providerStatus) && providerStatus >= 100 && providerStatus <= 599) Object.assign(failure, { providerStatus });
      throw failure;
    }
    const providerObservedStatus = String(currentPayment.status ?? "").trim().toUpperCase();
    if (event === "PAYMENT_RECEIVED" && providerObservedStatus === "PENDING") {
      const failure = new Error(PAYMENT_RECEIVED_PROVIDER_STATUS_PENDING_CODE);
      Object.assign(failure, { providerObservedStatus });
      throw failure;
    }
    return { currentPayment,
      currencyVerification: { status: "verified", reason: "PROVIDER_PAYMENT_READ" } } satisfies AsaasWebhookPreflight;
  }
  // A strong STOCK reference identifies the attempt by itself: no provider resolution by paymentId is needed (nor wanted).
  const eventReference = (payload as any)?.payment?.externalReference ?? (payload as any)?.externalReference;
  const hasStrongReference = parseStockPaymentReference(typeof eventReference === "string" ? eventReference.trim() : eventReference).kind === "strong";
  const hasExplicitReference = rawReference !== undefined && rawReference !== null && String(rawReference).trim().length > 0;
  const needsResolution = !hasStrongReference && !hasExplicitReference && !parseOrderIdFromWebhook(payload as any) && !parseCheckoutIdFromWebhook(payload as any) && Boolean(paymentId);
  const selectedProviderEvents = new Set([
    "PAYMENT_CREATED", "PAYMENT_CONFIRMED", "PAYMENT_RECEIVED",
    "PAYMENT_CREDIT_CARD_CAPTURE_REFUSED", "PAYMENT_AWAITING_RISK_ANALYSIS", "PAYMENT_REPROVED_BY_RISK_ANALYSIS",
  ]);
  let needsSelectedProvider = false;
  if (captureRecoveryFence().reviewOnly && selectedProviderEvents.has(event)) {
    const reference = (payload as any)?.payment?.externalReference ?? (payload as any)?.externalReference;
    const selectedOrderId = parseAsaasOrderReference(reference);
    if (selectedOrderId) {
      const db = await getDb();
      if (!db) throw new Error("WEBHOOK_PERSISTENCE_UNAVAILABLE");
      try {
        const selected = await loadSelectedGrant(db, selectedOrderId, false);
        needsSelectedProvider = selected.d.request.paymentId === paymentId;
      } catch (error) {
        if (!(error instanceof AdmissionDenied)) throw error;
      }
    }
  }
  if (!paymentId || (!needsCurrentState && !needsResolution && !needsSelectedProvider)) return {};
  try {
    return { currentPayment: await getAsaasPayment(paymentId) } satisfies AsaasWebhookPreflight;
  } catch (error) {
    const providerStatus = Number((error as { providerStatus?: unknown; statusCode?: unknown } | null)?.providerStatus ??
      (error as { statusCode?: unknown } | null)?.statusCode);
    const failure = new Error(needsCurrentState ? "PAYMENT_CURRENT_STATE_UNAVAILABLE" :
      event === "PAYMENT_RECEIVED" ? "PAYMENT_CURRENCY_PROVIDER_READ_FAILED" : "PAYMENT_PROVIDER_RESOLUTION_FAILED");
    if (Number.isInteger(providerStatus) && providerStatus >= 100 && providerStatus <= 599)
      Object.assign(failure, { providerStatus });
    throw failure;
  }
};

export async function processWebhookEnvelope(
  payload: unknown,
  resolveStockRuntime: () => StockCheckoutRuntime | undefined = getConfiguredStockCheckoutRuntime,
  /** Original delivery headers. Present only for a live HTTP delivery; recovery/replay of a stored envelope has none. */
  deliveryHeaders?: Record<string, string | string[] | undefined>,
  providerPreflight?: AsaasWebhookPreflight,
): Promise<WebhookReply> {
  // An internal PAYMENT_RECEIVED replay must prove it was authenticated at HTTP
  // ingress before this wrapper can persist it into the durable inbox. Otherwise
  // an unauthenticated replay could reserve the event ID and poison later delivery.
  const event = String((payload as { event?: unknown } | null)?.event ?? "").trim();
  if (event === "PAYMENT_RECEIVED" && !deliveryHeaders && !(await hasVerifiedIngressProvenance(payload))) {
    return { status: 503, body: { handled: false, reason: "payment_replay_requires_authenticated_delivery", retryable: true } };
  }
  // Internal/admin callers must enter the same durable gate as HTTP and workers.
  const tx=webhookDb();
  if(!tx)return receiveWebhook(payload,
    (next, preflightResult) => processWebhookEnvelope(next, resolveStockRuntime, deliveryHeaders, preflightResult as AsaasWebhookPreflight | undefined),
    preflightAsaasWebhookEnvelope);
  const p=payload as {id?:string};
  if(p?.id)await assertNoRecoveryHold(tx,p.id);
  let status = 500;
  let body: Record<string, unknown> = { code: "WEBHOOK_PROCESSING_FAILED" };
  const response = { status(code: number) { status = code; return this; }, json(value: Record<string, unknown>) { body = value; return this; } };
  await processAsaasWebhook({ body: payload, ip: "inbox", headers: deliveryHeaders } as Request, response as unknown as Response, resolveStockRuntime, providerPreflight);
  return { status, body };
}
async function processAsaasWebhook(req: Request, res: Response, resolveStockRuntime: () => StockCheckoutRuntime | undefined, providerPreflight?: AsaasWebhookPreflight) {
  let stockBranch = false;
  try {
    const payload = req.body as any;
    const event = String(payload?.event || "").trim();

    // Keep this guard ahead of every observation and financial branch. A replay
    // without the original HTTP boundary may proceed only with a valid ingress MAC.
    if (event === "PAYMENT_RECEIVED" && !req.headers && !(await hasVerifiedIngressProvenance(payload))) {
      securityLog("warn", "payment.asaas_replay_requires_authenticated_delivery", { requestIp: req.ip || "unknown", event });
      res.status(503).json({ handled: false, reason: "payment_replay_requires_authenticated_delivery", retryable: true });
      return;
    }

    if (event !== "PAYMENT_CREATED" && event !== "PAYMENT_DELETED" && !OBSERVATION_EVENTS.has(event) && !PAID_EVENTS.has(event) && !FAILED_EVENTS.has(event) && !STOCK_PENDING_EVENTS.has(event) && !CARD_OBSERVATION_EVENTS.includes(event as any) && !PAYMENT_EXCEPTION_EVENTS.has(event)) {
      await persistAsaasReconciliationObservation(payload, { event, reason: "UNSUPPORTED_AUTHENTICATED_EVENT" });
      res.status(200).json({ handled: false, reason: "event_quarantined", reconciliationRequired: true,
        financialMutation: false, stockMutation: false });
      return;
    }

    let orderId = parseOrderIdFromWebhook(payload);
    let checkoutId = parseCheckoutIdFromWebhook(payload);
    const paymentId = parsePaymentIdFromWebhook(payload);
    const paymentStatus = parsePaymentStatusFromWebhook(payload);
    const currency = parseCurrencyFromWebhook(payload);
    if (PAYMENT_EXCEPTION_EVENTS.has(event) && !paymentId) {
      await persistAsaasReconciliationObservation(payload, {
        event, reason: "PAYMENT_ID_UNAVAILABLE", orderId, alertKind: reconciliationAlertKindForEvent(event),
      });
      res.status(200).json({ handled: false, reason: "payment_reconciliation_required", reconciliationRequired: true,
        financialMutation: false, stockMutation: false });
      return;
    }
    if (event === "PAYMENT_DELETED" && (!paymentId || payload?.payment?.deleted !== true)) {
      sendControllerError(res, 409, "PAYMENT_DELETION_INVALID", "A remoção exige identificação da cobrança e deleted=true.");
      return;
    }

    if (currency && currency !== "BRL") {
      await persistAsaasReconciliationObservation(payload, {
        event, reason: "WEBHOOK_CURRENCY_MISMATCH", orderId, paymentId, alertKind: "ASAAS_WEBHOOK_FINANCIAL_EXCEPTION",
      });
      res.status(200).json({ handled: false, reason: "payment_reconciliation_required", reconciliationRequired: true,
        financialMutation: false, stockMutation: false });
      return;
    }

    if (event === "PAYMENT_CREATED") {
      if (!paymentId || payload?.payment?.value === undefined || parsePaidValueCentsFromWebhook(payload) === null) {
        sendControllerError(res, 400, "PAYMENT_CREATED_INVALID", "A criação da cobrança não possui os dados necessários.");
        return;
      }
      if (paymentStatus !== "PENDING") {
        sendControllerError(res, 409, "PAYMENT_STATUS_MISMATCH", "O status da cobrança não corresponde ao evento de criação.");
        return;
      }
    }

    if (PAID_EVENTS.has(event) && paymentStatus && !PAID_PAYMENT_STATUSES.has(paymentStatus)) {
      if (event === "PAYMENT_RECEIVED") {
        await persistAsaasReconciliationObservation(payload, {
          event, reason: "WEBHOOK_EVENT_STATUS_NOT_RECEIVED", orderId, paymentId,
          alertKind: "ASAAS_WEBHOOK_FINANCIAL_EXCEPTION",
        });
        res.status(200).json({ handled: false, reason: "payment_reconciliation_required", reconciliationRequired: true,
          financialMutation: false, stockMutation: false });
        return;
      }
      sendControllerError(res, 409, "PAYMENT_STATUS_MISMATCH", "O status do pagamento não permite confirmar o pedido.");
      return;
    }

    if (FAILED_EVENTS.has(event) && paymentStatus && !FAILED_PAYMENT_STATUSES.has(paymentStatus)) {
      sendControllerError(res, 409, "PAYMENT_STATUS_MISMATCH", "O status do pagamento não corresponde ao evento recebido.");
      return;
    }

    // New STOCK charges carry a strong, non-reusable attempt reference (not a numeric order id). Resolve it from its persisted record.
    const rawEventReference = payload?.payment?.externalReference ?? payload?.externalReference;
    const parsedEventReference = parseStockPaymentReference(typeof rawEventReference === "string" ? rawEventReference.trim() : rawEventReference);
    let strongReference: string | null = null;
    if (!orderId && parsedEventReference.kind === "strong") {
      const db = webhookDb();
      if (!db) throw Error("PAYMENT_RECORD_TRANSACTION_REQUIRED");
      strongReference = parsedEventReference.reference;
      const resolvedOrderId = await resolveStrongStockReferenceOrderId(alertExecutorForDrizzle(db), strongReference);
      if (!resolvedOrderId) {
        // Unknown strong reference (e.g. issued before a restore): durable evidence + alert, never a silent ack and never a 503 loop.
        const eventId = String(payload.id ?? "");
        await insertAdmissionAudit(db, "payment.stock_reference_unknown.v1", "asaasWebhookInbox", eventKey(eventId), {
          eventId, paymentId, event, reconciliationRequired: true, financialMutation: false, stockMutation: false, notificationMutation: false,
        });
        await recordReconciliationAlert(alertExecutorForDrizzle(db), {
          kind: "STOCK_REFERENCE_RECONCILIATION", subject: { paymentId, eventKey: eventKey(eventId) }, providerEventId: eventId,
          observed: { status: paymentStatus ?? null }, reason: "STRONG_REFERENCE_UNKNOWN",
        });
        res.status(200).json({ handled: false, reason: "stock_event_conflict", reconciliationRequired: true });
        return;
      }
      orderId = resolvedOrderId;
    }

    if (!orderId && checkoutId) {
      const order = await getOrderByAsaasCheckoutId(checkoutId);
      orderId = order?.id ?? null;
    }

    if (!orderId && paymentId) {
      const payment = providerPreflight?.currentPayment;
      if (payment) {
        orderId = parseAsaasOrderReference(payment.externalReference);
        if (!checkoutId) checkoutId = payment.checkout?.id?.trim() || null;
        if (!orderId && checkoutId) {
          const order = await getOrderByAsaasCheckoutId(checkoutId);
          orderId = order?.id ?? null;
        }
      } else {
        securityLog("warn", "payment.asaas_webhook_resolve_failed", {
          paymentId, requestIp: req.ip || "unknown", reason: "provider_resolution_unavailable",
        });
      }
    }

    if (!orderId) {
      securityLog("warn", "payment.asaas_webhook_order_unresolved", {
        requestIp: req.ip || "unknown",
        event,
        paymentId,
        checkoutId,
      });
      const unresolvedReference = payload?.payment?.externalReference ?? payload?.externalReference;
      const paidObservation = event === "PAYMENT_RECEIVED" ||
        (PAID_EVENTS.has(event) && PAID_PAYMENT_STATUSES.has(paymentStatus ?? ""));
      await persistAsaasReconciliationObservation(payload, { event, reason: "ORDER_REFERENCE_UNRESOLVED", paymentId,
        unresolvedOrderReference: unresolvedReference === undefined || unresolvedReference === null ? null : String(unresolvedReference).trim(),
        observedAmountCents: parsePaidValueCentsFromWebhook(payload),
        ...(paidObservation ? { alertKind: "ASAAS_WEBHOOK_FINANCIAL_EXCEPTION" } : {}) });
      res.status(200).json({ handled: false, reason: "payment_reconciliation_required", reconciliationRequired: true,
        financialMutation: false, stockMutation: false });
      return;
    }

    const order = await getOrderById(orderId);
    if (!order) {
      securityLog("warn", "payment.asaas_webhook_order_missing", {
        requestIp: req.ip || "unknown",
        event,
        orderId,
        paymentId,
        checkoutId,
      });
      const unresolvedReference = payload?.payment?.externalReference ?? payload?.externalReference ?? String(orderId);
      const paidObservation = event === "PAYMENT_RECEIVED" ||
        (PAID_EVENTS.has(event) && PAID_PAYMENT_STATUSES.has(paymentStatus ?? ""));
      await persistAsaasReconciliationObservation(payload, {
        event, reason: "ORDER_NOT_FOUND", unresolvedOrderReference: String(unresolvedReference), paymentId,
        observedAmountCents: parsePaidValueCentsFromWebhook(payload),
        ...(paidObservation ? { alertKind: "ASAAS_WEBHOOK_FINANCIAL_EXCEPTION" } : {}),
      });
      res.status(200).json({ handled: false, reason: "payment_reconciliation_required", reconciliationRequired: true,
        financialMutation: false, stockMutation: false });
      return;
    }

    // STOCK payments require their own single-owner event dispatcher/ledger.
    // Never let the legacy handler mark them paid or consume product-level stock.
    if (order.stockAttemptId) {
      stockBranch = true;
      const runtime = resolveStockRuntime();
      if (!runtime) {
        securityLog("error", "payment.asaas_stock_owner_unavailable", { requestIp: req.ip || "unknown", orderId, event });
        res.status(503).json({ handled: false, reason: "stock_payment_owner_unavailable" });
        return;
      }

      const eventReference = payload?.payment?.externalReference ?? payload?.externalReference;
      const stockAttemptId = order.stockAttemptId;
      if (eventReference !== undefined && strongReference === null && String(eventReference).trim() !== String(orderId)) {
        const db = webhookDb();
        if (!db) throw Error("PAYMENT_RECORD_TRANSACTION_REQUIRED");
        const eventId = String(payload.id ?? "");
        await insertAdmissionAudit(db, "payment.stock_reference_reconciliation.v1", "asaasWebhookInbox", eventKey(eventId), {
          eventId, orderId, paymentId, event, observedExternalReference: String(eventReference).slice(0, 191),
          reconciliationRequired: true, financialMutation: false, stockMutation: false, notificationMutation: false,
        });
        await recordReconciliationAlert(alertExecutorForDrizzle(db), {
          kind: "STOCK_REFERENCE_RECONCILIATION", subject: { attemptId: stockAttemptId, orderId, paymentId }, orderId, providerEventId: eventId,
          observed: { status: paymentStatus ?? null }, reason: "EVENT_REFERENCE_DIFFERS_FROM_ORDER",
        });
        res.status(200).json({ handled: false, reason: "stock_event_conflict", reconciliationRequired: true });
        return;
      }

      if (event === "PAYMENT_OVERDUE") {
        if (!paymentId) {
          sendControllerError(res, 400, "PAYMENT_ID_REQUIRED", "A observação financeira exige identificação da cobrança.");
          return;
        }
        const db = webhookDb();
        if (!db) throw Error("PAYMENT_RECORD_TRANSACTION_REQUIRED");
        const eventId = String(payload.id ?? "");
        await insertAdmissionAudit(db, "payment.stock_overdue_observation.v1", "asaasWebhookInbox", eventKey(eventId), {
          eventId, orderId, paymentId, event, observedStatus: paymentStatus ?? null,
          reconciliationRequired: true, financialMutation: false, stockMutation: false, notificationMutation: false,
        });
        await recordReconciliationAlert(alertExecutorForDrizzle(db), {
          kind: "STOCK_OVERDUE_OBSERVED", subject: { attemptId: stockAttemptId, orderId, paymentId }, orderId, providerEventId: eventId,
          observed: { status: paymentStatus ?? null }, reason: "OVERDUE_OBSERVATION",
        });
        res.status(200).json({ handled: false, reason: "stock_overdue_observed", reconciliationRequired: true });
        return;
      }

      if (event === "PAYMENT_DELETED") {
        const current = providerPreflight?.currentPayment;
        if (!current) {
          sendControllerError(res, 503, "PAYMENT_CURRENT_STATE_UNAVAILABLE", "Não foi possível verificar o estado atual da cobrança.");
          return;
        }
        const currentStatus = typeof current.status === "string" ? current.status.trim().toUpperCase() : "";
        const currentAmountCents = typeof current.value === "number" && Number.isFinite(current.value)
          ? Math.round(current.value * 100) : null;
        const eventAmountCents = parsePaidValueCentsFromWebhook(payload);
        const currentCurrency = typeof current.currency === "string" ? current.currency.trim().toUpperCase() : null;
        const bindingMatches = current.id === paymentId &&
          String(current.externalReference ?? "").trim() === String(eventReference ?? "").trim() &&
          (strongReference !== null ? String(current.externalReference ?? "").trim() === strongReference : parseAsaasOrderReference(current.externalReference) === orderId);
        const moneyMatches = currentAmountCents !== null && currentAmountCents === eventAmountCents &&
          currency === "BRL" && (currentCurrency === null || currentCurrency === "BRL");
        const failedNow = (current.deleted === true || FAILED_PAYMENT_STATUSES.has(currentStatus)) && !PAID_PAYMENT_STATUSES.has(currentStatus);
        if (!bindingMatches || !moneyMatches || !failedNow) {
          const db = webhookDb();
          if (!db) throw Error("PAYMENT_RECORD_TRANSACTION_REQUIRED");
          const eventId = String(payload.id ?? "");
          await insertAdmissionAudit(db, "payment.stock_deleted_reconciliation.v1", "asaasWebhookInbox", eventKey(eventId), {
            eventId, orderId, paymentId, event, currentPaymentId: current.id ?? null,
            currentOrderReference: current.externalReference ?? null, eventOrderReference: eventReference ?? null, currentStatus: currentStatus || null,
            currentDeleted: current.deleted ?? null, currentAmountCents, eventAmountCents, currentCurrency,
            reason: !bindingMatches || !moneyMatches ? "PROVIDER_BINDING_AMBIGUOUS" : "CURRENT_CHARGE_NOT_TERMINAL",
            reconciliationRequired: true, financialMutation: false, stockMutation: false, notificationMutation: false,
          });
          await recordReconciliationAlert(alertExecutorForDrizzle(db), {
            kind: "STOCK_PAYMENT_DELETED_UNCONFIRMED", subject: { attemptId: stockAttemptId, orderId, paymentId }, orderId, providerEventId: eventId,
            observed: { status: currentStatus || null, amountCents: eventAmountCents }, reason: !bindingMatches || !moneyMatches ? "PROVIDER_BINDING_AMBIGUOUS" : "CURRENT_CHARGE_NOT_TERMINAL",
          });
          res.status(200).json({ handled: false, reason: "stock_failure_not_confirmed", reconciliationRequired: true });
          return;
        }
      }

      if (PAYMENT_EXCEPTION_EVENTS.has(event)) {
        const eventId = String(payload.id ?? "");
        await recordPaymentException({ orderId: order.id, eventId, event, paymentId, checkoutId });
        await persistAsaasReconciliationObservation(payload, {
          event, reason: "PROVIDER_FINANCIAL_OBSERVATION", orderId: order.id, attemptId: stockAttemptId, paymentId,
          alertKind: reconciliationAlertKindForEvent(event),
        });
        res.status(200).json({ handled: false, reason: "payment_reconciliation_required", reconciliationRequired: true,
          financialMutation: false, stockMutation: false });
        return;
      }

      // Asaas's documented billing payload omits `payment.currency`. For STOCK receipts,
      // only an exact read through the configured Asaas account may supply that evidence.
      // The read ran in preflight, before inbox/business locks. Missing or ambiguous evidence
      // becomes an idempotent durable reconciliation record; it never changes payment or stock.
      if (event === "PAYMENT_RECEIVED") {
        const current = providerPreflight?.currentPayment;
        const eventAmountCents = parsePaidValueCentsFromWebhook(payload);
        const currentAmountCents = typeof current?.value === "number" && Number.isFinite(current.value)
          ? Math.round(current.value * 100) : null;
        const currentCurrency = typeof current?.currency === "string" ? current.currency.trim().toUpperCase() : "";
        const verifiedCurrency = currentCurrency || pinnedAccountCurrencyForReceived(payload, event) || "";
        const currentCustomer = typeof current?.customer === "string" ? current.customer.trim() : "";
        const eventReference = payload?.payment?.externalReference ?? payload?.externalReference;
        let expectedCustomer = "";
        const db = webhookDb();
        if (!db) throw Error("PAYMENT_RECORD_TRANSACTION_REQUIRED");
        const customerRecords = await db.select({ metadata: auditLogs.metadata }).from(auditLogs)
          .where(sql`action=${STOCK_PAYMENT_CUSTOMER_ACTION} AND entity='stockCheckoutAttempt' AND entityId=${stockAttemptId} AND orderId=${order.id}`)
          .limit(2);
        if (customerRecords.length === 1 && customerRecords[0].metadata) {
          try {
            const metadata = JSON.parse(customerRecords[0].metadata);
            if (metadata.paymentId === paymentId && typeof metadata.providerCustomerId === "string") expectedCustomer = metadata.providerCustomerId;
          } catch { /* missing or malformed durable customer binding remains unverified */ }
        }
        const accountId = typeof payload?.account?.id === "string" ? payload.account.id.trim() : "";
        const expectedAccount = process.env.ASAAS_WEBHOOK_ACCOUNT_ID?.trim() ?? "";
        const proof = providerPreflight?.currencyVerification;
        const providerStatus = String(current?.status ?? "").trim().toUpperCase();
        const observedBillingType = typeof payload?.payment?.billingType === "string"
          ? payload.payment.billingType.trim().toUpperCase() : "";
        const providerObservedBillingType = typeof current?.billingType === "string"
          ? current.billingType.trim().toUpperCase() : "";
        const billingTypeMatches = observedBillingType === "PIX" && providerObservedBillingType === "PIX";
        const verified = proof?.status === "verified" && current && expectedAccount && accountId === expectedAccount &&
          current.id === paymentId && String(current.externalReference ?? "").trim() === String(eventReference ?? "").trim() &&
          eventAmountCents !== null && currentAmountCents === eventAmountCents && verifiedCurrency === "BRL" &&
          (!currency || currency === verifiedCurrency) &&
          Boolean(expectedCustomer) && currentCustomer === expectedCustomer && providerStatus === "RECEIVED" &&
          billingTypeMatches && current.deleted !== true;
        if (!verified) {
          await persistAsaasReconciliationObservation(payload, {
            event, reason: proof?.status === "verified"
              ? providerStatus !== "RECEIVED" ? "PROVIDER_STATUS_NOT_RECEIVED"
                : !billingTypeMatches ? "PROVIDER_BILLING_TYPE_MISMATCH" : "PROVIDER_PAYMENT_BINDING_UNVERIFIED"
              : proof?.reason ?? "PROVIDER_PAYMENT_BINDING_UNVERIFIED", orderId: order.id,
            providerObservedStatus: providerStatus || null,
            observedBillingType: observedBillingType || null, providerObservedBillingType: providerObservedBillingType || null,
            attemptId: stockAttemptId, paymentId, observedAmountCents: eventAmountCents,
            expectedAmountCents: Number(order.totalPrice), alertKind: event === "PAYMENT_RECEIVED"
              ? "ASAAS_WEBHOOK_FINANCIAL_EXCEPTION" : reconciliationAlertKindForEvent(event),
          });
          res.status(200).json({ handled: false, reason: "payment_reconciliation_required", reconciliationRequired: true,
            financialMutation: false, stockMutation: false });
          return;
        }
      }

      // The STOCK owner re-verifies the provider token from the ORIGINAL delivery headers. A stored envelope replayed by
      // recovery has none, so it can never be authenticated here: fail closed (retryable) and wait for an authenticated redelivery.
      const currentProviderCurrency = typeof providerPreflight?.currentPayment?.currency === "string"
        ? providerPreflight.currentPayment.currency.trim().toUpperCase() : "";
      const accountCurrencyFallback = pinnedAccountCurrencyForReceived(payload, event);
      const baseBoundary = !currency && providerPreflight?.currencyVerification?.status === "verified"
        ? createAsaasStockWebhookBoundary({ verifiedProviderCurrency: currentProviderCurrency || accountCurrencyFallback })
        : createAsaasStockWebhookBoundary();
      let boundary = baseBoundary;
      if (!req.headers) boundary = { ...baseBoundary, verifySignature: async () => true };
      const result = await runtime.receiveWebhook({
        rawBody: JSON.stringify(payload),
        headers: (req.headers ?? {}) as Record<string, string | string[] | undefined>,
        boundary,
      });
      if (result === "conflict") {
        securityLog("warn", "payment.asaas_stock_event_conflict_acknowledged", { requestIp: req.ip || "unknown", orderId, event, paymentId });
        res.status(200).json({ handled: false, reason: "stock_event_conflict" });
        return;
      }
      securityLog("info", result === "duplicate" ? "payment.asaas_stock_webhook_duplicate" : "payment.asaas_stock_webhook_processed", {
        requestIp: req.ip || "unknown", orderId, event, paymentId,
      });
      if (result === "processed" && PAID_EVENTS.has(event)) {
        // The approval e-mail was queued in the settlement commit; deliver it now (post-commit). Failure is non-fatal: the worker retries.
        try { await deliverPaymentNotifications(1, Number(order.id), "payment-approved-email-v1"); }
        catch { console.warn("[PaymentNotification] stock_immediate_delivery_deferred"); }
      }
      res.status(200).json({ handled: result === "processed", reason: result === "duplicate" ? "duplicate_event" : undefined, event, orderId });
      return;
    }

    if (STOCK_PENDING_EVENTS.has(event) && event !== "PAYMENT_CREATED") {
      // STOCK-only provider states are not meaningful for legacy orders (PAYMENT_CREATED keeps its V6 handling below).
      res.status(200).json({ handled: false, reason: "event_ignored" });
      return;
    }

    // The official Asaas billing example omits payment.currency. Never infer BRL
    // from that omission, including for legacy orders. A point-in-time provider
    // read is performed during preflight, before this inbox transaction/locks.
    if (PAID_EVENTS.has(event)) {
      const current = providerPreflight?.currentPayment;
      const eventAmountCents = parsePaidValueCentsFromWebhook(payload);
      const providerAmountCents = typeof current?.value === "number" && Number.isFinite(current.value)
        ? Math.round(current.value * 100) : null;
      const accountId = typeof payload?.account?.id === "string" ? payload.account.id.trim() : "";
      const expectedAccount = process.env.ASAAS_WEBHOOK_ACCOUNT_ID?.trim() ?? "";
      const eventReference = payload?.payment?.externalReference ?? payload?.externalReference;
      const db = webhookDb();
      if (!db) throw Error("PAYMENT_RECORD_TRANSACTION_REQUIRED");
      const [localPaymentRows] = await db.execute(sql`SELECT providerPaymentId,amount,externalReference,billingType FROM payments WHERE orderId=${orderId} LIMIT 2`);
      const localPayments = localPaymentRows as unknown as Array<{ providerPaymentId: string | null; amount: number; externalReference: string; billingType: string | null }>;
      const localUsers = await db.select({ asaasCustomerId: users.asaasCustomerId }).from(users).where(sql`id=${order.userId}`).limit(2);
      const localPayment = localPayments.length === 1 ? localPayments[0] : undefined;
      const customerId = localUsers.length === 1 ? localUsers[0].asaasCustomerId?.trim() : "";
      const currentReference = typeof current?.externalReference === "string" ? current.externalReference.trim() : "";
      const currentCustomer = typeof current?.customer === "string" ? current.customer.trim() : "";
      const currentCurrency = typeof current?.currency === "string" ? current.currency.trim().toUpperCase() : "";
      const verifiedCurrency = currentCurrency || pinnedAccountCurrencyForReceived(payload, event) || "";
      const currentStatus = String(current?.status ?? "").trim().toUpperCase();
      const expectedBillingType = String(localPayment?.billingType ?? "").trim().toUpperCase();
      const observedBillingType = typeof payload?.payment?.billingType === "string"
        ? payload.payment.billingType.trim().toUpperCase() : "";
      const providerObservedBillingType = typeof current?.billingType === "string"
        ? current.billingType.trim().toUpperCase() : "";
      // Bind every paid event to the method persisted for this order. Checking
      // only PIX leaves legacy card/boleto rows able to settle on a contradictory
      // webhook or authoritative provider response.
      const supportedBillingType = ["PIX", "CREDIT_CARD", "BOLETO"].includes(expectedBillingType);
      const billingTypeMismatch = !supportedBillingType || observedBillingType !== expectedBillingType ||
        providerObservedBillingType !== expectedBillingType;
      const verified = providerPreflight?.currencyVerification?.status === "verified" && current && expectedAccount &&
        accountId === expectedAccount && current.id === paymentId && currentReference &&
        currentReference === String(eventReference ?? "").trim() && parseAsaasOrderReference(currentReference) === orderId &&
        localPayment?.providerPaymentId === paymentId && localPayment.amount === Number(order.totalPrice) &&
        parseAsaasOrderReference(localPayment.externalReference) === orderId &&
        eventAmountCents !== null && eventAmountCents === Number(order.totalPrice) && providerAmountCents === eventAmountCents &&
        verifiedCurrency === "BRL" && (!currency || currency === verifiedCurrency) && Boolean(customerId) && currentCustomer === customerId &&
        (event === "PAYMENT_RECEIVED" ? currentStatus === "RECEIVED" : PAID_PAYMENT_STATUSES.has(currentStatus)) &&
        !billingTypeMismatch && current.deleted !== true;
      if (!verified) {
        await persistAsaasReconciliationObservation(payload, {
          event, reason: providerPreflight?.currencyVerification?.status === "verified"
            ? (event === "PAYMENT_RECEIVED" && currentStatus !== "RECEIVED" ? "PROVIDER_STATUS_NOT_RECEIVED"
              : billingTypeMismatch ? "PROVIDER_BILLING_TYPE_MISMATCH" : "PROVIDER_PAYMENT_BINDING_UNVERIFIED")
            : providerPreflight?.currencyVerification?.reason ?? "PROVIDER_PAYMENT_BINDING_UNVERIFIED",
          orderId, paymentId, providerObservedStatus: currentStatus || null,
          observedBillingType: observedBillingType || null, providerObservedBillingType: providerObservedBillingType || null,
          observedAmountCents: eventAmountCents, expectedAmountCents: Number(order.totalPrice),
          alertKind: event === "PAYMENT_RECEIVED" ? "ASAAS_WEBHOOK_FINANCIAL_EXCEPTION" : reconciliationAlertKindForEvent(event),
        });
        res.status(200).json({ handled: false, reason: "payment_reconciliation_required", reconciliationRequired: true,
          financialMutation: false, stockMutation: false });
        return;
      }
    }

    const paidValueCents = parsePaidValueCentsFromWebhook(payload);
    if ((PAID_EVENTS.has(event) || event === "PAYMENT_CREATED") && paidValueCents !== null && paidValueCents !== Number(order.totalPrice)) {
      await persistAsaasReconciliationObservation(payload, {
        event, reason: "WEBHOOK_AMOUNT_MISMATCH", orderId, paymentId, observedAmountCents: paidValueCents,
        expectedAmountCents: Number(order.totalPrice), alertKind: reconciliationAlertKindForEvent(event),
      });
      res.status(200).json({ handled: false, reason: "payment_reconciliation_required", reconciliationRequired: true,
        financialMutation: false, stockMutation: false });
      return;
    }

    let deletionObservation: Parameters<typeof recordPaymentException>[0]["observation"];
    if (event === "PAYMENT_DELETED") {
      const currentPayment = providerPreflight?.currentPayment;
      if (!currentPayment) {
        sendControllerError(res, 503, "PAYMENT_CURRENT_STATE_UNAVAILABLE", "Não foi possível verificar o estado atual da cobrança.");
        return;
      }
      if (currentPayment.id !== paymentId || parseAsaasOrderReference(currentPayment.externalReference) !== orderId) {
        sendControllerError(res, 409, "PAYMENT_RECORD_BINDING_MISMATCH", "A cobrança não corresponde ao pedido informado.");
        return;
      }
      // An old deletion can arrive after restoration/payment. Record both facts
      // for review; it never cancels, refunds, downgrades or releases stock.
      deletionObservation = {
        eventDeleted: true,
        currentDeleted: typeof currentPayment.deleted === "boolean" ? currentPayment.deleted : null,
        currentStatus: currentPayment.status ?? null,
        currentAmountCents: typeof currentPayment.value === "number" && Number.isFinite(currentPayment.value) ? Math.round(currentPayment.value * 100) : null,
        eventAmountCents: paidValueCents,
      };
    }

    const eventId = parseEventIdFromWebhook(payload, { event, paymentId, checkoutId, orderId });
    if (!eventId) {
      sendControllerError(res, 400, "WEBHOOK_EVENT_ID_REQUIRED", "A notificação não possui identificador idempotente.");
      return;
    }

    const execution = await runAsaasWebhookOnce(
      {
        eventId,
        eventType: event,
        paymentId,
        checkoutId,
        orderId,
        payload,
        sourcePayloadHash: payload.sourcePayloadHash,
      },
      async () => {
        // Record the validated observation in the existing durable ledger only.
        // Creation does not authorize payment, stock consumption or notifications.
        if (event === "PAYMENT_CREATED" || OBSERVATION_EVENTS.has(event)) return { updated: false };
        if (CARD_OBSERVATION_EVENTS.includes(event as any)) {
          await validatePaymentObservationBinding(orderId, paymentId);
          const db = webhookDb();
          if (!db) throw Error("PAYMENT_RECORD_TRANSACTION_REQUIRED");
          const pending = event === "PAYMENT_AWAITING_RISK_ANALYSIS";
          await insertAdmissionAudit(db, "payment.card_observation.v1", "asaasWebhookInbox", eventKey(eventId), {
            eventId, orderId, paymentId, event, reconciliationRequired: !pending,
            financialMutation: false, stockMutation: false, notificationMutation: false,
          });
          return { updated: false, reconciliationRequired: !pending,
            selectiveCardReview: !pending && selectedMethodPolicy("CARD") };
        }
        if (PAYMENT_EXCEPTION_EVENTS.has(event) || event === "PAYMENT_DELETED" || (PAID_EVENTS.has(event) && order.status === "cancelled")) {
          await validatePaymentObservationBinding(orderId, paymentId);
          await recordPaymentException({ orderId, eventId, event, paymentId, checkoutId, ...(deletionObservation ? { observation: deletionObservation } : {}) });
          await persistAsaasReconciliationObservation(payload, {
            event, reason: "PROVIDER_FINANCIAL_OBSERVATION", orderId, paymentId,
            alertKind: reconciliationAlertKindForEvent(event),
          });
          return { updated: false, reconciliationRequired: true };
        }
        let result: { updated: boolean; invalidTransition?: boolean; reviewReceiptRecorded?: boolean; reconciliationRequired?: boolean; lowStockProducts?: ReadonlyArray<{ id: number; name: string; stock: number }> } = { updated: false };
        if (PAID_EVENTS.has(event)) {
          const binding = await validatePaymentBinding(order.id, paymentId, Number(order.totalPrice));
          if (binding?.billingType === "PIX" && event !== "PAYMENT_RECEIVED") {
            await persistAsaasReconciliationObservation(payload, {
              event, reason: "PIX_PAYMENT_RECEIVED_REQUIRED", orderId: order.id, paymentId,
              alertKind: "ASAAS_WEBHOOK_RECONCILIATION",
            });
            result = { updated: false, reconciliationRequired: true };
          } else if (order.status === "cancelled") {
            result = { updated: false, invalidTransition: true };
          } else {
            result = await markOrderPaid(orderId, {
              source: "asaas_webhook",
              reference: eventId,
            });
          }
        }

        if (result.reviewReceiptRecorded)
          await recordSelectedBoletoReview(order.id, paymentId, event === "PAYMENT_RECEIVED", eventId);
        if (PAID_EVENTS.has(event) && !result.invalidTransition && !result.reconciliationRequired && order.status !== "cancelled") {
          await recordTrustedPaymentReceipt(order.id, paymentId, event === "PAYMENT_RECEIVED");
        }
        if (PAID_EVENTS.has(event) && result.updated) {
          const purchased = await getOrderReservationItems(order.id);
          await enqueuePaymentApproved(order.id, {
            salesMode: purchasedSalesMode(purchased), scheduleMessages: purchasedScheduleMessages(purchased),
            orderNumber: String(order.id), total: formatCurrency(order.totalPrice / 100),
          });
        }
        await afterWebhookCommit(async () => {
          const user = await getUserById(order.userId);
          const orderItems = PAID_EVENTS.has(event) ? await getOrderReservationItems(order.id) : [];
          if (user?.email) {
            try {
              if (PAID_EVENTS.has(event) && result.updated) {
                await deliverPaymentNotifications(1, order.id, "payment-approved-email-v1");
                await sendInternalNewSaleAlertEmail({
                  customerName: user.name || "Cliente",
                  customerEmail: user.email,
                  orderNumber: String(order.id),
                  total: formatCurrency(order.totalPrice / 100),
                  items: orderItems.map(item => ({
                    id: item.productId,
                    name: item.productName || `Produto #${item.productId}`,
                    price: formatCurrency((Number(item.productPrice || 0) * Number(item.quantity || 1)) / 100),
                    imageUrl: item.productImage || "",
                  })),
                  orderUrl: `${String(process.env.APP_URL || process.env.APP_BASE_URL || process.env.FRONTEND_URL || "https://l4ckos.com.br").replace(/\/$/, "")}/meus-pedidos/${order.id}`,
                });
                if (Array.isArray((result as any).lowStockProducts) && (result as any).lowStockProducts.length > 0) {
                  await sendInternalLowStockAlertEmail({
                    products: (result as any).lowStockProducts,
                  });
                }
              } else if (FAILED_EVENTS.has(event) && !["paid", "processing", "shipped", "delivered", "cancelled"].includes(order.status)) {
                await sendPaymentFailedEmail({
                  customerEmail: user.email,
                  customerName: user.name || "Cliente",
                  orderNumber: String(order.id),
                  total: formatCurrency(order.totalPrice / 100),
                  paymentUrl: `${String(process.env.APP_URL || process.env.APP_BASE_URL || process.env.FRONTEND_URL || "https://l4ckos.com.br").replace(/\/$/, "")}/checkout`,
                  failureReason: "A operadora ou o provedor não confirmou o pagamento.",
                });
                await sendInternalPaymentFailedAlertEmail({
                  customerName: user.name || "Cliente",
                  customerEmail: user.email,
                  orderNumber: String(order.id),
                  total: formatCurrency(order.totalPrice / 100),
                  failureReason: "A operadora ou o provedor não confirmou o pagamento.",
                });
              }
            } catch (error) {
              securityLog("warn", PAID_EVENTS.has(event) ? "email.payment_approved_failed" : "email.payment_failed_notification_failed", {
                orderId,
                reason: "notification_failed",
              });
            }
          }

        });
        return result;
      },
    );

    if (execution.duplicate) {
      securityLog("warn", "payment.asaas_webhook_duplicate_ignored", {
        requestIp: req.ip || "unknown",
        event,
        paymentId,
        checkoutId,
      });
      res.status(200).json({ handled: false, reason: "duplicate_event" });
      return;
    }

    const result = execution.result ?? { updated: false };
    if ((result as any).invalidTransition) {
      res.status(200).json({ handled: false, reason: "invalid_status_transition", ...((result as any).reviewReceiptRecorded ? { reviewReceiptRecorded: true } : {}) });
      return;
    }

    securityLog("info", "payment.asaas_webhook_processed", {
      requestIp: req.ip || "unknown",
      event,
      orderId,
      paymentId,
      checkoutId,
      updated: result.updated,
    });

    res.status(200).json({ handled: true, event, orderId, ...((result as any).selectiveCardReview ? { selectiveCardReview: true } : {}), ...((result as any).reconciliationRequired ? { reconciliationRequired: true, financialMutation: false } : {}) });
  } catch (error) {
    securityLog("error", "payment.asaas_webhook_failed", {
      requestIp: req.ip || "unknown",
      reason: "webhook_processing_failed",
    });
    if (error instanceof Error && error.message === "PAYMENT_RECORD_BINDING_MISMATCH") {
      sendControllerError(res, 409, "PAYMENT_RECORD_BINDING_MISMATCH", "A cobrança não corresponde ao registro do pedido.");
      return;
    }
    if (error instanceof Error && error.message === "WEBHOOK_EVENT_CONFLICT") {
      sendControllerError(res, 409, "WEBHOOK_EVENT_CONFLICT", "O evento recebido diverge do registro financeiro.");
      return;
    }
    if (error instanceof StockCheckoutError && error.code.startsWith("WEBHOOK_")) {
      sendControllerError(res, 400, "WEBHOOK_EVENT_INVALID", "A notificação de pagamento não pôde ser validada.");
      return;
    }
    if (stockBranch) {
      res.status(503).json({ success: false, code: "WEBHOOK_PROCESSING_RETRYABLE", message: "Não foi possível processar a notificação.", status: 503 });
      return;
    }
    sendControllerError(res, 500, "WEBHOOK_PROCESSING_FAILED", "Não foi possível processar a notificação.");
  }
}

export const asaasWebhookHandler = createAsaasWebhookHandler(getConfiguredStockCheckoutRuntime);
