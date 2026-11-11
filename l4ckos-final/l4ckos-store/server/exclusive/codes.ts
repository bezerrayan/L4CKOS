import { createHash, randomInt } from "node:crypto";

// Crockford base32 (no I, L, O, U): unambiguous when read aloud or typed from a phone.
const ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
const CODE_LENGTH = 20; // 20 symbols * 5 bits = 100 bits of entropy

/** Cryptographically secure, non-sequential individual access code, grouped as XXXXX-XXXXX-XXXXX-XXXXX. */
export function generateAccessCode(): string {
  let raw = "";
  for (let i = 0; i < CODE_LENGTH; i += 1) raw += ALPHABET[randomInt(ALPHABET.length)];
  return raw.match(/.{5}/g)!.join("-");
}

/** Case, separators and the usual look-alikes are tolerated on input; the stored form is canonical. */
export function normalizeAccessCode(input: string): string {
  return input
    .toUpperCase()
    .replace(/[\s-]/g, "")
    .replace(/O/g, "0")
    .replace(/[IL]/g, "1");
}

export function isWellFormedAccessCode(input: string): boolean {
  const normalized = normalizeAccessCode(input);
  return normalized.length === CODE_LENGTH && [...normalized].every(char => ALPHABET.includes(char));
}

/**
 * Only this hash is persisted. With 100 bits of entropy an unsalted SHA-256 is sufficient (not brute-forceable);
 * an optional server-side pepper hardens a database-only leak further.
 */
export function hashAccessCode(input: string, pepper: string = process.env.EXCLUSIVE_CODE_PEPPER ?? ""): string {
  return createHash("sha256").update(`${pepper}:${normalizeAccessCode(input)}`, "utf8").digest("hex");
}
