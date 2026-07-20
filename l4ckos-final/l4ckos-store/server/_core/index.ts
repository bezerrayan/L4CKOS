import "dotenv/config";
import express from "express";
import { createServer } from "http";
import net from "net";
import path from "node:path";
import { mkdir, writeFile } from "node:fs/promises";
import helmet from "helmet";
import cors from "cors";
import { createExpressMiddleware } from "@trpc/server/adapters/express";
import { registerOAuthRoutes } from "./oauth";
import { appRouter } from "../routers";
import { createContext } from "./context";
import { serveStatic, setupVite } from "./vite";
import { ENV, validateEnvOnStartup } from "./env";
import { securityLog } from "./security";
import { getAllowedMethodsForApiPath, methodNotAllowed, sendApiError, sendApiRouteNotFound } from "./httpApi";
import { createApiCorsOptions, getAllowedOrigins, isAllowedOrigin } from "./corsPolicy";
import { configureTrustProxy, createRateLimiter } from "./rateLimit";
import { CSRF_COOKIE_NAME, createCsrfToken, csrfMiddleware } from "./csrf";
import { getSessionCookieOptions } from "./cookies";
import uploadRouter from "../routers/upload";
import reviewUploadRouter from "../routers/reviewUpload";
import paymentRoutes from "../routes/paymentRoutes";
import webhookRoutes from "../routes/webhookRoutes";
import shippingRoutes from "../routes/shippingRoutes";
import waitlistRoutes from "../routes/waitlist.routes";
import contactRoutes from "../routes/contact.routes";
import emailRoutes from "../routes/email.routes";
import { getBackupPayload } from "../db";
import { asaasWebhookHandler } from "../controllers/paymentController";

function scheduleDailyBackup() {
  const dir = process.env.BACKUP_DIR || "backups";
  const intervalMs = 24 * 60 * 60 * 1000;

  const execute = async () => {
    try {
      const backup = await getBackupPayload();
      await mkdir(dir, { recursive: true });
      const fileName = `auto-backup-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
      const filePath = path.join(dir, fileName);
      await writeFile(filePath, JSON.stringify(backup, null, 2), "utf-8");
      console.log(`[Backup] Created ${fileName}`);
    } catch (error) {
      console.error("[Backup] Failed automatic backup", error);
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
  const envIssues = validateEnvOnStartup();
  envIssues.forEach(issue => securityLog("warn", "startup.env_issue", { issue }));

  const app = express();
  const server = createServer(app);
  const isProduction = process.env.NODE_ENV === "production";
  app.disable("x-powered-by");

  configureTrustProxy(app, isProduction);

  const allowedOrigins = getAllowedOrigins({
    isProduction,
    configuredOrigins: process.env.CORS_ORIGINS,
  });

  function isAllowed(origin?: string) {
    return isAllowedOrigin(origin, { isProduction, allowedOrigins });
  }
  const hasGoogleClientId = Boolean(process.env.GOOGLE_CLIENT_ID?.trim());
  const hasGoogleClientSecret = Boolean(process.env.GOOGLE_CLIENT_SECRET?.trim());
  const hasGoogleRedirectUri = Boolean(process.env.GOOGLE_REDIRECT_URI?.trim());
  console.log(
    `[OAuth Env] clientId=${hasGoogleClientId} clientSecret=${hasGoogleClientSecret} redirectUri=${hasGoogleRedirectUri}`
  );

  app.get("/health", (_req, res) => {
    res.status(200).json({
      ok: true,
      service: "backend",
      uptime: Math.round(process.uptime()),
      timestamp: new Date().toISOString(),
    });
  });

  app.use(
    helmet({
      referrerPolicy: { policy: "strict-origin-when-cross-origin" },
      frameguard: { action: "deny" },
      noSniff: true,
      crossOriginEmbedderPolicy: false,
      contentSecurityPolicy: false,
      hsts: isProduction
        ? {
            maxAge: 15552000,
            includeSubDomains: true,
            preload: true,
          }
        : false,
    }),
  );

  app.use(
    "/api",
    cors(createApiCorsOptions({
      isProduction,
      allowedOrigins,
      onDenied: origin => {
        securityLog("warn", "cors.origin_blocked", { origin: origin || "missing" });
      },
    })),
  );

  app.use("/api", (err: unknown, _req: express.Request, res: express.Response, next: express.NextFunction) => {
    if (err instanceof Error && err.message === "Origin not allowed by CORS") {
      sendApiError(res, 403, "CORS_ORIGIN_DENIED", "Origin not allowed by CORS");
      return;
    }
    next(err);
  });

  app.get("/api", (_req, res) => {
    res.status(200).json({ ok: true });
  });
  app.all("/api", methodNotAllowed(["GET"]));

  app.get("/api/csrf", (req, res) => {
    const token = createCsrfToken();
    res.cookie(CSRF_COOKIE_NAME, token, {
      ...getSessionCookieOptions(req),
      httpOnly: false,
      maxAge: ENV.sessionTtlMs,
    });
    res.setHeader("Cache-Control", "no-store, private");
    res.status(200).json({ csrfToken: token });
  });

  app.use(
    "/api",
    createRateLimiter({
      windowMs: 15 * 60 * 1000,
      max: isProduction ? 300 : 1200,
    }),
  );

  // Tighter limit for authentication endpoints to reduce brute force attempts.
  const authLimiter = createRateLimiter({
    windowMs: 15 * 60 * 1000,
    max: isProduction ? 20 : 80,
    skipSuccessfulRequests: true,
    message: { error: "Too many authentication attempts. Try again later." },
  });
  app.use("/api/oauth/login", authLimiter);
  app.use("/api/trpc/auth.localLogin", authLimiter);
  app.use("/api/trpc/auth.localSignup", authLimiter);
  app.use("/api/trpc/auth.requestPasswordReset", authLimiter);
  app.use("/api/trpc/auth.resetPassword", authLimiter);

  const publicWriteLimiter = createRateLimiter({
    windowMs: 10 * 60 * 1000,
    max: isProduction ? 20 : 80,
    message: { error: "Too many requests. Try again later." },
  });
  app.use("/api/contact", publicWriteLimiter);
  app.use("/api/waitlist", publicWriteLimiter);
  app.use(
    "/api/review-images",
    createRateLimiter({
      windowMs: 15 * 60 * 1000,
      max: isProduction ? 12 : 50,
      message: { error: "Muitos envios de imagem. Tente novamente mais tarde." },
    }),
  );

  // Additional protection for admin-only API routes.
  const adminApiLimiter = createRateLimiter({
    windowMs: 10 * 60 * 1000,
    max: isProduction ? 120 : 400,
    message: { error: "Too many admin requests. Try again later." },
  });
  app.use("/api/trpc/admin", adminApiLimiter);

  // Configure body parser with larger size limit for file uploads
  app.use(express.json({ limit: "50mb" }));
  app.use(express.urlencoded({ limit: "50mb", extended: true }));

  app.use((req, res, next) => {
    if (req.path.startsWith("/api/") || req.path.startsWith("/webhook/")) {
      res.setHeader("Cache-Control", "no-store, private");
    }
    res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=(), payment=()");
    if (isProduction) {
      res.setHeader(
        "Content-Security-Policy-Report-Only",
        [
          "default-src 'self'",
          "base-uri 'self'",
          "object-src 'none'",
          "frame-ancestors 'none'",
          "img-src 'self' data: blob: https:",
          "font-src 'self' https://fonts.gstatic.com",
          "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
          "script-src 'self' https://accounts.google.com",
          "connect-src 'self' https://l4ckos.com.br https://www.l4ckos.com.br https://api.l4ckos.com.br https://accounts.google.com",
          "form-action 'self'",
        ].join("; "),
      );
    }
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

    sendApiError(res, 415, "UNSUPPORTED_CONTENT_TYPE", "Unsupported content type");
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
    if (isAllowed(origin)) {
      next();
      return;
    }

    const referer = req.headers.referer;
    if (!origin && typeof referer === "string") {
      try {
        if (isAllowed(new URL(referer).origin)) {
          next();
          return;
        }
      } catch {
        // fall through to the shared rejection path
      }
    }

    securityLog("warn", "csrf.origin_check_failed", {
      requestIp: req.ip || "unknown",
      path: req.path,
      origin: origin || "missing",
    });
    sendApiError(res, 403, "CSRF_ORIGIN_DENIED", "CSRF origin check failed");
  });

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

  // Backward-compatible alias for legacy webhook URL.
  // Canonical webhook endpoint is /api/webhooks/asaas.
  app.post("/webhook/asaas", asaasWebhookHandler);
  // REST API (upload)
  app.use("/api/upload", uploadRouter);
  app.use("/api/review-images", reviewUploadRouter);
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

  app.use("/api", (req, res) => {
    const allowedMethods = getAllowedMethodsForApiPath(req.path === "/" ? "/api" : `/api${req.path}`);
    if (allowedMethods && !allowedMethods.includes(req.method)) {
      methodNotAllowed(allowedMethods)(req, res);
      return;
    }

    sendApiRouteNotFound(res);
  });

  app.use((err: unknown, req: express.Request, res: express.Response, next: express.NextFunction) => {
    if (!req.path.startsWith("/api/")) {
      next(err);
      return;
    }

    securityLog("error", "api.unhandled_error", {
      path: req.path,
      requestIp: req.ip || "unknown",
      reason: err instanceof Error ? err.message : "unknown",
    });
    sendApiError(res, 500, "INTERNAL_SERVER_ERROR", "Internal server error");
  });
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
  console.log(`Server running on http://${host}:${port}/`);

  scheduleDailyBackup();
}

startServer().catch(console.error);

