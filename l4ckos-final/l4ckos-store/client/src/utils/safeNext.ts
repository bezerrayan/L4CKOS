/**
 * Post-authentication return path (`?next=`).
 *
 * Only same-origin, in-app paths are accepted. Anything else (absolute or protocol-relative URLs, backslash tricks,
 * encoded slashes, control characters, the auth pages themselves) falls back to a safe default, so a crafted link can
 * never turn Login/Cadastro into an open redirect or a redirect loop.
 */
const MAX_LENGTH = 512;
const AUTH_PATHS = new Set(["/login", "/entrar", "/cadastro", "/esqueci-senha", "/redefinir-senha"]);
const ORIGIN = "http://l4ckos.invalid";

function isUnsafeText(value: string) {
  // eslint-disable-next-line no-control-regex
  return /[\\\u0000- \u007f]/.test(value);
}

export function sanitizeNextPath(raw: string | null | undefined, fallback = "/"): string {
  if (typeof raw !== "string") return fallback;
  if (raw.length === 0 || raw.length > MAX_LENGTH) return fallback;
  if (!raw.startsWith("/") || raw.startsWith("//") || isUnsafeText(raw)) return fallback;

  let decoded: string;
  try {
    decoded = decodeURIComponent(raw);
  } catch {
    return fallback;
  }
  // Encoded variants of the same tricks (%2F%2F, %5C, %0d%0a, ...) are rejected too.
  if (decoded.startsWith("//") || isUnsafeText(decoded)) return fallback;

  let url: URL;
  try {
    url = new URL(raw, ORIGIN);
  } catch {
    return fallback;
  }
  if (url.origin !== ORIGIN) return fallback;
  if (AUTH_PATHS.has(url.pathname.toLowerCase().replace(/\/+$/, ""))) return fallback;
  return raw;
}

/** `/login` or `/cadastro` link that returns to `next` (omitted when it is the default or unsafe). */
export function authPageUrl(page: "/login" | "/cadastro", next: string | null | undefined): string {
  const safe = sanitizeNextPath(next);
  return safe === "/" ? page : `${page}?next=${encodeURIComponent(safe)}`;
}
