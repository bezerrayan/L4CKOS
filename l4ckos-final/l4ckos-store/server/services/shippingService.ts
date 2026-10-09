import axios from "axios";

type ShippingOption = {
  id: string;
  label: string;
  description: string;
  price: number;
  minDays: number | null;
  maxDays: number | null;
};

type QuoteInput = {
  cep: string;
  itemCount: number;
  subtotal: number;
};

export type QuoteShippingResult = {
  options: ShippingOption[];
  source: "melhor-envio" | "fallback-local" | "mixed" | "unavailable";
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

function isPlanoPilotoArea(cep: string) {
  // Faixa principal de Brasilia/Plano Piloto e entorno imediato
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

export function parseMelhorEnvioQuotes(data: any): ShippingOption[] {
  if (!Array.isArray(data)) return [];

  return data
    .filter((item: any) => !item?.error)
    .map((item: any, index: number) => {
      const rawPrice = item?.custom_price ?? item?.price;
      const price = (typeof rawPrice !== "string" && typeof rawPrice !== "number") || String(rawPrice).trim() === "" ? NaN : Number(rawPrice);
      const range = item?.custom_delivery_range ?? item?.delivery_range;
      const days = (value: unknown) => (typeof value !== "string" && typeof value !== "number") || String(value).trim() === "" ? null : Number.isSafeInteger(Number(value)) && Number(value) >= 0 ? Number(value) : null;
      const time = days(item?.custom_delivery_time ?? item?.delivery_time);
      const parts = typeof range === "string" ? range.split("-") : [];
      const min = days(typeof range === "object" && range ? range.min : parts[0]);
      const max = days(typeof range === "object" && range ? range.max : parts[1]);
      const minDays = min !== null && max !== null && max >= min ? min : time;
      const maxDays = min !== null && max !== null && max >= min ? max : time;

      return {
        id: `melhor-envio-${item?.id ?? index}`,
        label: String(item?.name || "Transportadora"),
        description: String(item?.company?.name || "Entrega via transportadora"),
        price,
        minDays,
        maxDays,
      } as ShippingOption;
    })
    .filter((item: ShippingOption) => Number.isFinite(item.price) && item.price >= 0);
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

  if (isPlanoPilotoArea(cep)) {
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
          "User-Agent": "L4CKOS/1.0",
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
  if (isPlanoPilotoArea(cep)) {
    localOptions.push(buildLocalOption());
  }

  const cfg = getMelhorEnvioConfig();
  if (!cfg.token) {
    const fallback = localOptions;
    return {
      options: fallback,
      source: fallback.length ? "fallback-local" : "unavailable",
      warning: fallback.length ? "Cotação de transporte indisponível. Entrega local disponível apenas por agendamento." : "Cotação de frete indisponível para este CEP. Tente novamente ou consulte a loja antes de comprar.",
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
          "User-Agent": "L4CKOS/1.0",
        },
        timeout: 12000,
      },
    );

    const parsed = parseMelhorEnvioQuotes(response.data);
    if (parsed.length === 0) {
      const fallback = localOptions;
      const providerError = extractMelhorEnvioItemErrors(response.data);
      return {
        options: fallback,
        source: fallback.length ? "fallback-local" : "unavailable",
        warning: fallback.length ? "Sem cotação de transporte. Entrega local disponível apenas por agendamento." : "Não há cotação de frete disponível para este CEP. Consulte a loja antes de comprar.",
        providerError: providerError || "API respondeu sem opcoes validas de frete.",
      };
    }

    return {
      options: [...localOptions, ...parsed],
      source: localOptions.length > 0 ? "mixed" : "melhor-envio",
    };
  } catch (error) {
    const providerError = extractProviderError(error);
    const fallback = localOptions;
    return {
      options: fallback,
      source: fallback.length ? "fallback-local" : "unavailable",
      warning: fallback.length ? "Cotação de transporte indisponível. Entrega local disponível apenas por agendamento." : "Não foi possível consultar o frete. Tente novamente ou consulte a loja antes de comprar.",
      providerError,
    };
  }
}
