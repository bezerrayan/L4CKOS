import "dotenv/config";
import express from "express";
import { createServer } from "http";
import net from "net";
import path from "node:path";
import { mkdir, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import helmet from "helmet";
import cors from "cors";
import rateLimit from "express-rate-limit";
import { createExpressMiddleware } from "@trpc/server/adapters/express";
import { registerOAuthRoutes } from "./oauth";
import { appRouter } from "../routers";
import { createContext } from "./context";
import { serveStatic, setupVite } from "./vite";
import { validateEnvOnStartup } from "./env";
import { securityLog } from "./security";
import uploadRouter from "../routers/upload";
import paymentRoutes from "../routes/paymentRoutes";
import webhookRoutes from "../routes/webhookRoutes";
import shippingRoutes from "../routes/shippingRoutes";
import waitlistRoutes from "../routes/waitlist.routes";
import contactRoutes from "../routes/contact.routes";
import emailRoutes from "../routes/email.routes";
import { getBackupPayload } from "../db";
import { getDb } from "../db";
import { asaasWebhookHandler } from "../controllers/paymentController";
import { getOperationalJobStatus, operationalJobs, startOperationalJobScheduler } from "../jobs/operationalJobs";
import { assertEnvironmentIsolation, validateEnvironmentIsolation } from "./environmentSafety";
import { isOriginAllowed, readRateLimit } from "./httpPolicy";
import { canRunJobEndpoint, getOperationalConfig } from "./operationalConfig";
import { getRuntimeMetadata } from "./runtime";
import { csrfEndpoint, csrfMiddleware } from "./csrf";
import { sql } from "drizzle-orm";

function scheduleDailyBackup() {
  if (process.env.AUTOMATIC_BACKUPS_ENABLED !== "true" || getOperationalConfig().maintenanceMode) return;
  const dir = process.env.BACKUP_DIR || "backups";
  const intervalMs = 24 * 60 * 60 * 1000;

  const execute = async () => {
    try {
      const backup = await getBackupPayload();
      await mkdir(dir, { recursive: true });
      const fileName = `auto-backup-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
      const filePath = path.join(dir, fileName);
      await writeFile(filePath, JSON.stringify(backup, null, 2), "utf-8");
      securityLog("info", "backup.automatic_created", { fileName });
    } catch (error) {
      securityLog("error", "backup.automatic_failed", { errorType: error instanceof Error ? error.name : "unknown" });
    }
  };

  void execute();
  setInterval(() => {
    void execute();
  }, intervalMs);
}

function isPrivateHostname(hostname: string) {
  const value = hostname.trim().toLowerCase();
  if (!value) return true;
  if (value === "localhost" || value === "::1" || value.endsWith(".local")) return true;
  if (/^127\./.test(value) || /^10\./.test(value) || /^192\.168\./.test(value)) return true;

  const match172 = value.match(/^172\.(\d{1,3})\./);
  if (match172) {
    const secondOctet = Number(match172[1]);
    if (secondOctet >= 16 && secondOctet <= 31) return true;
  }

  return false;
}

type CepLookupResult = {
  erro?: boolean;
  logradouro?: string;
  bairro?: string;
  localidade?: string;
  uf?: string;
};

async function fetchJsonWithTimeout(url: string, timeoutMs = 5000) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        Accept: "application/json",
      },
    });

    if (!response.ok) {
      return null;
    }

    return await response.json();
  } finally {
    clearTimeout(timeout);
  }
}

async function lookupCep(cep: string): Promise<CepLookupResult | null> {
  const viaCepData = (await fetchJsonWithTimeout(`https://viacep.com.br/ws/${cep}/json/`)) as
    | { erro?: boolean; logradouro?: string; bairro?: string; localidade?: string; uf?: string }
    | null;

  if (viaCepData && !viaCepData.erro) {
    return viaCepData;
  }

  const brasilApiData = (await fetchJsonWithTimeout(`https://brasilapi.com.br/api/cep/v1/${cep}`)) as
    | { street?: string; neighborhood?: string; city?: string; state?: string }
    | null;

  if (!brasilApiData) {
    return viaCepData?.erro ? { erro: true } : null;
  }

  return {
    logradouro: brasilApiData.street || "",
    bairro: brasilApiData.neighborhood || "",
    localidade: brasilApiData.city || "",
    uf: brasilApiData.state || "",
  };
}

function isPortAvailable(port: number): Promise<boolean> {
  return new Promise(resolve => {
    const server = net.createServer();
    server.listen(port, () => {
      server.close(() => resolve(true));
    });
    server.on("error", () => resolve(false));
  });
}

async function findAvailablePort(startPort: number = 3000): Promise<number> {
  for (let port = startPort; port < startPort + 20; port++) {
    if (await isPortAvailable(port)) {
      return port;
    }
  }
  throw new Error(`No available port found starting from ${startPort}`);
}

async function listenWithRetry(
  server: ReturnType<typeof createServer>,
  host: string,
  preferredPort: number,
  isProduction: boolean,
): Promise<number> {
  if (isProduction) {
    return await new Promise((resolve, reject) => {
      server.once("error", reject);
      server.listen(preferredPort, host, () => {
        server.off("error", reject);
        resolve(preferredPort);
      });
    });
  }

  for (let port = preferredPort; port < preferredPort + 30; port++) {
    try {
      await new Promise<void>((resolve, reject) => {
        const onError = (error: NodeJS.ErrnoException) => {
          server.off("listening", onListening);
          reject(error);
        };
        const onListening = () => {
          server.off("error", onError);
          resolve();
        };

        server.once("error", onError);
        server.once("listening", onListening);
        server.listen(port, host);
      });

      return port;
    } catch (error) {
      const err = error as NodeJS.ErrnoException;
      if (err.code !== "EADDRINUSE") {
        throw err;
      }
    }
  }

  throw new Error(`No available port found starting from ${preferredPort}`);
}

async function startServer() {
  assertEnvironmentIsolation();
  const envIssues = validateEnvOnStartup();
  envIssues.forEach(issue => securityLog("warn", "startup.env_issue", { issue }));

  const app = express();
  const server = createServer(app);
  const isProduction = process.env.NODE_ENV === "production";
  app.disable("x-powered-by");

  app.use((req, res, next) => {
    const requestId = String(req.headers["x-request-id"] || randomUUID()).slice(0, 128);
    req.headers["x-request-id"] = requestId;
    res.setHeader("X-Request-Id", requestId);
    const startedAt = Date.now();
    res.on("finish", () => {
      if (!req.path.startsWith("/api/") || req.path === "/api/health") return;
      securityLog("info", "http.request_completed", {
        requestId,
        correlationId: String(req.headers["x-correlation-id"] || "").slice(0, 191) || undefined,
        method: req.method,
        path: req.path,
        statusCode: res.statusCode,
        durationMs: Date.now() - startedAt,
      });
    });
    next();
  });

  // Render/Reverse proxies set X-Forwarded-* headers.
  // express-rate-limit requires trust proxy enabled to resolve client IP safely.
  if (isProduction) {
    app.set("trust proxy", 1);
  }

  const hasGoogleClientId = Boolean(process.env.GOOGLE_CLIENT_ID?.trim());
  const hasGoogleClientSecret = Boolean(process.env.GOOGLE_CLIENT_SECRET?.trim());
  const hasGoogleRedirectUri = Boolean(process.env.GOOGLE_REDIRECT_URI?.trim());
  securityLog("info", "startup.oauth_configuration", { hasGoogleClientId, hasGoogleClientSecret, hasGoogleRedirectUri });

  app.get("/health", (_req, res) => {
    res.status(200).json({
      ok: true,
      service: "backend",
      ...getRuntimeMetadata(),
      uptime: Math.round(process.uptime()),
      timestamp: new Date().toISOString(),
    });
  });

  app.get("/version", (_req, res) => {
    res.status(200).json({ service: "backend", ...getRuntimeMetadata() });
  });

  app.get("/ready", async (_req, res) => {
    const jobStatus = getOperationalJobStatus();
    const components: Record<string, { status: string; check: string }> = {
      database: { status: "down", check: "live" },
      schema: { status: "down", check: "compatibility" },
      asaas: { status: process.env.ASAAS_API_KEY && process.env.ASAAS_API_URL ? "configured" : "unconfigured", check: "configuration" },
      resend: { status: process.env.RESEND_API_KEY ? "configured" : "unconfigured", check: "configuration" },
      jobs: {
        status: !jobStatus.enabled ? "disabled" : jobStatus.schedulerMode === "external" ? "external" : jobStatus.schedulerStarted ? "up" : "starting",
        check: "process",
      },
      environment: {
        status: validateEnvironmentIsolation().length === 0 ? "up" : "down",
        check: "isolation",
      },
      storage: {
        status: getOperationalConfig().storageMode,
        check: "configuration",
      },
    };

    try {
      const db = await getDb();
      if (db) {
        await db.execute(sql`SELECT 1`);
        components.database.status = "up";
        const schemaResult = await db.execute(sql`
          SELECT TABLE_NAME AS tableName, COLUMN_NAME AS columnName, IS_NULLABLE AS isNullable
          FROM information_schema.COLUMNS
          WHERE TABLE_SCHEMA = DATABASE() AND (
            (TABLE_NAME = 'orders' AND COLUMN_NAME IN ('checkoutAttemptId','fulfillmentStatus','correlationId')) OR
            (TABLE_NAME = 'payments' AND COLUMN_NAME IN ('externalReference','paidAmount','refundedAmount','netAmount')) OR
            (TABLE_NAME = 'notificationOutbox' AND COLUMN_NAME IN ('dedupeKey','leaseExpiresAt')) OR
            (TABLE_NAME = 'products' AND COLUMN_NAME IN ('imageThumbnailUrl','imageDetailUrl','imageBannerUrl')) OR
            (TABLE_NAME = 'productImages' AND COLUMN_NAME IN ('color','imageThumbnailUrl','imageDetailUrl','imageBannerUrl')) OR
            (TABLE_NAME = 'productReviews' AND COLUMN_NAME IN ('orderId','stockReservationId','sizePerception','imageUrl','imageStatus','moderationStatus','verifiedPurchase','moderatedBy','moderatedAt')) OR
            (TABLE_NAME = 'productReviewUploads' AND COLUMN_NAME IN ('token','userId','productId','imageUrl','expiresAt','claimedAt','createdAt')) OR
            (TABLE_NAME = 'promoBanners' AND COLUMN_NAME IN ('imageUrl','mobileImageUrl','imageAlt','linkUrl')) OR
            (TABLE_NAME = 'waitlist_emails' AND COLUMN_NAME = 'created_at')
          )
        `);
        const rows = schemaResult[0] as unknown as Array<{ tableName: string; columnName: string; isNullable: "YES" | "NO" }>;
        const found = new Set(rows.map(row => `${row.tableName}.${row.columnName}`));
        const required = [
          "orders.checkoutAttemptId", "orders.fulfillmentStatus", "orders.correlationId",
          "payments.externalReference", "payments.paidAmount", "payments.refundedAmount", "payments.netAmount",
          "notificationOutbox.dedupeKey", "notificationOutbox.leaseExpiresAt",
          "products.imageThumbnailUrl", "products.imageDetailUrl", "products.imageBannerUrl",
          "productImages.color", "productImages.imageThumbnailUrl", "productImages.imageDetailUrl", "productImages.imageBannerUrl",
          "productReviews.orderId", "productReviews.stockReservationId", "productReviews.sizePerception", "productReviews.imageUrl", "productReviews.imageStatus", "productReviews.moderationStatus", "productReviews.verifiedPurchase", "productReviews.moderatedBy", "productReviews.moderatedAt",
          "productReviewUploads.token", "productReviewUploads.userId", "productReviewUploads.productId", "productReviewUploads.imageUrl", "productReviewUploads.expiresAt", "productReviewUploads.claimedAt", "productReviewUploads.createdAt",
          "promoBanners.imageUrl", "promoBanners.mobileImageUrl", "promoBanners.imageAlt", "promoBanners.linkUrl",
          "waitlist_emails.created_at",
        ];
        const waitlistColumn = rows.find(row => row.tableName === "waitlist_emails" && row.columnName === "created_at");
        if (required.every(column => found.has(column)) && waitlistColumn?.isNullable === "NO") {
          components.schema.status = "up";
        }
      }
    } catch {
      components.database.status = "down";
    }

    const ready = components.database.status === "up" && components.schema.status === "up" && components.environment.status === "up";
    res.status(ready ? 200 : 503).json({
      ok: ready,
      service: "backend",
      ...getRuntimeMetadata(),
      components,
      timestamp: new Date().toISOString(),
    });
  });

  app.use(
    helmet({
      referrerPolicy: { policy: "strict-origin-when-cross-origin" },
      frameguard: { action: "deny" },
      noSniff: true,
      crossOriginEmbedderPolicy: false,
      contentSecurityPolicy: isProduction
        ? {
            useDefaults: true,
            directives: {
              defaultSrc: ["'self'"],
              imgSrc: ["'self'", "data:", "blob:", "https:"],
              styleSrc: ["'self'", "'unsafe-inline'", "https:"],
              scriptSrc: ["'self'", "'unsafe-inline'", "https://accounts.google.com"],
              connectSrc: ["'self'", "https:", "wss:"],
              frameAncestors: ["'none'"],
              objectSrc: ["'none'"],
              baseUri: ["'self'"],
            },
          }
        : false,
      hsts: isProduction
        ? {
            maxAge: 15552000,
            includeSubDomains: true,
            preload: true,
          }
        : false,
    }),
  );

  app.use("/api", (req, res, next) => {
    const origin = req.headers.origin;
    if (!origin || isOriginAllowed(origin)) {
      next();
      return;
    }
    securityLog("warn", "http.cors_blocked", { origin, requestId: req.headers["x-request-id"] });
    res.status(403).json({ error: "Origin not allowed by CORS" });
  });

  app.use(
    "/api",
    cors({
      origin: (origin: string | undefined, callback: (error: Error | null, allow?: boolean) => void) => {
        if (isOriginAllowed(origin)) return callback(null, true);
        return callback(null, false);
      },
      credentials: true,
    }),
  );

  app.use(
    "/api",
    rateLimit({
      windowMs: 15 * 60 * 1000,
      max: readRateLimit("RATE_LIMIT_MAX", isProduction ? 300 : 1200),
      standardHeaders: true,
      legacyHeaders: false,
    }),
  );

  // This stays behind the RC origin/CORS gate and global API limiter. Its
  // cookie is host-only and intentionally readable only by this API origin.
  app.get("/api/csrf", csrfEndpoint);

  // Tighter limit for authentication endpoints to reduce brute force attempts.
  const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: readRateLimit("AUTH_RATE_LIMIT_MAX", isProduction ? 20 : 80),
    standardHeaders: true,
    legacyHeaders: false,
    skipSuccessfulRequests: true,
    message: { error: "Too many authentication attempts. Try again later." },
  });
  app.use("/api/oauth/login", authLimiter);
  app.use("/api/trpc/auth.localLogin", authLimiter);
  app.use("/api/trpc/auth.localSignup", authLimiter);
  app.use("/api/trpc/auth.requestPasswordReset", authLimiter);
  app.use("/api/trpc/auth.resetPassword", authLimiter);

  const publicWriteLimiter = rateLimit({
    windowMs: 10 * 60 * 1000,
    max: readRateLimit("PUBLIC_WRITE_RATE_LIMIT_MAX", isProduction ? 20 : 80),
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: "Too many requests. Try again later." },
  });
  app.use("/api/contact", publicWriteLimiter);
  app.use("/api/waitlist", publicWriteLimiter);

  // Additional protection for admin-only API routes.
  const adminApiLimiter = rateLimit({
    windowMs: 10 * 60 * 1000,
    max: readRateLimit("ADMIN_RATE_LIMIT_MAX", isProduction ? 120 : 400),
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: "Too many admin requests. Try again later." },
  });
  app.use("/api/trpc/admin", adminApiLimiter);

  // Configure body parser with larger size limit for file uploads
  app.use(express.json({ limit: "50mb" }));
  app.use(express.urlencoded({ limit: "50mb", extended: true }));

  app.use((req, res, next) => {
    if (req.path.startsWith("/api/") || req.path.startsWith("/webhook/")) {
      res.setHeader("Cache-Control", "no-store");
    }
    res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=(), payment=()");
    next();
  });

  app.use((req, res, next) => {
    const isMutating = ["POST", "PUT", "PATCH", "DELETE"].includes(req.method);
    const isMultipart = String(req.headers["content-type"] || "").toLowerCase().startsWith("multipart/form-data");
    const isJson = String(req.headers["content-type"] || "").toLowerCase().startsWith("application/json");
    const isFormEncoded = String(req.headers["content-type"] || "").toLowerCase().startsWith("application/x-www-form-urlencoded");
    const isWebhookRoute = req.path === "/api/webhooks/asaas" || req.path === "/webhook/asaas";

    if (!isMutating || !req.path.startsWith("/api/") || isWebhookRoute) {
      next();
      return;
    }

    if (isMultipart || isJson || isFormEncoded) {
      next();
      return;
    }

    res.status(415).json({ error: "Unsupported content type" });
  });

  app.use((req, res, next) => {
    const isMutating = ["POST", "PUT", "PATCH", "DELETE"].includes(req.method);
    if (!isMutating) {
      next();
      return;
    }

    // Apply origin checks only for API routes that may use cookie auth.
    const isApiRoute = req.path.startsWith("/api/");
    if (!isApiRoute) {
      next();
      return;
    }

    // Webhooks are server-to-server and should not be blocked by browser-origin checks.
    const isWebhookRoute = req.path === "/api/webhooks/asaas" || req.path === "/webhook/asaas";
    if (isWebhookRoute) {
      next();
      return;
    }

    const origin = req.headers.origin;
    if (isOriginAllowed(origin)) {
      next();
      return;
    }

    res.status(403).json({ error: "CSRF origin check failed" });
  });
  // Origin validation precedes CSRF so a forbidden origin never reaches token
  // validation. The middleware itself exempts only the real Asaas webhook.
  app.use(csrfMiddleware);
  // OAuth callback under /api/oauth/callback
  registerOAuthRoutes(app);
  app.get("/api/cep/:cep", async (req, res) => {
    try {
      const cep = String(req.params.cep ?? "").replace(/\D/g, "").slice(0, 8);
      if (cep.length !== 8) {
        res.status(400).json({ error: "CEP invalido" });
        return;
      }

      const data = await lookupCep(cep);
      if (!data) {
        res.status(502).json({ error: "Falha ao consultar CEP" });
        return;
      }

      res.json(data);
    } catch (error) {
      console.error("[CEP] Failed request", error);
      res.status(500).json({ error: "Erro ao consultar CEP" });
    }
  });

  app.get("/api/image-proxy", async (req, res) => {
    try {
      const src = String(req.query.src ?? "").trim();
      if (!src) {
        res.status(400).json({ error: "Imagem não informada" });
        return;
      }

      const url = new URL(src);
      if (!/^https?:$/i.test(url.protocol) || isPrivateHostname(url.hostname)) {
        res.status(400).json({ error: "Origem da imagem não permitida" });
        return;
      }

      const response = await fetch(url.toString(), {
        method: "GET",
        redirect: "follow",
        headers: {
          Accept: "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8",
        },
      });

      if (!response.ok) {
        res.status(404).json({ error: "Não foi possível carregar a imagem" });
        return;
      }

      const contentType = response.headers.get("content-type") || "";
      if (!contentType.toLowerCase().startsWith("image/")) {
        res.status(415).json({ error: "Arquivo remoto não é uma imagem válida" });
        return;
      }

      const buffer = Buffer.from(await response.arrayBuffer());
      res.setHeader("Content-Type", contentType);
      res.setHeader("Cache-Control", "public, max-age=86400");
      res.setHeader("Content-Disposition", "inline");
      res.setHeader("Cross-Origin-Resource-Policy", "cross-origin");
      res.setHeader("Access-Control-Allow-Origin", "*");
      res.status(200).send(buffer);
    } catch (error) {
      console.error("[Image Proxy] Failed to fetch remote image", error);
      res.status(500).json({ error: "Falha ao carregar imagem" });
    }
  });

  app.all("/api/internal/jobs/:job", async (req, res) => {
    const configuredSecret = String(process.env.CRON_SECRET || "").trim();
    const authorization = String(req.headers.authorization || "");
    if (!configuredSecret || authorization !== `Bearer ${configuredSecret}`) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    if (!canRunJobEndpoint()) {
      res.status(503).json({ error: "Operational jobs are disabled or maintenance mode is active" });
      return;
    }
    const job = String(req.params.job || "") as keyof typeof operationalJobs;
    if (!Object.prototype.hasOwnProperty.call(operationalJobs, job)) {
      res.status(404).json({ error: "Unknown job" });
      return;
    }
    try {
      const result = await operationalJobs[job]();
      res.json({ ok: true, job, result });
    } catch {
      res.status(500).json({ ok: false, job });
    }
  });

  // Backward-compatible alias for legacy webhook URL.
  // Canonical webhook endpoint is /api/webhooks/asaas.
  app.post("/webhook/asaas", asaasWebhookHandler);
  // REST API (upload)
  app.use("/api/upload", uploadRouter);
  app.use(
    "/uploads",
    (req, res, next) => {
      res.setHeader("Cross-Origin-Resource-Policy", "same-site");
      res.setHeader("Content-Disposition", "inline");
      res.setHeader("X-Content-Type-Options", "nosniff");
      res.setHeader("Cache-Control", "public, max-age=3600, immutable");
      next();
    },
    express.static(path.resolve(process.cwd(), "uploads"))
  );
  app.use("/api/payments", paymentRoutes);
  app.use("/api/webhooks", webhookRoutes);
  app.use("/api/shipping", shippingRoutes);
  app.use("/api", waitlistRoutes);
  app.use("/api", contactRoutes);
  app.use("/api", emailRoutes);
  // tRPC API
  app.use(
    "/api/trpc",
    createExpressMiddleware({
      router: appRouter,
      createContext,
    })
  );
  // development mode uses Vite, production mode uses static files
  if (!isProduction) {
    await setupVite(app, server);
  } else {
    serveStatic(app);
  }

  const preferredPort = parseInt(process.env.PORT || "3000");
  const host = process.env.HOST || "0.0.0.0";
  const scannedPort = isProduction ? preferredPort : await findAvailablePort(preferredPort);
  if (!isProduction && scannedPort !== preferredPort) {
    console.log(`Port ${preferredPort} is busy, trying from ${scannedPort}`);
  }

  const port = await listenWithRetry(server, host, scannedPort, isProduction);
  if (!isProduction && port !== scannedPort) {
    console.log(`Port ${scannedPort} is busy, using port ${port} instead`);
  }
  securityLog("info", "startup.server_listening", { host, port, ...getRuntimeMetadata() });

  scheduleDailyBackup();
  startOperationalJobScheduler();
}

startServer().catch(error => {
  securityLog("error", "startup.failed", { errorType: error instanceof Error ? error.name : "unknown", reason: error instanceof Error ? error.message : "unknown" });
  process.exitCode = 1;
});

