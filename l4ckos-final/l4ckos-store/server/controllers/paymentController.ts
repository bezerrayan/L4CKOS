import type { Request, Response } from "express";
import { z } from "zod";
import {
  getOrderByAsaasCheckoutId,
  getOrderById,
  getOrderReservationItems,
  getOrderByIdAndUser,
  markOrderPaid,
  getUserById,
  getUserPhoneById,
  runAsaasWebhookOnce,
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
import { buildApiErrorResponse } from "../_core/appErrors";
import { getAllowedOrigins } from "../_core/corsPolicy";
import { formatCurrency } from "../utils/email/formatCurrency.js";
import {
  sendInternalLowStockAlertEmail,
  sendInternalNewSaleAlertEmail,
  sendInternalPaymentFailedAlertEmail,
  sendPaymentApprovedEmail,
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

const PAID_EVENTS = new Set(["PAYMENT_RECEIVED", "PAYMENT_CONFIRMED", "PAYMENT_OVERDUE_RECEIVED"]);
const FAILED_EVENTS = new Set(["PAYMENT_REFUSED", "PAYMENT_DELETED", "PAYMENT_REPROVED", "PAYMENT_FAILED"]);
const PAID_PAYMENT_STATUSES = new Set(["RECEIVED", "CONFIRMED", "RECEIVED_IN_CASH"]);
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
  const parsed = Number(ref);
  if (Number.isInteger(parsed) && parsed > 0) return parsed;
  return null;
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

function parsePaidValueCentsFromWebhook(payload: any): number | null {
  const value = payload?.payment?.value ?? payload?.payment?.netValue ?? payload?.value;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) return null;
  return Math.round(parsed * 100);
}

async function ensureAsaasCustomerForUser(input: {
  userId: number;
  cpf?: string;
  phone?: string;
}) {
  const user = await getUserById(input.userId);
  if (!user) {
    throw new Error("User not found");
  }

  if (user.asaasCustomerId) {
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

    const { asaasCustomerId } = await ensureAsaasCustomerForUser({
      userId,
      cpf: body.cpf,
      phone: body.phone,
    });

    const order = await getOrderByIdAndUser(orderId, userId);
    if (!order) {
      sendControllerError(res, 404, "ORDER_NOT_FOUND", "Pedido não encontrado.");
      return;
    }

    const checkout = await createAsaasCheckout({
      name: body.checkoutName?.trim() || `Pedido #${order.id}`,
      value: Number((order.totalPrice / 100).toFixed(2)),
      billingTypes: body.billingTypes?.length ? body.billingTypes : ["PIX", "CREDIT_CARD"],
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
    securityLog("warn", "payment.create_checkout_failed", {
      requestIp: req.ip || "unknown",
      reason: error instanceof Error ? error.message : "unknown",
    });
    sendControllerError(res, 400, "CHECKOUT_CREATE_FAILED", "Não foi possível gerar a cobrança agora.");
  }
}

export async function asaasWebhookHandler(req: Request, res: Response) {
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

    const payload = req.body as any;
    const event = String(payload?.event || "").trim();

    if (!PAID_EVENTS.has(event) && !FAILED_EVENTS.has(event)) {
      res.status(200).json({ handled: false, reason: "event_ignored" });
      return;
    }

    let orderId = parseOrderIdFromWebhook(payload);
    let checkoutId = parseCheckoutIdFromWebhook(payload);
    const paymentId = parsePaymentIdFromWebhook(payload);
    const paymentStatus = parsePaymentStatusFromWebhook(payload);
    const currency = parseCurrencyFromWebhook(payload);

    if (currency && currency !== "BRL") {
      sendControllerError(res, 409, "PAYMENT_CURRENCY_MISMATCH", "A moeda do pagamento não corresponde ao pedido.");
      return;
    }

    if (PAID_EVENTS.has(event) && paymentStatus && !PAID_PAYMENT_STATUSES.has(paymentStatus)) {
      sendControllerError(res, 409, "PAYMENT_STATUS_MISMATCH", "O status do pagamento não permite confirmar o pedido.");
      return;
    }

    if (FAILED_EVENTS.has(event) && paymentStatus && !FAILED_PAYMENT_STATUSES.has(paymentStatus)) {
      sendControllerError(res, 409, "PAYMENT_STATUS_MISMATCH", "O status do pagamento não corresponde ao evento recebido.");
      return;
    }

    if (!orderId && checkoutId) {
      const order = await getOrderByAsaasCheckoutId(checkoutId);
      orderId = order?.id ?? null;
    }

    if (!orderId && paymentId) {
      try {
        const payment = await getAsaasPayment(paymentId);
        orderId = Number(payment?.externalReference) || null;
        if (!checkoutId) {
          checkoutId = payment?.checkout?.id?.trim() || null;
        }
        if (!orderId && checkoutId) {
          const order = await getOrderByAsaasCheckoutId(checkoutId);
          orderId = order?.id ?? null;
        }
      } catch (error) {
        securityLog("warn", "payment.asaas_webhook_resolve_failed", {
          paymentId,
          requestIp: req.ip || "unknown",
          reason: error instanceof Error ? error.message : String(error),
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
      res.status(200).json({ handled: false, reason: "order_not_resolved" });
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
      res.status(200).json({ handled: false, reason: "order_not_found" });
      return;
    }

    const paidValueCents = parsePaidValueCentsFromWebhook(payload);
    if (PAID_EVENTS.has(event) && paidValueCents !== null && paidValueCents !== Number(order.totalPrice)) {
      securityLog("error", "payment.asaas_webhook_amount_mismatch", {
        requestIp: req.ip || "unknown",
        event,
        orderId,
        paymentId,
        checkoutId,
      });
      sendControllerError(res, 409, "PAYMENT_AMOUNT_MISMATCH", "O valor pago não corresponde ao pedido.");
      return;
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
      },
      async () => {
        let result: { updated: boolean; invalidTransition?: boolean; lowStockProducts?: ReadonlyArray<{ id: number; name: string; stock: number }> } = { updated: false };
        if (PAID_EVENTS.has(event)) {
          if (!["pending", "processing"].includes(order.status)) {
            result = { updated: false, invalidTransition: true };
          } else {
            result = await markOrderPaid(orderId);
          }
        }

        const user = await getUserById(order.userId);
        const orderItems = PAID_EVENTS.has(event) ? await getOrderReservationItems(order.id) : [];
        if (user?.email) {
          try {
            if (PAID_EVENTS.has(event) && result.updated) {
              await sendPaymentApprovedEmail({
                customerEmail: user.email,
                customerName: user.name || "Cliente",
                orderNumber: String(order.id),
                total: formatCurrency(order.totalPrice / 100),
              });
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
            } else if (FAILED_EVENTS.has(event)) {
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
              reason: error instanceof Error ? error.message : "unknown",
            });
          }
        }

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
      res.status(200).json({ handled: false, reason: "invalid_status_transition" });
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

    res.status(200).json({ handled: true, event, orderId });
  } catch (error) {
    securityLog("error", "payment.asaas_webhook_failed", {
      requestIp: req.ip || "unknown",
      reason: error instanceof Error ? error.message : "unknown",
    });
    sendControllerError(res, 500, "WEBHOOK_PROCESSING_FAILED", "Não foi possível processar a notificação.");
  }
}
