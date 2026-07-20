const DEFAULT_ASAAS_API_URL = "https://api.asaas.com/v3";

export type CheckoutMethod = "PIX" | "BOLETO" | "CARD";

type AsaasRequestInit = {
  method?: "GET" | "POST";
  body?: Record<string, unknown>;
};

type AsaasCustomerResponse = {
  id: string;
};

type AsaasPaymentResponse = {
  id: string;
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

function getAsaasConfig() {
  const apiKey = process.env.ASAAS_API_KEY?.trim();
  const apiUrl = (process.env.ASAAS_API_URL?.trim() || DEFAULT_ASAAS_API_URL).replace(/\/+$/, "");

  if (!apiKey) {
    throw new Error("ASAAS_API_KEY not configured.");
  }

  return { apiKey, apiUrl };
}

function getAsaasBillingType(method: CheckoutMethod): "PIX" | "BOLETO" | "UNDEFINED" {
  if (method === "PIX") return "PIX";
  if (method === "BOLETO") return "BOLETO";
  // CARD flow: do not collect raw card data in this backend, customer pays by card in invoiceUrl
  return "UNDEFINED";
}

async function asaasRequest<T>(path: string, init: AsaasRequestInit = {}) {
  const { apiKey, apiUrl } = getAsaasConfig();
  const response = await fetch(`${apiUrl}${path}`, {
    method: init.method ?? "GET",
    headers: {
      "Content-Type": "application/json",
      access_token: apiKey,
    },
    body: init.body ? JSON.stringify(init.body) : undefined,
  });

  const data = (await response.json()) as {
    errors?: Array<{ description?: string }>;
    message?: string;
  };

  if (!response.ok) {
    const asaasMessage = data.errors?.[0]?.description || data.message || "Asaas API request failed";
    throw new Error(asaasMessage);
  }

  return data as T;
}

function getDefaultDueDate(): string {
  const dueDate = new Date();
  dueDate.setDate(dueDate.getDate() + 2);
  return dueDate.toISOString().slice(0, 10);
}

export async function createAsaasChargeForOrder(input: {
  orderId: number;
  method: CheckoutMethod;
  value: number;
  customer: {
    name: string;
    cpfCnpj: string;
    email?: string;
  };
  description: string;
  dueDate?: string;
}) {
  const customer = await asaasRequest<AsaasCustomerResponse>("/customers", {
    method: "POST",
    body: {
      name: input.customer.name,
      cpfCnpj: input.customer.cpfCnpj,
      email: input.customer.email || undefined,
    },
  });

  const payment = await asaasRequest<AsaasPaymentResponse>("/payments", {
    method: "POST",
    body: {
      customer: customer.id,
      billingType: getAsaasBillingType(input.method),
      value: Number(input.value.toFixed(2)),
      dueDate: input.dueDate || getDefaultDueDate(),
      description: input.description,
      externalReference: String(input.orderId),
    },
  });

  let pixQrCode = payment.pixQrCode ?? null;
  let pixCopyPaste = payment.pixCopyPaste ?? null;

  if (input.method === "PIX" && (!pixQrCode || !pixCopyPaste) && payment.id) {
    const pixData = await asaasRequest<AsaasPixQrCodeResponse>(`/payments/${payment.id}/pixQrCode`);
    pixQrCode = pixQrCode || pixData.encodedImage || null;
    pixCopyPaste = pixCopyPaste || pixData.payload || null;
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
}
