import type { Request, RequestHandler } from "express";

export const ASAAS_WEBHOOK_INBOUND_ENABLED_ENV =
  "ASAAS_WEBHOOK_INBOUND_ENABLED";
export const ASAAS_WEBHOOK_INBOUND_PATHS = [
  "/api/webhooks/asaas",
  "/webhook/asaas",
] as const;

type StartupEnvironment = Record<string, string | undefined>;

export function resolveAsaasWebhookInboundEnabled(
  env: StartupEnvironment
): boolean {
  const staging =
    String(env.APP_ENV ?? "")
      .trim()
      .toLowerCase() === "staging";
  const configured = env[ASAAS_WEBHOOK_INBOUND_ENABLED_ENV];
  if (configured === undefined) return !staging;

  const normalized = configured.trim().toLowerCase();
  if (normalized === "true") return true;
  if (normalized === "false") return false;

  throw new Error(
    `INVALID_ASAAS_WEBHOOK_INBOUND_FLAG:${ASAAS_WEBHOOK_INBOUND_ENABLED_ENV}`
  );
}

function normalizedPath(req: Request): string {
  const rawPath = req.path || req.originalUrl || req.url || "/";
  let path = rawPath.split("?", 1)[0] || "/";
  try {
    path = decodeURIComponent(path);
  } catch {
    // Malformed encoded paths will not match a registered webhook route.
  }
  return path.toLowerCase().replace(/\/+$/, "") || "/";
}

const webhookPaths = new Set<string>(ASAAS_WEBHOOK_INBOUND_PATHS);

export function createAsaasWebhookInboundGate(
  enabled: boolean
): RequestHandler {
  return (req, res, next) => {
    if (
      req.method.toUpperCase() !== "POST" ||
      enabled ||
      !webhookPaths.has(normalizedPath(req))
    ) {
      next();
      return;
    }

    res.setHeader("Cache-Control", "no-store");
    res.status(503).json({
      success: false,
      code: "ASAAS_WEBHOOK_INBOUND_DISABLED",
      message: "Webhook intake is temporarily unavailable.",
      status: 503,
    });
  };
}
