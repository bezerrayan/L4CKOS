function readString(name: string, fallback = "") {
  return String(process.env[name] ?? fallback).trim();
}

function readBoolean(name: string, fallback = false) {
  const value = readString(name);
  if (!value) return fallback;
  return value.toLowerCase() === "true";
}

function readCsv(name: string, fallback = "") {
  return readString(name, fallback)
    .split(",")
    .map(item => item.trim().toLowerCase())
    .filter(Boolean);
}

function readSessionTtlMs() {
  const raw = readString("SESSION_TTL_HOURS");
  const parsed = Number(raw);
  const hours = Number.isFinite(parsed) && parsed >= 1 && parsed <= 24 * 30
    ? parsed
    : process.env.NODE_ENV === "production"
      ? 12
      : 24 * 7;

  return hours * 60 * 60 * 1000;
}

export const ENV = {
  appId: readString("VITE_APP_ID") || readString("APP_ID") || "loja-escoteira",
  jwtIssuer: readString("JWT_ISSUER", "l4ckos"),
  jwtAudience: readString("JWT_AUDIENCE", "l4ckos-web"),
  cookieSecret: readString("JWT_SECRET"),
  databaseUrl: readString("DATABASE_URL"),
  frontendUrl: readString("FRONTEND_URL"),
  googleClientId: readString("GOOGLE_CLIENT_ID") || readString("VITE_GOOGLE_CLIENT_ID"),
  googleClientSecret: readString("GOOGLE_CLIENT_SECRET"),
  googleRedirectUri: readString("GOOGLE_REDIRECT_URI"),
  ownerOpenId: readString("OWNER_OPEN_ID"),
  adminEmails: readCsv("ADMIN_EMAILS", "admin@local.dev"),
  localAuthAllowedEmails: readCsv("LOCAL_AUTH_ALLOWED_EMAILS"),
  isProduction: process.env.NODE_ENV === "production",
  allowLocalAuthInProduction: readBoolean("ALLOW_LOCAL_AUTH_IN_PRODUCTION", false),
  allowPublicLocalSignupInProduction: readBoolean("ALLOW_PUBLIC_LOCAL_SIGNUP_IN_PRODUCTION", false),
  sessionTtlMs: readSessionTtlMs(),
  forgeApiUrl: readString("BUILT_IN_FORGE_API_URL"),
  forgeApiKey: readString("BUILT_IN_FORGE_API_KEY"),
  trustProxyMode: readString("TRUST_PROXY_MODE", "railway"),
};

export function isEmailAllowedForProductionLocalAuth(email: string) {
  const normalized = email.trim().toLowerCase();
  if (!normalized) return false;

  if (ENV.allowLocalAuthInProduction && ENV.allowPublicLocalSignupInProduction) {
    return true;
  }

  if (ENV.localAuthAllowedEmails.length > 0) {
    return ENV.localAuthAllowedEmails.includes(normalized);
  }

  return ENV.adminEmails.includes(normalized);
}

export function validateEnvOnStartup() {
  const issues: string[] = [];

  if (!ENV.cookieSecret) {
    issues.push("JWT_SECRET ausente.");
  } else if (ENV.cookieSecret.length < 32) {
    issues.push("JWT_SECRET precisa ter ao menos 32 caracteres.");
  }

  if (
    ENV.isProduction &&
    ENV.allowLocalAuthInProduction &&
    !ENV.allowPublicLocalSignupInProduction &&
    ENV.localAuthAllowedEmails.length === 0
  ) {
    issues.push("ALLOW_LOCAL_AUTH_IN_PRODUCTION=true exige LOCAL_AUTH_ALLOWED_EMAILS ou ADMIN_EMAILS restrito.");
  }

  return issues;
}
