import type { IncomingMessage, ServerResponse } from "node:http";
import {
  handleStagingPreviewBff,
  STAGING_BFF_BODY_LIMIT,
  type StagingBffRequest,
} from "../server/_core/stagingPreviewBff.js";

type VercelIncomingMessage = IncomingMessage & {
  query?: Record<string, string | string[] | undefined>;
};

export function includeVercelRewriteQuery(requestUrl: string | undefined, query: VercelIncomingMessage["query"]): string | undefined {
  if (!requestUrl || !query) return requestUrl;

  let url: URL;
  try {
    url = new URL(requestUrl, "https://preview.invalid");
  } catch {
    return requestUrl;
  }
  if (url.pathname !== "/api/staging-bff") return requestUrl;

  for (const [key, value] of Object.entries(query)) {
    if (url.searchParams.has(key)) continue;
    if (typeof value === "string") url.searchParams.append(key, value);
    else if (Array.isArray(value)) value.forEach(item => url.searchParams.append(key, item));
  }

  return `${url.pathname}${url.search}`;
}

async function readRequestBody(request: IncomingMessage): Promise<Uint8Array> {
  const chunks: Uint8Array[] = [];
  let size = 0;
  for await (const chunk of request) {
    const bytes = typeof chunk === "string" ? Buffer.from(chunk) : chunk;
    size += bytes.byteLength;
    if (size > STAGING_BFF_BODY_LIMIT) throw new Error("REQUEST_BODY_TOO_LARGE");
    chunks.push(bytes);
  }
  return Buffer.concat(chunks, size);
}

export default async function stagingPreviewBff(request: VercelIncomingMessage, response: ServerResponse) {
  const contentLength = Number(request.headers["content-length"] ?? 0);
  if (Number.isFinite(contentLength) && contentLength > STAGING_BFF_BODY_LIMIT) {
    response.statusCode = 413;
    response.setHeader("content-type", "application/json; charset=utf-8");
    response.setHeader("cache-control", "no-store, private");
    response.end(JSON.stringify({ error: "REQUEST_BODY_TOO_LARGE" }));
    return;
  }

  let body: Uint8Array;
  try {
    body = await readRequestBody(request);
  } catch {
    response.statusCode = 413;
    response.setHeader("content-type", "application/json; charset=utf-8");
    response.setHeader("cache-control", "no-store, private");
    response.end(JSON.stringify({ error: "REQUEST_BODY_TOO_LARGE" }));
    return;
  }

  const input: StagingBffRequest = {
    method: request.method,
    url: includeVercelRewriteQuery(request.url, request.query),
    headers: request.headers,
    body,
  };
  const result = await handleStagingPreviewBff(input, process.env);
  if (process.env.VERCEL_ENV === "preview" && result.statusCode === 404 &&
      Buffer.from(result.body).toString("utf8").includes("PREVIEW_BFF_ROUTE_NOT_ALLOWED")) {
    const route = new URL(request.url ?? "/", "https://preview.invalid");
    const queryKeys = [...new Set([
      ...route.searchParams.keys(),
      ...Object.keys(request.query ?? {}),
    ])].filter(key => /^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(key)).sort();
    response.setHeader("x-preview-bff-route-shape", `${route.pathname};query-keys=${queryKeys.join(",")}`);
  }
  response.statusCode = result.statusCode;
  for (const [name, value] of Object.entries(result.headers)) response.setHeader(name, value);
  response.end(Buffer.from(result.body));
}
