import { assertEnabledBillingTypes } from "../../shared/checkoutMethods";
import { stagingFinancialScope } from "../payments/stagingFinancialBuyer";
import { sandboxSilenceRequired, assertSilentCustomer, verifySandboxCustomer } from "./sandboxCustomerSafety";
import { normalizeBuyerDocument } from "../../shared/buyerDocument";
import axios, { AxiosError } from "axios";
import { timingSafeEqual } from "node:crypto";

import { getAsaasConfig } from "./asaasConfig";

type AsaasErrorResponse = {
  errors?: Array<{ description?: string }>;
  message?: string;
};

type AsaasCustomerResponse = {
  notificationDisabled?: boolean;
  id: string;
};

type AsaasCheckoutResponse = {
  id: string;
};

type AsaasPaymentResponse = {
  id: string;
  externalReference?: string | null;
  status?: string | null;
  deleted?: boolean;
  value?: number;
  billingType?: string;
  refunds?: unknown[] | null;
  chargeback?: unknown;
  chargebackStatus?: unknown;
  confirmedDate?: string | null;
  checkout?: {
    id?: string | null;
  } | null;
};

type AsaasPaymentsListResponse = {
  data?: AsaasPaymentResponse[];
};

function mapAsaasError(error: unknown): Error {
  if (!axios.isAxiosError(error)) {
    return error instanceof Error ? error : new Error("Asaas request failed");
  }

  if (sandboxSilenceRequired()) return new Error("ASAAS_SANDBOX_REQUEST_FAILED");
  const axiosError = error as AxiosError<AsaasErrorResponse>;
  const data = axiosError.response?.data;
  const message = data?.errors?.[0]?.description || data?.message || axiosError.message || "Asaas request failed";
  return new Error(message);
}

function buildClient() {
  const { apiKey, apiUrl } = getAsaasConfig();
  return axios.create({
    baseURL: apiUrl,
    timeout: 15000,
    maxRedirects: 0,
    headers: {
      "Content-Type": "application/json",
      access_token: apiKey,
    },
  });
}

export async function createAsaasCustomer(input: {
  name: string;
  cpfCnpj: string;
  email: string;
  mobilePhone?: string;
}) {
  try {
    const document = normalizeBuyerDocument(input.cpfCnpj);
    if (!document) throw Error("CHECKOUT_DOCUMENT_INVALID");
    const silent = sandboxSilenceRequired();
    const client = buildClient();
    const { data } = await client.post<AsaasCustomerResponse>("/customers", {
      name: input.name,
      cpfCnpj: document,
      ...(silent ? { notificationDisabled: true } : {}),
      email: input.email,
      mobilePhone: input.mobilePhone || undefined,
    });
    if (silent) assertSilentCustomer(data.id, data);
    await verifySandboxCustomer(data.id, async () => (await client.get<AsaasCustomerResponse>(`/customers/${encodeURIComponent(data.id)}`)).data);
    return data;
  } catch (error) {
    throw mapAsaasError(error);
  }
}

export async function createAsaasCheckout(input: {
  name: string;
  value: number;
  billingTypes: Array<"PIX" | "CREDIT_CARD" | "BOLETO">;
  customer: string;
  redirectUrl: string;
  externalReference?: string;
}) {
  assertEnabledBillingTypes(input.billingTypes);
  try {
    const client = buildClient();
    await verifySandboxCustomer(input.customer, async () => (await client.get<AsaasCustomerResponse>(`/customers/${encodeURIComponent(input.customer)}`)).data);
    if (stagingFinancialScope()) throw Error("STAGING_OFFICIAL_CHECKOUT_REQUIRED");
    const { data } = await client.post<AsaasCheckoutResponse>("/checkouts", {
      name: input.name,
      value: Number(input.value.toFixed(2)),
      billingTypes: input.billingTypes,
      customer: input.customer,
      redirectUrl: input.redirectUrl,
      externalReference: input.externalReference,
    });

    const { checkoutBaseUrl } = getAsaasConfig();
    return {
      id: data.id,
      checkoutUrl: `${checkoutBaseUrl}/checkoutSession/show?id=${encodeURIComponent(data.id)}`,
    };
  } catch (error) {
    throw mapAsaasError(error);
  }
}

export async function getAsaasPayment(paymentId: string) {
  try {
    const client = buildClient();
    const normalizedId = String(paymentId || "").trim();
    if (!normalizedId) {
      throw new Error("Invalid payment id");
    }
    const { data } = await client.get<AsaasPaymentResponse>(`/payments/${encodeURIComponent(normalizedId)}`);
    return data;
  } catch (error) {
    throw mapAsaasError(error);
  }
}

export async function listAsaasPaymentsByExternalReference(externalReference: string) {
  try {
    const client = buildClient();
    const normalizedReference = String(externalReference || "").trim();
    if (!normalizedReference) {
      throw new Error("Invalid external reference");
    }

    const { data } = await client.get<AsaasPaymentsListResponse>("/payments", {
      params: {
        externalReference: normalizedReference,
        limit: 20,
      },
    });

    return Array.isArray(data?.data) ? data.data : [];
  } catch (error) {
    throw mapAsaasError(error);
  }
}

export function validateAsaasWebhookSignature(headers: Record<string, unknown>) {
  const configuredToken = process.env.ASAAS_WEBHOOK_TOKEN?.trim();
  if (!configuredToken) {
    return false;
  }

  const raw = headers["asaas-access-token"];
  if (typeof raw !== "string") return false;
  const received = raw.trim();
  if (!received) return false;

  const receivedBuffer = Buffer.from(received, "utf8");
  const configuredBuffer = Buffer.from(configuredToken, "utf8");
  return receivedBuffer.length === configuredBuffer.length && timingSafeEqual(receivedBuffer, configuredBuffer);
}

export async function verifyAsaasCustomerNotifications(customerId: string) {
  await verifySandboxCustomer(customerId, async () => (await buildClient().get<AsaasCustomerResponse>(`/customers/${encodeURIComponent(customerId)}`)).data);
}
