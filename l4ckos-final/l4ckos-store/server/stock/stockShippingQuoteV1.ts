import {
  createHash,
  createHmac,
  randomUUID,
  timingSafeEqual,
} from "node:crypto";
import type {
  StockShippingAcceptanceV1,
  StockShippingAddressV1,
  StockShippingMethodV1,
} from "../../shared/stockShippingV1";

const MAX_QUOTE_TTL_MS = 10 * 60 * 1000;
const SECRET_MIN_BYTES = 32;

export type StockShippingQuoteTermsV1 = {
  method: StockShippingMethodV1;
  optionId: string;
  carrier?: string | null;
  serviceId: string;
  serviceName: string;
  providerQuoteId?: string | null;
  shippingPriceCents: number;
  package: {
    heightCm: number;
    widthCm: number;
    lengthCm: number;
    weightGrams: number;
  };
};

type Claims = {
  v: 1;
  jti: string;
  iat: number;
  exp: number;
  method: StockShippingMethodV1;
  optionId: string;
  carrier: string | null;
  serviceId: string;
  serviceName: string;
  providerQuoteId: string | null;
  shippingPriceCents: number;
  destinationZipCode: string;
  addressHash: string;
  package: StockShippingAcceptanceV1["package"];
  itemCount: number;
  merchandiseSubtotalCents: number;
  cartFingerprint: string;
};

export type IssueStockShippingQuoteV1Input = {
  secret: string;
  terms: StockShippingQuoteTermsV1;
  address: StockShippingAddressV1;
  /** Must be computed from server-loaded active variants and quantities. */
  cartFingerprint: string;
  itemCount: number;
  merchandiseSubtotalCents: number;
  /** Required positive attestation from address-level operations coverage lookup. */
  localAddressVerified?: boolean;
  now?: Date;
  ttlMs?: number;
};

export type VerifyStockShippingQuoteV1Input = {
  secret: string;
  quoteToken: string;
  optionId: string;
  address: StockShippingAddressV1;
  cartFingerprint: string;
  itemCount: number;
  merchandiseSubtotalCents: number;
  now?: Date;
};

export class StockShippingQuoteError extends Error {
  constructor(public readonly code: string) {
    super(code);
    this.name = "StockShippingQuoteError";
  }
}

function fail(code: string): never {
  throw new StockShippingQuoteError(code);
}

function signingKey(secret: string): Buffer {
  const key = Buffer.from(secret, "utf8");
  if (key.length < SECRET_MIN_BYTES) fail("SHIPPING_SIGNING_KEY_INVALID");
  return key;
}

function normalizeText(value: unknown): string {
  if (typeof value !== "string") fail("SHIPPING_ADDRESS_INVALID");
  const text = value.normalize("NFKC").trim().replace(/\s+/g, " ");
  if (!text || text.length > 255) fail("SHIPPING_ADDRESS_INVALID");
  return text;
}

function normalizeAddress(
  address: StockShippingAddressV1
): StockShippingAddressV1 {
  if (!address || typeof address !== "object") fail("SHIPPING_ADDRESS_INVALID");
  if (typeof address.zipCode !== "string") fail("SHIPPING_ADDRESS_INVALID");
  const zipCode = address.zipCode.replace(/\D/g, "");
  if (!/^\d{8}$/.test(zipCode)) fail("SHIPPING_ADDRESS_INVALID");
  if (
    address.complement !== undefined &&
    typeof address.complement !== "string"
  )
    fail("SHIPPING_ADDRESS_INVALID");
  const state = normalizeText(address.state).toUpperCase();
  if (state.length !== 2) fail("SHIPPING_ADDRESS_INVALID");
  return {
    recipient: normalizeText(address.recipient),
    zipCode,
    street: normalizeText(address.street),
    number: normalizeText(address.number),
    ...(address.complement?.trim()
      ? { complement: normalizeText(address.complement) }
      : {}),
    neighborhood: normalizeText(address.neighborhood),
    city: normalizeText(address.city),
    state,
  };
}

function addressHash(address: StockShippingAddressV1): string {
  return createHash("sha256").update(JSON.stringify(address)).digest("hex");
}

function isSafeLabel(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.trim().length > 0 &&
    value.trim().length <= 120
  );
}

function validateFacts(input: {
  cartFingerprint: string;
  itemCount: number;
  merchandiseSubtotalCents: number;
  package?: StockShippingAcceptanceV1["package"];
}) {
  if (!/^[a-f0-9]{64}$/.test(input.cartFingerprint))
    fail("SHIPPING_CART_FINGERPRINT_INVALID");
  if (
    !Number.isSafeInteger(input.itemCount) ||
    input.itemCount < 1 ||
    input.itemCount > 300
  )
    fail("SHIPPING_CART_INVALID");
  if (
    !Number.isSafeInteger(input.merchandiseSubtotalCents) ||
    input.merchandiseSubtotalCents < 0
  )
    fail("SHIPPING_CART_INVALID");
  if (input.package) {
    if (
      !Number.isSafeInteger(input.package.heightCm) ||
      input.package.heightCm <= 0 ||
      input.package.heightCm > 200 ||
      !Number.isSafeInteger(input.package.widthCm) ||
      input.package.widthCm <= 0 ||
      input.package.widthCm > 200 ||
      !Number.isSafeInteger(input.package.lengthCm) ||
      input.package.lengthCm <= 0 ||
      input.package.lengthCm > 300 ||
      !Number.isSafeInteger(input.package.weightGrams) ||
      input.package.weightGrams <= 0 ||
      input.package.weightGrams > 30_000
    )
      fail("SHIPPING_PACKAGE_INVALID");
  }
}

function sign(payload: string, key: Buffer): Buffer {
  return createHmac("sha256", key).update(payload).digest();
}

function encodeClaims(claims: Claims, key: Buffer): string {
  const payload = Buffer.from(JSON.stringify(claims)).toString("base64url");
  return `${payload}.${sign(payload, key).toString("base64url")}`;
}

/**
 * Creates a short-lived server-authenticated freight acceptance. No raw address
 * is embedded in the token. The quote API must call this only after fetching the
 * carrier quote (or an address-level local coverage approval) server-side.
 */
export function issueStockShippingQuoteV1(
  input: IssueStockShippingQuoteV1Input
): { quoteToken: string; quoteReference: string; expiresAt: string } {
  const key = signingKey(input.secret);
  const address = normalizeAddress(input.address);
  validateFacts(input);
  const { terms } = input;
  if (
    !isSafeLabel(terms.optionId) ||
    !isSafeLabel(terms.serviceId) ||
    !isSafeLabel(terms.serviceName)
  )
    fail("SHIPPING_OPTION_INVALID");
  if (
    !Number.isSafeInteger(terms.shippingPriceCents) ||
    terms.shippingPriceCents < 0 ||
    terms.shippingPriceCents > 2_147_483_647 ||
    (terms.method === "carrier" && terms.shippingPriceCents === 0)
  )
    fail("SHIPPING_PRICE_INVALID");
  if (
    terms.method === "carrier" &&
    (!isSafeLabel(terms.carrier) || !isSafeLabel(terms.providerQuoteId))
  )
    fail("SHIPPING_PROVIDER_REFERENCE_REQUIRED");
  if (terms.method === "local_scheduled" && input.localAddressVerified !== true)
    fail("LOCAL_ADDRESS_COVERAGE_UNVERIFIED");
  if (terms.method !== "carrier" && terms.method !== "local_scheduled")
    fail("SHIPPING_OPTION_INVALID");
  if (
    !terms.package ||
    !Number.isSafeInteger(terms.package.heightCm) ||
    !Number.isSafeInteger(terms.package.widthCm) ||
    !Number.isSafeInteger(terms.package.lengthCm) ||
    !Number.isSafeInteger(terms.package.weightGrams) ||
    terms.package.heightCm <= 0 ||
    terms.package.heightCm > 200 ||
    terms.package.widthCm <= 0 ||
    terms.package.widthCm > 200 ||
    terms.package.lengthCm <= 0 ||
    terms.package.lengthCm > 300 ||
    terms.package.weightGrams <= 0 ||
    terms.package.weightGrams > 30_000
  ) {
    fail("SHIPPING_PACKAGE_INVALID");
  }
  const now = input.now?.getTime() ?? Date.now();
  const ttlMs = input.ttlMs ?? MAX_QUOTE_TTL_MS;
  if (
    !Number.isSafeInteger(now) ||
    !Number.isSafeInteger(ttlMs) ||
    ttlMs < 1_000 ||
    ttlMs > MAX_QUOTE_TTL_MS
  )
    fail("SHIPPING_QUOTE_TTL_INVALID");
  const claims: Claims = {
    v: 1,
    jti: randomUUID(),
    iat: now,
    exp: now + ttlMs,
    method: terms.method,
    optionId: terms.optionId.trim(),
    carrier: terms.method === "carrier" ? terms.carrier!.trim() : null,
    serviceId: terms.serviceId.trim(),
    serviceName: terms.serviceName.trim(),
    providerQuoteId: terms.providerQuoteId?.trim() || null,
    shippingPriceCents: terms.shippingPriceCents,
    destinationZipCode: address.zipCode,
    addressHash: addressHash(address),
    package: terms.package,
    itemCount: input.itemCount,
    merchandiseSubtotalCents: input.merchandiseSubtotalCents,
    cartFingerprint: input.cartFingerprint,
  };
  return {
    quoteToken: encodeClaims(claims, key),
    quoteReference: claims.jti,
    expiresAt: new Date(claims.exp).toISOString(),
  };
}

/** Revalidates signature, expiry, exact address, cart, option and quoted cents before creating an order. */
export function verifyStockShippingQuoteV1(
  input: VerifyStockShippingQuoteV1Input
): StockShippingAcceptanceV1 {
  const key = signingKey(input.secret);
  validateFacts(input);
  if (typeof input.quoteToken !== "string" || input.quoteToken.length > 4_096)
    fail("SHIPPING_QUOTE_INVALID");
  const [encoded, signature, extra] = input.quoteToken.split(".");
  if (!encoded || !signature || extra !== undefined)
    fail("SHIPPING_QUOTE_INVALID");
  let providedSignature: Buffer;
  let claims: Claims;
  try {
    providedSignature = Buffer.from(signature, "base64url");
    if (
      providedSignature.length !== 32 ||
      providedSignature.toString("base64url") !== signature
    )
      fail("SHIPPING_QUOTE_INVALID");
    if (!timingSafeEqual(sign(encoded, key), providedSignature))
      fail("SHIPPING_QUOTE_INVALID");
    claims = JSON.parse(
      Buffer.from(encoded, "base64url").toString("utf8")
    ) as Claims;
  } catch (error) {
    if (error instanceof StockShippingQuoteError) throw error;
    return fail("SHIPPING_QUOTE_INVALID");
  }
  if (
    !claims ||
    claims.v !== 1 ||
    !Number.isSafeInteger(claims.iat) ||
    !Number.isSafeInteger(claims.exp) ||
    claims.exp <= claims.iat ||
    claims.exp - claims.iat > MAX_QUOTE_TTL_MS
  )
    fail("SHIPPING_QUOTE_INVALID");
  const now = input.now?.getTime() ?? Date.now();
  if (
    !Number.isSafeInteger(now) ||
    claims.iat > now + 30_000 ||
    claims.exp <= now
  )
    fail("SHIPPING_QUOTE_EXPIRED");
  const address = normalizeAddress(input.address);
  if (
    claims.addressHash !== addressHash(address) ||
    claims.destinationZipCode !== address.zipCode
  )
    fail("SHIPPING_QUOTE_ADDRESS_MISMATCH");
  if (claims.optionId !== input.optionId)
    fail("SHIPPING_QUOTE_OPTION_MISMATCH");
  if (
    claims.cartFingerprint !== input.cartFingerprint ||
    claims.itemCount !== input.itemCount ||
    claims.merchandiseSubtotalCents !== input.merchandiseSubtotalCents
  )
    fail("SHIPPING_QUOTE_CART_MISMATCH");
  if (
    !Number.isSafeInteger(claims.shippingPriceCents) ||
    claims.shippingPriceCents < 0 ||
    !claims.jti
  )
    fail("SHIPPING_QUOTE_INVALID");
  validateFacts({ ...input, package: claims.package });
  if (
    claims.method === "carrier" &&
    (!isSafeLabel(claims.carrier) || !isSafeLabel(claims.providerQuoteId))
  )
    fail("SHIPPING_QUOTE_INVALID");
  if (claims.method === "local_scheduled" && claims.carrier !== null)
    fail("SHIPPING_QUOTE_INVALID");
  if (claims.method !== "carrier" && claims.method !== "local_scheduled")
    fail("SHIPPING_QUOTE_INVALID");
  if (!isSafeLabel(claims.serviceId) || !isSafeLabel(claims.serviceName))
    fail("SHIPPING_QUOTE_INVALID");

  return {
    version: 1,
    method: claims.method,
    optionId: claims.optionId,
    carrier: claims.carrier,
    serviceId: claims.serviceId,
    serviceName: claims.serviceName,
    quoteReference: claims.jti,
    providerQuoteId: claims.providerQuoteId,
    currency: "BRL",
    shippingPriceCents: claims.shippingPriceCents,
    destinationZipCode: address.zipCode,
    address,
    package: claims.package,
    itemCount: claims.itemCount,
    merchandiseSubtotalCents: claims.merchandiseSubtotalCents,
  };
}
