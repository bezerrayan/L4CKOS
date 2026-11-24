import {
  handleStagingPreviewBff,
  STAGING_BFF_BODY_LIMIT,
  type StagingBffRequest,
} from "../server/_core/stagingPreviewBff";

function tooLargeResponse(): Response {
  return new Response(JSON.stringify({ error: "REQUEST_BODY_TOO_LARGE" }), {
    status: 413,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store, private",
      "x-content-type-options": "nosniff",
    },
  });
}

export default {
  async fetch(request: Request): Promise<Response> {
    const contentLength = Number(request.headers.get("content-length") ?? 0);
    if (Number.isFinite(contentLength) && contentLength > STAGING_BFF_BODY_LIMIT) {
      return tooLargeResponse();
    }

    let body = new Uint8Array();
    try {
      if (request.method !== "GET" && request.method !== "HEAD") {
        const bytes = new Uint8Array(await request.arrayBuffer());
        if (bytes.byteLength > STAGING_BFF_BODY_LIMIT) return tooLargeResponse();
        body = bytes;
      }
    } catch {
      return tooLargeResponse();
    }

    const url = new URL(request.url);
    const headers: Record<string, string> = {};
    request.headers.forEach((value, key) => { headers[key] = value; });
    const input: StagingBffRequest = {
      method: request.method,
      url: `${url.pathname}${url.search}`,
      headers,
      body,
    };
    const result = await handleStagingPreviewBff(input, process.env);
    const responseHeaders = new Headers();
    for (const [name, value] of Object.entries(result.headers)) {
      if (Array.isArray(value)) value.forEach(item => responseHeaders.append(name, item));
      else responseHeaders.set(name, value);
    }
    return new Response(Buffer.from(result.body), { status: result.statusCode, headers: responseHeaders });
  },
};
