import type { Request, Response } from "express";
import {
  getOrderByAsaasCheckoutId,
  getOrderByIdAndUser,
  processAsaasPaymentEvent,
  getUserById,
  getUserPhoneById,
  setOrderAsaasCheckoutId,
  updateUserAsaasCustomerId,
} from "../db";
import {
  createAsaasCheckout,
  createAsaasCustomer,
  getAsaasPayment,
  validateAsaasWebhookSignature,
} from "../services/asaasService";
import { deterministicWebhookEventId, sanitizeWebhookPayload } from "../services/checkoutIntegrity";
import { securityLog } from "../_core/security";
import { buildApiErrorResponse } from "../_core/appErrors";
import { sendInternalLowStockAlertEmail } from "../services/emailService.js";
import { getCheckoutAvailability } from "../_core/operationalConfig";

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

function isTrustedRedirectUrl(redirectUrl: string) {
  try {
    const url = new URL(redirectUrl);
    const configuredOrigins = String(process.env.CORS_ORIGINS ?? "")
      .split(",")
      .map(item => item.trim())
      .filter(Boolean);

    return configuredOrigins.some(origin => {
      try {
        const allowed = new URL(origin);
        return allowed.host === url.host;
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
    const availability = getCheckoutAvailability();
    if (!availability.available) {
      sendControllerError(res, 503, availability.code || "CHECKOUT_DISABLED", availability.message || "Checkout indisponível.");
      return;
    }
    const authReq = req as AuthenticatedRequest;
    const userId = authReq.authUser?.id;
    if (!userId) {
      sendControllerError(res, 401, "AUTH_REQUIRED", "Faça login para continuar.");
      return;
    }

    const result = await ensureAsaasCustomerForUser({
      userId,
      cpf: (req.body as any)?.cpf,
      phone: (req.body as any)?.phone,
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
  sendControllerError(
    res,
    410,
    "LEGACY_CHECKOUT_DISABLED",
    "Este fluxo foi substituído pelo checkout transacional e idempotente.",
  );
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
    const providerEventId = String(payload?.id || "").trim() || deterministicWebhookEventId(payload);
    const providerPaymentId = parsePaymentIdFromWebhook(payload);
    const externalReference = String(payload?.payment?.externalReference ?? payload?.externalReference ?? "").trim() || null;
    const rawValue = Number(payload?.payment?.value);
    const amountCents = Number.isFinite(rawValue) ? Math.round(rawValue * 100) : null;
    const rawRefundedValue = Number(payload?.payment?.refundedValue);
    const refundedAmountCents = Number.isFinite(rawRefundedValue) ? Math.round(rawRefundedValue * 100) : null;
    const correlationId = String(req.headers["x-correlation-id"] || providerEventId).slice(0, 191);
    const result = await processAsaasPaymentEvent({
      providerEventId,
      eventType: event || "UNKNOWN",
      providerPaymentId,
      externalReference,
      amountCents,
      refundedAmountCents,
      sanitizedPayload: sanitizeWebhookPayload(payload),
      source: "webhook",
      correlationId,
    });

    if (result.duplicate) {
      res.status(200).json({ handled: true, duplicate: true, event });
      return;
    }

    const orderId = result.orderId;

    securityLog("info", "payment.asaas_webhook_processed", {
      requestIp: req.ip || "unknown",
      event,
      orderId,
      paymentId: providerPaymentId,
      correlationId,
      duplicate: false,
      conflict: Boolean(result.conflict),
    });

    res.status(200).json({ handled: true, event, orderId, conflict: Boolean(result.conflict), reason: result.reason ?? null });
  } catch (error) {
    securityLog("error", "payment.asaas_webhook_failed", {
      requestIp: req.ip || "unknown",
      reason: error instanceof Error ? error.message : "unknown",
    });
    sendControllerError(res, 500, "WEBHOOK_PROCESSING_FAILED", "Não foi possível processar a notificação.");
  }
}
