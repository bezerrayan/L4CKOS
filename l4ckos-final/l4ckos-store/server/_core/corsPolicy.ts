export const PRODUCTION_ALLOWED_ORIGINS = ["https://l4ckos.com.br", "https://www.l4ckos.com.br"];
export const DEVELOPMENT_ALLOWED_ORIGINS = [
  "http://localhost:3000",
  "http://localhost:3001",
  "http://localhost:3002",
  "http://localhost:3003",
  "http://localhost:5173",
];

export function getAllowedOrigins(input: { isProduction: boolean; configuredOrigins?: string }) {
  const allowedOrigins = (input.configuredOrigins || (input.isProduction ? PRODUCTION_ALLOWED_ORIGINS.join(",") : ""))
    .split(",")
    .map(item => item.trim())
    .filter(Boolean);

  if (!input.isProduction && allowedOrigins.length === 0) {
    allowedOrigins.push(...DEVELOPMENT_ALLOWED_ORIGINS);
  }

  return allowedOrigins;
}

export function isAllowedOrigin(origin: string | undefined, input: { isProduction: boolean; allowedOrigins: string[] }) {
  if (!origin) return true;

  try {
    const url = new URL(origin);

    if (!input.isProduction && (url.hostname === "localhost" || url.hostname === "127.0.0.1")) {
      return true;
    }

    return input.allowedOrigins.some(allowed => {
      const allowedUrl = new URL(allowed);
      return url.protocol === allowedUrl.protocol && url.host === allowedUrl.host;
    });
  } catch {
    return false;
  }
}
