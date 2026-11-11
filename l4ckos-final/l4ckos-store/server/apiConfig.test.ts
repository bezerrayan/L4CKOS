import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiConfigError, apiEndpoint, resolveApiUrl, validateBuildApiConfig } from "../shared/apiConfig";

const ISOLATED_API = "https://stock-v1-api.up.railway.app";
const ISOLATED_API_ALLOWLIST = ISOLATED_API;

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe("frontend API destination isolation", () => {
  it("fails closed when a production or release build omits its API URL", () => {
    expect(() => resolveApiUrl({ target: "production" })).toThrowError(
      expect.objectContaining({ code: "API_URL_REQUIRED" }),
    );
    expect(() => validateBuildApiConfig({ target: "production" })).toThrowError(
      expect.objectContaining({ code: "API_URL_REQUIRED" }),
    );
  });

  it("rejects malformed and insecure remote URLs with a stable error code", () => {
    for (const apiUrl of ["not a URL", "http://api.example.test", "https://user:pass@example.test", "https://api.example.test/path?q=1"]) {
      try {
        resolveApiUrl({ apiUrl, target: "production" });
        throw new Error("expected API configuration to fail");
      } catch (error) {
        expect(error).toBeInstanceOf(ApiConfigError);
        expect((error as ApiConfigError).code).toBe("API_URL_INVALID");
      }
    }
  });

  it("rejects a production API destination during a staging build", () => {
    expect(() => validateBuildApiConfig({
      target: "staging",
      apiUrl: "https://api.l4ckos.com.br",
      stagingApiAllowedOrigins: "https://api.l4ckos.com.br",
    })).toThrowError(expect.objectContaining({ code: "STAGING_API_PRODUCTION_FORBIDDEN" }));
  });

  it("accepts an explicitly allowlisted isolated HTTPS API origin for staging", () => {
    expect(() => validateBuildApiConfig({
      target: "staging",
      apiUrl: ISOLATED_API,
      stagingApiAllowedOrigins: ISOLATED_API_ALLOWLIST,
    })).not.toThrow();
    expect(resolveApiUrl({
      target: "staging",
      apiUrl: ISOLATED_API,
      stagingApiAllowedOrigins: ISOLATED_API_ALLOWLIST,
    }).origin).toBe(ISOLATED_API);
  });

  it("requires an explicit allowlist and rejects unauthorized, production, and legacy staging origins", () => {
    expect(() => validateBuildApiConfig({ target: "staging", apiUrl: ISOLATED_API }))
      .toThrowError(expect.objectContaining({ code: "STAGING_API_ALLOWLIST_REQUIRED" }));
    expect(() => validateBuildApiConfig({
      target: "staging", apiUrl: ISOLATED_API, stagingApiAllowedOrigins: "https://other-api.up.railway.app",
    })).toThrowError(expect.objectContaining({ code: "STAGING_API_ORIGIN_UNAUTHORIZED" }));
    expect(() => validateBuildApiConfig({
      target: "staging", apiUrl: "https://api-staging.l4ckos.com.br", stagingApiAllowedOrigins: "https://api-staging.l4ckos.com.br",
    })).toThrowError(expect.objectContaining({ code: "STAGING_API_LEGACY_FORBIDDEN" }));
    expect(() => validateBuildApiConfig({
      target: "staging", apiUrl: "https://api.l4ckos.com.br", stagingApiAllowedOrigins: "https://api.l4ckos.com.br",
    })).toThrowError(expect.objectContaining({ code: "STAGING_API_PRODUCTION_FORBIDDEN" }));
  });

  it("rejects malformed or non-HTTPS staging origins and allowlist entries", () => {
    for (const apiUrl of ["", "not-a-url", "http://api.up.railway.app", "https://user:pass@api.up.railway.app", "https://api.up.railway.app/path"]) {
      expect(() => validateBuildApiConfig({
        target: "staging", apiUrl, stagingApiAllowedOrigins: "https://api.up.railway.app",
      })).toThrow();
    }
    expect(() => validateBuildApiConfig({
      target: "staging", apiUrl: ISOLATED_API, stagingApiAllowedOrigins: "http://stock-v1-api.up.railway.app",
    })).toThrowError(expect.objectContaining({ code: "STAGING_API_ALLOWLIST_INVALID" }));
  });

  it("resolves configuration before invoking any network client", () => {
    const fetchMock = vi.fn();
    const makeRequest = (apiUrl: string | undefined) => {
      const destination = resolveApiUrl({ apiUrl, target: "staging", stagingApiAllowedOrigins: "https://api.l4ckos.com.br" });
      return fetchMock(new URL("/api/health", destination));
    };
    expect(() => makeRequest("https://api.l4ckos.com.br")).toThrowError(
      expect.objectContaining({ code: "STAGING_API_PRODUCTION_FORBIDDEN" }),
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each(["VITE_API_URL", "VITE_BACKEND_URL"])("rejects a remote %s in development before the client can send requests", async variable => {
    const network = vi.fn();
    vi.stubGlobal("fetch", network);
    vi.stubEnv("DEV", true);
    vi.stubEnv("VITE_DEPLOY_TARGET", "");
    vi.stubEnv("VITE_API_URL", variable === "VITE_API_URL" ? "https://api-staging.l4ckos.com.br" : "");
    vi.stubEnv("VITE_STAGING_API_ALLOWED_ORIGINS", "");
    vi.stubEnv("VITE_BACKEND_URL", variable === "VITE_BACKEND_URL" ? "https://api-staging.l4ckos.com.br" : "");

    await expect(import("../client/src/const")).rejects.toThrowError(
      expect.objectContaining({ code: "DEV_API_REMOTE_DISABLED" }),
    );
    expect(network).not.toHaveBeenCalled();
  });

  it("does not fall back to staging when the local backend is unavailable", async () => {
    const network = vi.fn().mockRejectedValue(new Error("ECONNREFUSED local test"));
    vi.stubGlobal("fetch", network);
    vi.stubEnv("DEV", true);
    vi.stubEnv("VITE_DEPLOY_TARGET", "");
    vi.stubEnv("VITE_API_URL", "");
    vi.stubEnv("VITE_BACKEND_URL", "");
    const client = await import("../client/src/const");
    const csrf = await import("../client/src/lib/csrf");

    await expect(csrf.csrfFetch(client.apiUrl("/api/trpc/products.list"), { method: "GET" }))
      .rejects.toThrow("ECONNREFUSED local test");

    expect(network).toHaveBeenCalledOnce();
    expect(new URL(network.mock.calls[0][0]).origin).toBe("http://localhost:3010");
  });

  it.each([undefined, "invalid URL", "https://api.l4ckos.com.br"])(
    "the real CSRF client cannot initialize or send requests with invalid staging config %s",
    async apiUrl => {
      const network = vi.fn();
      vi.stubGlobal("fetch", network);
      vi.stubEnv("DEV", false);
      vi.stubEnv("VITE_DEPLOY_TARGET", "staging");
      vi.stubEnv("VITE_API_URL", apiUrl ?? "");
      vi.stubEnv("VITE_STAGING_API_ALLOWED_ORIGINS", ISOLATED_API_ALLOWLIST);
      vi.stubEnv("VITE_BACKEND_URL", "");
      await expect(import("../client/src/lib/csrf")).rejects.toThrow();
      expect(network).not.toHaveBeenCalled();
    },
  );

  it("the real client resolves auth, admin and checkout paths to staging", async () => {
    vi.stubEnv("DEV", false);
    vi.stubEnv("VITE_DEPLOY_TARGET", "staging");
    vi.stubEnv("VITE_API_URL", ISOLATED_API);
    vi.stubEnv("VITE_STAGING_API_ALLOWED_ORIGINS", ISOLATED_API_ALLOWLIST);
    const network = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ csrfToken: "synthetic-csrf-token" }) });
    vi.stubGlobal("fetch", network);
    const client = await import("../client/src/const");
    const csrf = await import("../client/src/lib/csrf");
    for (const path of ["/api/trpc/auth.localLogin", "/api/trpc/admin.dashboard", "/api/trpc/orders.checkout"]) {
      await csrf.csrfFetch(client.apiUrl(path), { method: "POST" });
    }
    expect(network).toHaveBeenCalledTimes(4);
    for (const [url] of network.mock.calls) expect(new URL(url).origin).toBe(ISOLATED_API);
  });

  it("rejects a production artifact served on the staging frontend host", () => {
    expect(() => resolveApiUrl({
      apiUrl: "https://api.l4ckos.com.br", target: "production", currentOrigin: "https://staging.l4ckos.com.br",
    })).toThrowError(expect.objectContaining({ code: "STAGING_API_ORIGIN_MISMATCH" }));
  });

  it("requires an explicit release target and rejects cross-origin relative configuration or paths", () => {
    expect(() => validateBuildApiConfig({ apiUrl: "https://api.example.test" })).toThrowError(
      expect.objectContaining({ code: "API_TARGET_REQUIRED" }),
    );
    expect(() => validateBuildApiConfig({ target: "production", apiUrl: "//api.example.test" })).toThrowError(
      expect.objectContaining({ code: "API_URL_INVALID" }),
    );
    expect(() => apiEndpoint(new URL("https://api-staging.l4ckos.com.br"), "//api.example.test/api")).toThrowError(
      expect.objectContaining({ code: "API_PATH_INVALID" }),
    );
  });

  it("preserves explicit HTTPS production configuration and local development", () => {
    expect(() => validateBuildApiConfig({
      target: "production",
      apiUrl: "https://api.l4ckos.com.br",
    })).not.toThrow();
    expect(resolveApiUrl({ apiUrl: "https://api.l4ckos.com.br", target: "production" }).origin)
      .toBe("https://api.l4ckos.com.br");
    expect(resolveApiUrl({ isDevelopment: true }).origin).toBe("http://localhost:3010");
    expect(resolveApiUrl({ isDevelopment: true, apiUrl: "http://127.0.0.1:3010" }).origin).toBe("http://127.0.0.1:3010");
  });

  it("keeps development on loopback and rejects staging, production, legacy remote, and ambiguous targets", () => {
    for (const input of [
      { isDevelopment: true, target: "staging", apiUrl: "https://api-staging.l4ckos.com.br" },
      { isDevelopment: true, apiUrl: "https://api-staging.l4ckos.com.br" },
      { isDevelopment: true, apiUrl: "https://api.l4ckos.com.br" },
      { isDevelopment: true, legacyBackendUrl: "https://api-staging.l4ckos.com.br" },
    ]) {
      expect(() => resolveApiUrl(input)).toThrowError(
        expect.objectContaining({ code: input.target ? "DEV_API_TARGET_DISABLED" : "DEV_API_REMOTE_DISABLED" }),
      );
    }

    expect(resolveApiUrl({ isDevelopment: true, apiUrl: "/api", currentOrigin: "http://localhost:5173" }).origin)
      .toBe("http://localhost:5173");
    expect(() => resolveApiUrl({ isDevelopment: true, apiUrl: "/api", currentOrigin: "https://staging.l4ckos.com.br" }))
      .toThrowError(expect.objectContaining({ code: "DEV_API_REMOTE_DISABLED" }));
  });

  it("does not silently use legacy or same-origin defaults in a release build", () => {
    expect(() => validateBuildApiConfig({
      target: "staging",
      apiUrl: undefined,
    })).toThrowError(expect.objectContaining({ code: "API_URL_REQUIRED" }));
    expect(() => validateBuildApiConfig({
      target: "staging",
      apiUrl: "same-origin",
      stagingApiAllowedOrigins: ISOLATED_API_ALLOWLIST,
    })).toThrowError(expect.objectContaining({ code: "STAGING_API_ORIGIN_INVALID" }));
  });
});
