import express, { type Express } from "express";
import crypto from "node:crypto";
import fs from "fs";
import { type Server } from "http";
import { nanoid } from "nanoid";
import path from "path";
import { fileURLToPath } from "node:url";
import { createServer as createViteServer } from "vite";
import viteConfig from "../../vite.config";

if (typeof crypto.hash !== "function") {
  crypto.hash = ((algorithm: string, data: crypto.BinaryLike, outputEncoding: crypto.BinaryToTextEncoding = "hex") =>
    crypto.createHash(algorithm).update(data).digest(outputEncoding)) as typeof crypto.hash;
}

const CORE_DIR = path.dirname(fileURLToPath(import.meta.url));

const CLIENT_ROUTES = [
  /^\/$/,
  /^\/produtos\/?$/,
  /^\/categorias\/[^/]+\/?$/,
  /^\/produto\/[^/]+\/?$/,
  /^\/favoritos\/?$/,
  /^\/carrinho\/?$/,
  /^\/checkout\/?$/,
  /^\/login\/?$/,
  /^\/entrar\/?$/,
  /^\/cadastro\/?$/,
  /^\/esqueci-senha\/?$/,
  /^\/redefinir-senha\/?$/,
  /^\/perfil\/?$/,
  /^\/meus-pedidos\/?$/,
  /^\/meus-pedidos\/[^/]+\/?$/,
  /^\/acompanhar-pedido\/?$/,
  /^\/gestao\/?$/,
  /^\/admin\/?$/,
  /^\/sobre\/?$/,
  /^\/contato\/?$/,
  /^\/faqs\/?$/,
  /^\/trocas-e-devolucoes\/?$/,
  /^\/termos\/?$/,
  /^\/privacidade\/?$/,
];

export function isKnownClientRoute(originalUrl: string) {
  const pathname = (originalUrl || "/").split("?")[0] || "/";
  return CLIENT_ROUTES.some(route => route.test(pathname));
}

export async function setupVite(app: Express, server: Server) {
  const serverOptions = {
    middlewareMode: true,
    hmr: { server },
    allowedHosts: true as const,
  };

  const vite = await createViteServer({
    ...viteConfig,
    configFile: false,
    server: serverOptions,
    appType: "custom",
  });

  app.use(vite.middlewares);
  app.use("*", async (req, res, next) => {
    const url = req.originalUrl;

    if (req.path.startsWith("/api/") || req.path === "/api" || req.path.startsWith("/webhook/")) {
      res.status(404).type("application/json").json({
        error: "ROUTE_NOT_FOUND",
        message: "Route not found",
      });
      return;
    }

    if (!isKnownClientRoute(url)) {
      res.status(404);
    }

    try {
      const clientTemplate = path.resolve(
        CORE_DIR,
        "../..",
        "client",
        "index.html"
      );

      // always reload the index.html file from disk incase it changes
      let template = await fs.promises.readFile(clientTemplate, "utf-8");
      template = template.replace(
        `src="/src/main.tsx"`,
        `src="/src/main.tsx?v=${nanoid()}"`
      );
      const page = await vite.transformIndexHtml(url, template);
      res.set({ "Content-Type": "text/html" }).end(page);
    } catch (e) {
      vite.ssrFixStacktrace(e as Error);
      next(e);
    }
  });
}

export function serveStatic(app: Express) {
  const distPath =
    process.env.NODE_ENV === "development"
      ? path.resolve(CORE_DIR, "../..", "dist", "public")
      : path.resolve(CORE_DIR, "public");
  if (!fs.existsSync(distPath)) {
    console.error(
      `Could not find the build directory: ${distPath}, make sure to build the client first`
    );
  }

  const assetsPath = path.resolve(distPath, "assets");

  app.get("/assets/*", (req, res) => {
    const relativePath = req.path.replace(/^\/assets\//, "");
    const normalizedRelative = path.normalize(relativePath);

    if (!normalizedRelative || normalizedRelative.startsWith("..") || path.isAbsolute(normalizedRelative)) {
      res.status(400).end();
      return;
    }

    const filePath = path.resolve(assetsPath, normalizedRelative);
    const normalizedAssetsPath = assetsPath.replace(/\\/g, "/");
    const normalizedFilePath = filePath.replace(/\\/g, "/");

    if (!normalizedFilePath.startsWith(normalizedAssetsPath + "/") && normalizedFilePath !== normalizedAssetsPath) {
      res.status(400).end();
      return;
    }

    fs.access(filePath, fs.constants.R_OK, error => {
      if (error) {
        res.status(404).end();
        return;
      }

      res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
      res.sendFile(filePath);
    });
  });

  app.use(
    express.static(distPath, {
      setHeaders: (res, filePath) => {
        const normalizedPath = String(filePath).replace(/\\/g, "/");
        if (normalizedPath.endsWith("/index.html")) {
          res.setHeader("Cache-Control", "no-cache");
        }
      },
    })
  );

  const indexPath = path.resolve(distPath, "index.html");

  // fall through to index.html if the file doesn't exist
  app.use("*", (req, res) => {
    const requestPath = (req.originalUrl || req.url || "").split("?")[0] || "";
    const hasFileExtension = path.extname(requestPath) !== "";

    if (hasFileExtension) {
      res.status(404).end();
      return;
    }

    if (!isKnownClientRoute(requestPath)) {
      res.status(404);
    }

    res.setHeader("Cache-Control", "no-cache");
    res.sendFile(indexPath);
  });
}
