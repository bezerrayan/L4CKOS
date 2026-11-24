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
  if (!requestUrl) return requestUrl;
  const vercelQuery = query ?? {};

  let url: URL;
  try {
    url = new URL(requestUrl, "https://preview.invalid");
  } catch {
    return requestUrl;
  }
  if (url.pathname !== "/api/staging-bff") {
    const expectedMarker = url.pathname === "/api/csrf"
      ? "csrf"
      : url.pathname === "/api/shipping/quote"
        ? "shipping/quote"
        : url.pathname.match(/^\/api\/cep\/([0-9]{8})$/)?.[0]?.replace(/^\/api\//, "")
          ?? url.pathname.match(/^\/api\/trpc\/(.+)$/)?.[0]?.replace(/^\/api\//, "");
    const urlMarkers = url.searchParams.getAll("bffpath");
    const queryMarker = vercelQuery.bffpath;
    const queryMarkers = typeof queryMarker === "string" ? [queryMarker] : Array.isArray(queryMarker) ? queryMarker : [];
    const markers = urlMarkers.length ? urlMarkers : queryMarkers;
    if (!expectedMarker || markers.length !== 1 || markers[0] !== expectedMarker ||
        queryMarkers.length > 0 && (queryMarkers.length !== 1 || queryMarkers[0] !== expectedMarker)) return requestUrl;
    url.searchParams.delete("bffpath");
    return `${url.pathname}${url.search}`;
  }

  for (const [key, value] of Object.entries(vercelQuery)) {
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
  response.statusCode = result.statusCode;
  for (const [name, value] of Object.entries(result.headers)) response.setHeader(name, value);
  response.end(Buffer.from(result.body));
}
