import { assertCheckoutMethodEnabled } from "../../shared/checkoutMethods";
import { normalizeBuyerDocument } from "../../shared/buyerDocument";
import { sandboxSilenceRequired, assertSilentCustomer, verifySandboxCustomer } from "./sandboxCustomerSafety";
import { getAsaasConfig } from "./asaasConfig";
import { AsaasRequestFailure, type AsaasRequestCategory, type AsaasRequestPhase } from "./asaasRequestFailure";

export type CheckoutMethod = "PIX" | "BOLETO" | "CARD";

type AsaasRequestInit = {
  method?: "GET" | "POST";
  body?: Record<string, unknown>;
  signal?: AbortSignal;
};

type AsaasCustomerResponse = {
  id: string;
  notificationDisabled?: boolean;
};

type AsaasPaymentResponse = {
  id?: string;
  invoiceUrl?: string;
  pixQrCode?: string;
  pixCopyPaste?: string;
  bankSlipUrl?: string;
  identificationField?: string;
  nossoNumero?: string;
  billingType?: string;
};

type AsaasPixQrCodeResponse = {
  encodedImage?: string;
  payload?: string;
};

type AsaasErrorBody = {
  errors?: Array<{ code?: unknown; description?: unknown }>;
  message?: unknown;
};

function getAsaasBillingType(method: CheckoutMethod): "PIX" | "BOLETO" | "CREDIT_CARD" {
  if (method === "PIX") return "PIX";
  if (method === "BOLETO") return "BOLETO";
  // CARD flow: do not collect raw card data in this backend, customer pays by card in invoiceUrl
  return "CREDIT_CARD";
}

function safeLogAsaasFailure(failure: AsaasRequestFailure): void {
  console.warn("[AsaasStock] request_failed", {
    phase: failure.phase,
    category: failure.category,
    ...(failure.httpStatus ? { httpStatus: failure.httpStatus } : {}),
  });
}

function isDocumentedValidationRejection(value: unknown): boolean {
  if (!value || typeof value !== "object" || !Array.isArray((value as AsaasErrorBody).errors)) return false;
  const errors = (value as AsaasErrorBody).errors!;
  return errors.length > 0 && errors.every(error =>
    Boolean(error && typeof error === "object" &&
      typeof error.code === "string" && /^[A-Za-z0-9_-]{1,80}$/.test(error.code) &&
      typeof error.description === "string" && error.description.trim().length > 0 && error.description.length <= 1000));
}

async function asaasRequest<T>(path: string, init: AsaasRequestInit, phase: AsaasRequestPhase, stockMode: boolean): Promise<T> {
  let config: ReturnType<typeof getAsaasConfig>;
  try {
    config = getAsaasConfig();
  } catch (error) {
    if (stockMode) throw new AsaasRequestFailure(phase, "configuration", true);
    throw error;
  }

  let response: Response;
  try {
    response = await fetch(`${config.apiUrl}${path}`, {
      method: init.method ?? "GET",
      redirect: "error",
      headers: {
        "Content-Type": "application/json",
        access_token: config.apiKey,
      },
      body: init.body ? JSON.stringify(init.body) : undefined,
      signal: init.signal ?? AbortSignal.timeout(15000),
    });
  } catch (error) {
    if (stockMode) {
      const definitelyNotCreated = phase !== "payment_create" && phase !== "pix_qr_lookup";
      throw new AsaasRequestFailure(phase, "network", definitelyNotCreated);
    }
    throw error;
  }

  let data: unknown;
  try {
    data = await response.json();
  } catch (error) {
    if (stockMode) {
      const definitelyNotCreated = phase !== "payment_create" && phase !== "pix_qr_lookup";
      throw new AsaasRequestFailure(phase, "invalid_response", definitelyNotCreated, response.status);
    }
    throw error;
  }

  if (!response.ok) {
    if (stockMode) {
      // Asaas documents a structured HTTP 400 `errors` body as a validation rejection. Other
      // statuses, including other 4xx responses, do not prove that POST /payments had no effect.
      const definitePaymentRejection = phase === "payment_create" && response.status === 400 && isDocumentedValidationRejection(data);
      const definitelyNotCreated = phase !== "payment_create" && phase !== "pix_qr_lookup" || definitePaymentRejection;
      throw new AsaasRequestFailure(
        phase,
        definitePaymentRejection ? "provider_rejection" : "unknown",
        definitelyNotCreated,
        response.status,
      );
    }
    const body = data as AsaasErrorBody;
    const asaasMessage = (typeof body?.errors?.[0]?.description === "string" && body.errors[0].description) ||
      (typeof body?.message === "string" && body.message) || "Asaas API request failed";
    throw new Error(sandboxSilenceRequired() ? "ASAAS_SANDBOX_REQUEST_FAILED" : asaasMessage);
  }

  return data as T;
}

function getDefaultDueDate(): string {
  const dueDate = new Date();
  dueDate.setDate(dueDate.getDate() + 2);
  return dueDate.toISOString().slice(0, 10);
}

function isValidPaymentId(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9_-]{1,128}$/.test(value.trim());
}

async function createAsaasCharge(input: {
  orderId: number;
  method: CheckoutMethod;
  value: number;
  customer: { name: string; cpfCnpj: string; email?: string };
  description: string;
  dueDate?: string;
  externalReference?: string;
  signal?: AbortSignal;
}, options: { stockMode: boolean; bestEffortPixQrLookup: boolean }) {
  let phase: AsaasRequestPhase = "preflight";
  try {
    assertCheckoutMethodEnabled(input.method);
    const document = normalizeBuyerDocument(input.customer.cpfCnpj);
    if (!document) {
      if (options.stockMode) throw new AsaasRequestFailure("preflight", "invalid_request", true);
      throw Error("CHECKOUT_DOCUMENT_INVALID");
    }

    const silent = sandboxSilenceRequired();
    phase = "customer_create";
    const customer = await asaasRequest<AsaasCustomerResponse>("/customers", {
      method: "POST",
      signal: input.signal,
      body: {
        name: input.customer.name,
        cpfCnpj: document,
        ...(silent ? { notificationDisabled: true } : {}),
        email: input.customer.email || undefined,
      },
    }, phase, options.stockMode);

    phase = "customer_verify";
    if (silent) {
      assertSilentCustomer(customer.id, customer);
      if (options.stockMode) {
        const verified = await asaasRequest<AsaasCustomerResponse>(
          `/customers/${encodeURIComponent(customer.id)}`, {}, phase, options.stockMode,
        );
        assertSilentCustomer(customer.id, verified);
      } else {
        await verifySandboxCustomer(customer.id, () => asaasRequest<AsaasCustomerResponse>(
          `/customers/${encodeURIComponent(customer.id)}`, {}, phase, options.stockMode,
        ));
      }
    }

    phase = "payment_create";
    const payment = await asaasRequest<AsaasPaymentResponse>("/payments", {
      method: "POST",
      signal: input.signal,
      body: {
        customer: customer.id,
        billingType: getAsaasBillingType(input.method),
        value: Number(input.value.toFixed(2)),
        dueDate: input.dueDate || getDefaultDueDate(),
        description: input.description,
        externalReference: input.externalReference ?? String(input.orderId),
      },
    }, phase, options.stockMode);

    if (!isValidPaymentId(payment?.id)) {
      if (options.stockMode) throw new AsaasRequestFailure("payment_create", "invalid_response", false);
      throw new Error("ASAAS_PAYMENT_RESPONSE_INVALID");
    }

    let pixQrCode = payment.pixQrCode ?? null;
    let pixCopyPaste = payment.pixCopyPaste ?? null;

    if (input.method === "PIX" && (!pixQrCode || !pixCopyPaste)) {
      phase = "pix_qr_lookup";
      try {
        const pixData = await asaasRequest<AsaasPixQrCodeResponse>(`/payments/${payment.id}/pixQrCode`, { signal: input.signal }, phase, options.stockMode);
        pixQrCode = pixQrCode || pixData.encodedImage || null;
        pixCopyPaste = pixCopyPaste || pixData.payload || null;
      } catch (error) {
        if (!options.bestEffortPixQrLookup) throw error;
        if (error instanceof AsaasRequestFailure) safeLogAsaasFailure(error);
        else safeLogAsaasFailure(new AsaasRequestFailure("pix_qr_lookup", "unknown", false));
        // The successful payment ID remains the durable correlation even when QR retrieval is unavailable.
      }
    }

    return {
      method: input.method,
      customerId: customer.id,
      paymentId: payment.id,
      invoiceUrl: payment.invoiceUrl || null,
      pixQrCode,
      pixCopyPaste,
      bankSlipUrl: payment.bankSlipUrl || null,
      digitableLine: payment.identificationField || null,
      nossoNumero: payment.nossoNumero || null,
      billingType: payment.billingType || null,
    };
  } catch (error) {
    if (!options.stockMode) throw error;
    const failure = error instanceof AsaasRequestFailure
      ? error
      : new AsaasRequestFailure(phase, "unknown", phase !== "payment_create" && phase !== "pix_qr_lookup");
    safeLogAsaasFailure(failure);
    throw failure;
  }
}

/**
 * Read-only PIX QR/copy-paste lookup for an EXISTING charge (GET /payments/{id}/pixQrCode). It never creates or changes a
 * charge, so a failure is always safe to retry. Returns null when Asaas has no usable payload.
 */
export async function fetchAsaasPixQrCode(paymentId: string, signal?: AbortSignal): Promise<{ qrCodeBase64: string | null; copyPaste: string | null } | null> {
  if (!isValidPaymentId(paymentId)) return null;
  const data = await asaasRequest<AsaasPixQrCodeResponse>(`/payments/${encodeURIComponent(paymentId.trim())}/pixQrCode`, { signal }, "pix_qr_lookup", true);
  const image = typeof data?.encodedImage === "string" ? data.encodedImage.replace(/^data:image\/png;base64,/, "") : null;
  const payload = typeof data?.payload === "string" ? data.payload : null;
  return image || payload ? { qrCodeBase64: image || null, copyPaste: payload || null } : null;
}

/** Existing charge adapter. Its error contract is kept for non-STOCK callers. */
export function createAsaasChargeForOrder(input: {
  orderId: number;
  method: CheckoutMethod;
  value: number;
  customer: { name: string; cpfCnpj: string; email?: string };
  description: string;
  dueDate?: string;
  /** Overrides the legacy numeric order reference (STOCK passes its strong, non-reusable attempt reference). */
  externalReference?: string;
  signal?: AbortSignal;
}) {
  return createAsaasCharge(input, { stockMode: false, bestEffortPixQrLookup: false });
}

/** STOCK-only adapter classifies the financial boundary and keeps a returned payment ID if QR lookup fails. */
export function createAsaasStockChargeForOrder(input: {
  orderId: number;
  method: CheckoutMethod;
  value: number;
  customer: { name: string; cpfCnpj: string; email?: string };
  description: string;
  dueDate?: string;
  externalReference?: string;
  signal?: AbortSignal;
}) {
  return createAsaasCharge(input, { stockMode: true, bestEffortPixQrLookup: true });
}
