import { type Express } from "express";
import crypto from "node:crypto";
import fs from "fs";
import { type Server } from "http";
import { nanoid } from "nanoid";
import path from "path";
import { fileURLToPath } from "node:url";
import { createServer as createViteServer } from "vite";
import viteConfig from "../../vite.config";
import { isKnownClientRoute } from "./static";

export { isKnownClientRoute } from "./static";

if (typeof crypto.hash !== "function") {
  crypto.hash = ((algorithm: string, data: crypto.BinaryLike, outputEncoding: crypto.BinaryToTextEncoding = "hex") =>
    crypto.createHash(algorithm).update(data).digest(outputEncoding)) as typeof crypto.hash;
}

const CORE_DIR = path.dirname(fileURLToPath(import.meta.url));

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
