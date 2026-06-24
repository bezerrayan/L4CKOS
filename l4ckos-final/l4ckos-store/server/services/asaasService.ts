import axios, { AxiosError } from "axios";
import { timingSafeEqual } from "node:crypto";

const DEFAULT_ASAAS_API_URL = "https://api.asaas.com/v3";
const DEFAULT_ASAAS_CHECKOUT_BASE_URL = "https://www.asaas.com";

type AsaasErrorResponse = {
  errors?: Array<{ description?: string }>;
  message?: string;
};

type AsaasCustomerResponse = {
  id: string;
};

type AsaasCheckoutResponse = {
  id: string;
};

type AsaasPaymentResponse = {
  id: string;
  externalReference?: string | null;
  status?: string | null;
  confirmedDate?: string | null;
  checkout?: {
    id?: string | null;
  } | null;
};

type AsaasPaymentsListResponse = {
  data?: AsaasPaymentResponse[];
};

function getAsaasConfig() {
  const apiKey = process.env.ASAAS_API_KEY?.trim();
  const apiUrl = (process.env.ASAAS_API_URL?.trim() || DEFAULT_ASAAS_API_URL).replace(/\/+$/, "");
  const checkoutBaseUrl = (process.env.ASAAS_CHECKOUT_BASE_URL?.trim() || DEFAULT_ASAAS_CHECKOUT_BASE_URL).replace(/\/+$/, "");

  if (!apiKey) {
    throw new Error("ASAAS_API_KEY not configured");
  }

  return { apiKey, apiUrl, checkoutBaseUrl };
}

function mapAsaasError(error: unknown): Error {
  if (!axios.isAxiosError(error)) {
    return error instanceof Error ? error : new Error("Asaas request failed");
  }

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
    const client = buildClient();
    const { data } = await client.post<AsaasCustomerResponse>("/customers", {
      name: input.name,
      cpfCnpj: input.cpfCnpj,
      email: input.email,
      mobilePhone: input.mobilePhone || undefined,
    });
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
  try {
    const client = buildClient();
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
    return process.env.NODE_ENV !== "production";
  }

  const received = String(headers["asaas-access-token"] || "").trim();
  if (!received) return false;

  const receivedBuffer = Buffer.from(received, "utf8");
  const configuredBuffer = Buffer.from(configuredToken, "utf8");
  return receivedBuffer.length === configuredBuffer.length && timingSafeEqual(receivedBuffer, configuredBuffer);
}
