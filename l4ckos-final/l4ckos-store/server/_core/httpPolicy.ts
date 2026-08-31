import { getAppEnvironment } from "./runtime";

function configuredOrigins() {
  return String(process.env.CORS_ORIGINS || "")
    .split(",")
    .map(value => value.trim())
    .filter(Boolean)
    .map(value => {
      try {
        return new URL(value).origin;
      } catch {
        return null;
      }
    })
    .filter((value): value is string => Boolean(value));
}

export function isOriginAllowed(origin?: string) {
  if (!origin) return true;
  try {
    const parsed = new URL(origin);
    const environment = getAppEnvironment();
    if ((environment === "local" || environment === "test") && ["localhost", "127.0.0.1"].includes(parsed.hostname)) {
      return true;
    }
    return configuredOrigins().includes(parsed.origin);
  } catch {
    return false;
  }
}

export function readRateLimit(name: string, fallback: number) {
  const value = Number(process.env[name]);
  return Number.isInteger(value) && value > 0 && value <= 100_000 ? value : fallback;
}
