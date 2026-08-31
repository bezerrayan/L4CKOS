type SecuritySeverity = "info" | "warn" | "error";
import { getRuntimeMetadata } from "./runtime";

function maskIp(ip: string | undefined | null) {
  const value = String(ip ?? "").trim();
  if (!value) return "unknown";

  if (value.includes(":")) {
    return `${value.split(":").slice(0, 4).join(":")}:*`;
  }

  const parts = value.split(".");
  if (parts.length !== 4) return value;
  return `${parts[0]}.${parts[1]}.${parts[2]}.*`;
}

function redactValue(value: unknown): unknown {
  if (typeof value !== "string") return value;
  if (value.length <= 8) return value;
  return `${value.slice(0, 4)}...${value.slice(-4)}`;
}

function maskEmail(value: unknown) {
  const email = String(value ?? "").trim();
  const [local, domain] = email.split("@");
  if (!local || !domain) return "[redacted]";
  return `${local.slice(0, 1)}***@${domain}`;
}

function redactDetail(key: string, value: unknown): unknown {
  const normalized = key.toLowerCase();
  if (normalized.includes("ip")) return maskIp(String(value ?? ""));
  if (normalized.includes("secret") || normalized.includes("password") || normalized.includes("authorization") || normalized.includes("cookie") || normalized.includes("apikey") || normalized.includes("api_key")) return "[redacted]";
  if (normalized.includes("token")) return redactValue(value);
  if (normalized.includes("cpf") || normalized.includes("cnpj") || normalized.includes("card") || normalized.includes("payload")) return "[redacted]";
  if (normalized.includes("email")) return Array.isArray(value) ? value.map(maskEmail) : maskEmail(value);
  if (normalized.includes("phone")) return `***${String(value ?? "").replace(/\D/g, "").slice(-4)}`;
  return value;
}

export function securityLog(
  severity: SecuritySeverity,
  event: string,
  details: Record<string, unknown> = {},
) {
  const payload = {
    at: new Date().toISOString(),
    ...getRuntimeMetadata(),
    event,
    ...Object.fromEntries(
      Object.entries(details).map(([key, value]) => [key, redactDetail(key, value)]),
    ),
  };

  if (severity === "error") {
    console.error("[Security]", payload);
    return;
  }

  if (severity === "warn") {
    console.warn("[Security]", payload);
    return;
  }

  console.log("[Security]", payload);
}
