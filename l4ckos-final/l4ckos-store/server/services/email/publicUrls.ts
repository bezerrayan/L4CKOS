function configuredPublicUrl(value: string, name: string): URL {
  let url: URL;
  try { url = new URL(value); } catch { throw new Error(`Invalid ${name}`); }
  const local = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if (url.username || url.password ||
      !(url.protocol === "https:" || (url.protocol === "http:" && local && process.env.NODE_ENV !== "production"))) {
    throw new Error(`Invalid ${name}: HTTPS required for public URLs`);
  }
  return url;
}

export function resolvePublicApiOrigin(): string {
  const value = process.env.PUBLIC_API_URL?.trim();
  if (!value) throw new Error("Missing env var: PUBLIC_API_URL");
  const url = configuredPublicUrl(value, "PUBLIC_API_URL");
  if (url.pathname !== "/" || url.search || url.hash) throw new Error("PUBLIC_API_URL must be an origin");
  return url.origin;
}

export function resolveAnnouncementUrl(explicit?: string): string {
  const value = explicit?.trim() || process.env.APP_URL?.trim() ||
    process.env.APP_BASE_URL?.trim() || process.env.FRONTEND_URL?.trim();
  if (!value) throw new Error("Announcement URL requires APP_URL, APP_BASE_URL, FRONTEND_URL or explicit launchUrl");
  return configuredPublicUrl(value, "announcement URL").toString();
}
