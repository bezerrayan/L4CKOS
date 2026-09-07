import axios from "axios";

type ShippingOption = {
  id: string;
  label: string;
  description: string;
  price: number;
  minDays: number;
  maxDays: number;
};

export type ShippingQuoteAddress = {
  city?: string | null;
  state?: string | null;
};

type QuoteInput = {
  cep: string;
  itemCount: number;
  subtotal: number;
  address?: ShippingQuoteAddress;
};

export type QuoteShippingResult = {
  options: ShippingOption[];
  source: "melhor-envio" | "fallback-local" | "mixed";
  warning?: string;
  providerError?: string;
};

function extractProviderError(error: unknown): string {
  if (axios.isAxiosError(error)) {
    const status = error.response?.status;
    const statusText = error.response?.statusText;
    const responseData = error.response?.data;

    const responseSummary =
      typeof responseData === "string"
        ? responseData
        : responseData
          ? JSON.stringify(responseData)
          : error.message;

    return [status ? `HTTP ${status}` : null, statusText || null, responseSummary].filter(Boolean).join(" - ");
  }

  if (error instanceof Error) {
    return error.message;
  }

  return "Falha desconhecida ao consultar Melhor Envio";
}

const DEFAULT_MELHOR_ENVIO_API_URL = "https://www.melhorenvio.com.br/api/v2";

function sanitizeCep(value: string) {
  return value.replace(/\D/g, "").slice(0, 8);
}

export function isExplicitLocalDeliveryCep(cep: string) {
  const configuredPrefixes = String(process.env.LOCAL_DELIVERY_CEP_PREFIXES ?? "700,701,702,703,704,706,707,708,709")
    .split(",")
    .map(prefix => prefix.replace(/\D/g, ""))
    .filter(prefix => prefix.length >= 3 && prefix.length <= 8);
  return configuredPrefixes.some(prefix => cep.startsWith(prefix));
}

function normalizeLocation(value: string | null | undefined) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase();
}

export function isExplicitLocalDeliveryAddress(cep: string, address?: ShippingQuoteAddress) {
  if (!isExplicitLocalDeliveryCep(cep)) return false;
  if (!address) return false;
  return String(address.state ?? "").trim().toUpperCase() === "DF" && normalizeLocation(address.city) === "brasilia";
}

function buildLocalOption(): ShippingOption {
  return {
    id: "local-plano-piloto",
    label: "Entrega local - Plano Piloto",
    description: "Agendamento local no Plano Piloto (Brasilia - DF)",
    price: 0,
    minDays: 1,
    maxDays: 2,
  };
}

function getMelhorEnvioConfig() {
  const token = process.env.MELHOR_ENVIO_TOKEN?.trim();
  const apiUrl = (process.env.MELHOR_ENVIO_API_URL?.trim() || DEFAULT_MELHOR_ENVIO_API_URL).replace(/\/+$/, "");
  const fromPostalCode = (process.env.MELHOR_ENVIO_FROM_POSTAL_CODE?.trim() || "70000-000").replace(/\D/g, "");

  return {
    token,
    apiUrl,
    fromPostalCode,
  };
}

function parseMelhorEnvioQuotes(data: any): ShippingOption[] {
  if (!Array.isArray(data)) return [];

  return data
    .filter((item: any) => !item?.error)
    .map((item: any, index: number) => {
      const rawPrice = Number(item?.custom_price ?? item?.price ?? 0);
      const deliveryRange = String(item?.delivery_range || "");
      const minDays = Number(deliveryRange.split("-")[0]) || Number(item?.delivery_time) || 3;
      const maxDays = Number(deliveryRange.split("-")[1]) || Number(item?.delivery_time) || minDays;

      return {
        id: `melhor-envio-${item?.id ?? index}`,
        label: String(item?.name || "Transportadora"),
        description: String(item?.company?.name || "Entrega via transportadora"),
        price: Number.isFinite(rawPrice) ? rawPrice : 0,
        minDays,
        maxDays,
      } as ShippingOption;
    })
    .filter((item: ShippingOption) => Number.isFinite(item.price));
}

function extractMelhorEnvioItemErrors(data: any): string {
  if (!Array.isArray(data)) return "";

  const messages = data
    .filter((item: any) => item?.error)
    .map((item: any) => {
      const service = String(item?.name || item?.company?.name || "Servico")
        .replace(/^[\s\W_]+/g, "")
        .trim();
      const reason = String(item?.error || item?.message || "Erro não informado")
        .replace(/^[\s\W_]+/g, "")
        .trim();
      return `${service}: ${reason}`;
    })
    .filter((message: string) => message !== "Servico: Erro não informado");

  return messages.slice(0, 4).join(" | ");
}

export async function quoteShipping(input: QuoteInput): Promise<ShippingOption[]> {
  const cep = sanitizeCep(input.cep);
  if (cep.length !== 8) {
    throw new Error("CEP inválido");
  }

  const options: ShippingOption[] = [];

  if (isExplicitLocalDeliveryAddress(cep, input.address)) {
    options.push(buildLocalOption());
  }

  const cfg = getMelhorEnvioConfig();
  if (!cfg.token) {
    return options;
  }

  try {
    const response = await axios.post(
      `${cfg.apiUrl}/me/shipment/calculate`,
      {
        from: { postal_code: cfg.fromPostalCode },
        to: { postal_code: cep },
        package: {
          height: "6",
          width: "18",
          length: "26",
          weight: (0.3 * Math.max(1, input.itemCount)).toFixed(2),
        },
        options: {
          insurance_value: Number(input.subtotal.toFixed(2)),
          receipt: false,
          own_hand: false,
          collect: false,
        },
      },
      {
        headers: {
          Authorization: `Bearer ${cfg.token}`,
          Accept: "application/json",
          "Content-Type": "application/json",
          "User-Agent": "LojaEscoteira/1.0",
        },
        timeout: 12000,
      },
    );

    const parsed = parseMelhorEnvioQuotes(response.data);
    return [...options, ...parsed];
  } catch {
    return options;
  }
}

export async function quoteShippingDetailed(input: QuoteInput): Promise<QuoteShippingResult> {
  const cep = sanitizeCep(input.cep);
  if (cep.length !== 8) {
    throw new Error("CEP inválido");
  }

  const localOptions: ShippingOption[] = [];
  if (isExplicitLocalDeliveryAddress(cep, input.address)) {
    localOptions.push(buildLocalOption());
  }

  const cfg = getMelhorEnvioConfig();
  if (!cfg.token) {
    return {
      options: localOptions,
      source: "fallback-local",
      warning: localOptions.length > 0
        ? "Token do Melhor Envio ausente. Entrega local disponível para este CEP."
        : "Frete indisponível: não foi possível cotar uma entrega segura para este CEP.",
    };
  }

  try {
    const response = await axios.post(
      `${cfg.apiUrl}/me/shipment/calculate`,
      {
        from: { postal_code: cfg.fromPostalCode },
        to: { postal_code: cep },
        package: {
          height: "6",
          width: "18",
          length: "26",
          weight: (0.3 * Math.max(1, input.itemCount)).toFixed(2),
        },
        options: {
          insurance_value: Number(input.subtotal.toFixed(2)),
          receipt: false,
          own_hand: false,
          collect: false,
        },
      },
      {
        headers: {
          Authorization: `Bearer ${cfg.token}`,
          Accept: "application/json",
          "Content-Type": "application/json",
          "User-Agent": "LojaEscoteira/1.0",
        },
        timeout: 12000,
      },
    );

    const parsed = parseMelhorEnvioQuotes(response.data);
    if (parsed.length === 0) {
      const providerError = extractMelhorEnvioItemErrors(response.data);
      return {
        options: localOptions,
        source: "fallback-local",
        warning: localOptions.length > 0
          ? "Melhor Envio não retornou cotações. Entrega local disponível para este CEP."
          : "Frete indisponível: o provedor não retornou uma opção válida para este CEP.",
        providerError: providerError || "API respondeu sem opcoes validas de frete.",
      };
    }

    return {
      options: [...localOptions, ...parsed],
      source: localOptions.length > 0 ? "mixed" : "melhor-envio",
    };
  } catch (error) {
    const providerError = extractProviderError(error);
    return {
      options: localOptions,
      source: "fallback-local",
      warning: localOptions.length > 0
        ? "Cotação externa indisponível. Entrega local disponível para este CEP."
        : "Frete indisponível: a cotação externa falhou e não há entrega local para este CEP.",
      providerError,
    };
  }
}
