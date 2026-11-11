const DEFAULT_MAX_CENTS = 2_147_483_647n;

/** Parses BRL-style or dot-decimal input into exact integer cents without floating point. */
export function parseCurrencyToCents(value: string, maxCents = DEFAULT_MAX_CENTS): number {
  const raw = value.trim().replace(/^R\$\s*/i, "").replace(/\s+/g, "");
  if (!raw || raw.startsWith("-") || !/^\d[\d.,]*$/.test(raw)) return Number.NaN;
  let whole: string;
  let fraction = "";
  if (raw.includes(",")) {
    if ((raw.match(/,/g) ?? []).length !== 1) return Number.NaN;
    const [integerPart, decimalPart = ""] = raw.split(",");
    if (decimalPart.length > 2 || !/^\d*$/.test(decimalPart)) return Number.NaN;
    if (integerPart.includes(".") && !/^\d{1,3}(?:\.\d{3})+$/.test(integerPart)) return Number.NaN;
    whole = integerPart.replace(/\./g, "");
    fraction = decimalPart;
  } else if (raw.includes(".")) {
    if (/^\d{1,3}(?:\.\d{3})+$/.test(raw)) whole = raw.replace(/\./g, "");
    else {
      if ((raw.match(/\./g) ?? []).length !== 1) return Number.NaN;
      const [integerPart, decimalPart = ""] = raw.split(".");
      if (decimalPart.length > 2 || !/^\d*$/.test(decimalPart)) return Number.NaN;
      whole = integerPart;
      fraction = decimalPart;
    }
  } else whole = raw;
  if (!/^\d+$/.test(whole)) return Number.NaN;
  try {
    const cents = BigInt(whole) * 100n + BigInt((fraction + "00").slice(0, 2));
    return cents <= maxCents ? Number(cents) : Number.NaN;
  } catch {
    return Number.NaN;
  }
}
