type SecuritySeverity = "info" | "warn" | "error";

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

export function securityLog(
  severity: SecuritySeverity,
  event: string,
  details: Record<string, unknown> = {},
) {
  const payload = {
    at: new Date().toISOString(),
    event,
    ...Object.fromEntries(
      Object.entries(details).map(([key, value]) => {
        if (key.toLowerCase().includes("ip")) return [key, maskIp(String(value ?? ""))];
        if (key.toLowerCase().includes("token")) return [key, typeof value === "boolean" ? value : "[redacted]"];
        if (key.toLowerCase().includes("secret")) return [key, "[redacted]"];
        if (key.toLowerCase().includes("password")) return [key, "[redacted]"];
        if (key.toLowerCase().includes("authorization")) return [key, "[redacted]"];
        if (key.toLowerCase().includes("cookie")) return [key, "[redacted]"];
        return [key, value];
      }),
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
