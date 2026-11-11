import { defineConfig } from "vitest/config";
import path from "path";

const templateRoot = path.resolve(import.meta.dirname);

export default defineConfig({
  root: templateRoot,
  esbuild: { jsx: "automatic" },
  resolve: {
    alias: {
      "@": path.resolve(templateRoot, "client", "src"),
      "@shared": path.resolve(templateRoot, "shared"),
      "@assets": path.resolve(templateRoot, "attached_assets"),
    },
  },
  esbuild: { jsx: "automatic" },
  test: {
    environment: "node",
    // Explicit TEST-ONLY database environment (see server/database/mysqlConnection.mjs): loopback + disposable database
    // names only. This configures vitest processes and nothing that ships; production/staging runtimes reject it.
    env: { APP_ENV: "local-test", L4CKOS_LOCAL_DB_EXCEPTION: "disposable-loopback" },
    include: ["server/**/*.test.ts", "server/**/*.spec.ts", "client/src/**/*.test.ts", "client/src/**/*.test.tsx"],
    // The offline financial-recovery packager is not part of this storefront
    // candidate; its implementation and supporting kernels are not in this base.
    exclude: ["server/database/restrictedFinancialRecoveryPackaging.test.ts"],
  },
});
