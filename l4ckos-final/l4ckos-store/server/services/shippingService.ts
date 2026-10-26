import axios from "axios";

export type ShippingProduct = {
  key: string;
  quantity: number;
  unitPriceCents: number;
};

export type ShippingOption = {
  id: string;
  label: string;
  description: string;
  price: number;
  minDays: number | null;
  maxDays: number | null;
  provider: "melhor-envio" | "local";
  serviceId?: string;
};

type QuoteInput = {
  cep: string;
  items?: ShippingProduct[];
  // Kept for local-delivery callers and legacy tests. Postal quotes require items.
  itemCount?: number;
  subtotal?: number;
};

export type QuoteShippingResult = {
  options: ShippingOption[];
  source: "melhor-envio" | "fallback-local" | "mixed" | "unavailable";
  warning?: string;
  providerError?: string;
};

type Packing = { width: number; height: number; length: number; weight: number };
const SANDBOX_API_URL = "https://sandbox.melhorenvio.com.br/api/v2";
const STAGING_RAILWAY_PROJECT_ID = "2bb90c8e-eb65-43ee-826b-f93750f0499c";

function sanitizeCep(value: string) {
  return value.replace(/\D/g, "").slice(0, 8);
}

function isPlanoPilotoArea(cep: string) {
  return /^7[0-3]\d{6}$/.test(cep);
}

function buildLocalOption(): ShippingOption {
  return {
    id: "local-plano-piloto",
    label: "Entrega local - Plano Piloto",
    description: "Agendamento local no Plano Piloto (Brasilia - DF)",
    price: 0,
    minDays: null,
    maxDays: null,
    provider: "local",
  };
}

function isStagingRuntime() {
  return process.env.RAILWAY_PROJECT_ID === STAGING_RAILWAY_PROJECT_ID
    || process.env.APP_ENV?.trim().toLowerCase() === "staging"
    || process.env.NODE_ENV !== "production";
}

function validPostalCode(value: string | undefined) {
  return Boolean(value && /^\d{8}$/.test(value.replace(/\D/g, "")));
}

function getPackingMap(): Record<string, Packing> | null {
  const raw = process.env.MELHOR_ENVIO_PRODUCT_PACKING_JSON?.trim();
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    if (!parsed || Array.isArray(parsed) || typeof parsed !== "object") return null;
    const result: Record<string, Packing> = {};
    for (const [key, rawValue] of Object.entries(parsed)) {
      const value = rawValue as Record<string, unknown>;
      const width = Number(value?.width);
      const height = Number(value?.height);
      const length = Number(value?.length);
      const weight = Number(value?.weight);
      if (!key.trim() || ![width, height, length, weight].every(Number.isFinite)
        || width <= 0 || height <= 0 || length <= 0 || weight <= 0
        || width > 300 || height > 300 || length > 300 || weight > 30) return null;
      result[key] = { width, height, length, weight };
    }
    return Object.keys(result).length ? result : null;
  } catch {
    return null;
  }
}

function getMelhorEnvioConfig() {
  const token = process.env.MELHOR_ENVIO_TOKEN?.trim();
  const configuredApiUrl = process.env.MELHOR_ENVIO_API_URL?.trim();
  const apiUrl = (configuredApiUrl || SANDBOX_API_URL).replace(/\/+$/, "");
  const fromPostalCode = process.env.MELHOR_ENVIO_FROM_POSTAL_CODE?.trim().replace(/\D/g, "") || "";
  const contactEmail = process.env.MELHOR_ENVIO_CONTACT_EMAIL?.trim() || "";
  const staging = isStagingRuntime();
  const apiUrlIsSandbox = apiUrl === SANDBOX_API_URL;
  const apiUrlIsProduction = apiUrl === "https://melhorenvio.com.br/api/v2";
  const endpointAllowed = staging ? apiUrlIsSandbox : apiUrlIsProduction;
  const packing = getPackingMap();
  const contactEmailValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contactEmail);
  return {
    token,
    apiUrl,
    fromPostalCode,
    contactEmail,
    packing,
    ready: Boolean(token && endpointAllowed && validPostalCode(fromPostalCode) && contactEmailValid && packing),
  };
}

function toProviderProducts(items: ShippingProduct[], packing: Record<string, Packing> | null) {
  if (!packing || !Array.isArray(items) || items.length === 0) return null;
  const total = items.reduce((sum, item) => sum + Number(item.quantity || 0), 0);
  if (!Number.isSafeInteger(total) || total < 1 || total > 99) return null;
  const products = [];
  for (const item of items) {
    if (!item.key || !Number.isInteger(item.quantity) || item.quantity < 1 || item.quantity > 99
      || !Number.isSafeInteger(item.unitPriceCents) || item.unitPriceCents <= 0) return null;
    const dimensions = packing[item.key];
    if (!dimensions) return null;
    products.push({
      id: item.key,
      ...dimensions,
      insurance_value: Number((item.unitPriceCents / 100).toFixed(2)),
      quantity: item.quantity,
    });
  }
  return products;
}

function providerErrorCode(error: unknown): string {
  if (axios.isAxiosError(error)) {
    const status = error.response?.status;
    return status ? `HTTP ${status}` : "Falha de conexão com o Melhor Envio";
  }
  return "Falha de configuração ou resposta do Melhor Envio";
}

export function parseMelhorEnvioQuotes(data: any): ShippingOption[] {
  if (!Array.isArray(data)) return [];
  return data.flatMap((item: any) => {
    if (item?.error || item?.id === null || item?.id === undefined || !item?.name || !item?.company?.name) return [];
    const rawPrice = item?.custom_price ?? item?.price;
    const price = typeof rawPrice === "string" || typeof rawPrice === "number" ? Number(rawPrice) : NaN;
    const range = item?.custom_delivery_range ?? item?.delivery_range;
    const days = (value: unknown) => value !== null && value !== undefined && String(value).trim() !== ""
      && Number.isSafeInteger(Number(value)) && Number(value) >= 0 ? Number(value) : null;
    const parts = typeof range === "string" ? range.split("-") : [];
    const min = days(typeof range === "object" && range ? range.min : parts[0]);
    const max = days(typeof range === "object" && range ? range.max : parts[1]);
    const time = days(item?.custom_delivery_time ?? item?.delivery_time);
    const validRange = min !== null && max !== null && max >= min;
    if (!Number.isFinite(price) || price < 0) return [];
    const serviceId = String(item.id);
    return [{
      id: `melhor-envio-${serviceId}`,
      serviceId,
      label: String(item.name).trim(),
      description: String(item.company.name).trim(),
      price,
      minDays: validRange ? min : time,
      maxDays: validRange ? max : time,
      provider: "melhor-envio" as const,
    }];
  });
}

function buildFallback(localOptions: ShippingOption[], providerError?: string): QuoteShippingResult {
  return {
    options: localOptions,
    source: localOptions.length ? "fallback-local" : "unavailable",
    warning: localOptions.length
      ? "Cotação postal indisponível. A entrega local exige agendamento."
      : "Não há cotação de envio disponível para este CEP. Tente novamente mais tarde.",
    ...(providerError ? { providerError } : {}),
  };
}

export async function quoteShippingDetailed(input: QuoteInput): Promise<QuoteShippingResult> {
  const cep = sanitizeCep(input.cep);
  if (cep.length !== 8) throw new Error("CEP inválido");
  const localOptions = isPlanoPilotoArea(cep) ? [buildLocalOption()] : [];
  const cfg = getMelhorEnvioConfig();
  if (!cfg.token) return buildFallback(localOptions);
  if (!cfg.ready) return buildFallback(localOptions, "Configuração postal incompleta ou fora do ambiente permitido.");

  const products = toProviderProducts(input.items ?? [], cfg.packing);
  if (!products) return buildFallback(localOptions, "Dados de peso, dimensões ou itens não configurados para cotação.");

  try {
    const response = await axios.post(
      `${cfg.apiUrl}/me/shipment/calculate`,
      {
        from: { postal_code: cfg.fromPostalCode },
        to: { postal_code: cep },
        products,
        options: { receipt: false, own_hand: false },
      },
      {
        headers: {
          Authorization: `Bearer ${cfg.token}`,
          Accept: "application/json",
          "Content-Type": "application/json",
          "User-Agent": `L4CKOS (${cfg.contactEmail})`,
        },
        timeout: 12000,
      },
    );
    const parsed = parseMelhorEnvioQuotes(response.data);
    if (!parsed.length) return buildFallback(localOptions, "A API não retornou serviços válidos para esta rota.");
    return { options: [...localOptions, ...parsed], source: localOptions.length ? "mixed" : "melhor-envio" };
  } catch (error) {
    return buildFallback(localOptions, providerErrorCode(error));
  }
}

export async function quoteShipping(input: QuoteInput): Promise<ShippingOption[]> {
  return (await quoteShippingDetailed(input)).options;
}
