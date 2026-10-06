import { lookup } from "node:dns/promises";
import http from "node:http";
import https from "node:https";
import { BlockList, isIP } from "node:net";
import type { RequestHandler } from "express";

const blockedV4 = new BlockList();
for (const [address, prefix] of [
  ["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10], ["127.0.0.0", 8],
  ["169.254.0.0", 16], ["172.16.0.0", 12], ["192.0.0.0", 24],
  ["192.0.2.0", 24], ["192.88.99.0", 24], ["192.168.0.0", 16],
  ["198.18.0.0", 15], ["198.51.100.0", 24], ["203.0.113.0", 24], ["224.0.0.0", 3],
] as const) blockedV4.addSubnet(address, prefix, "ipv4");
blockedV4.addAddress("168.63.129.16", "ipv4"); // Azure platform virtual address
const globalV6 = new BlockList();
globalV6.addSubnet("2000::", 3, "ipv6");
const blockedV6 = new BlockList();
for (const [address, prefix] of [
  ["2001::", 23], ["2001:db8::", 32], ["2002::", 16], ["3fff::", 20],
] as const) blockedV6.addSubnet(address, prefix, "ipv6");

export function isPublicImageAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 4) return !blockedV4.check(address, "ipv4");
  // Fail closed outside native global unicast, including mapped IPv4, NAT64,
  // transition, local, multicast and reserved addresses.
  return family === 6 && globalV6.check(address, "ipv6") && !blockedV6.check(address, "ipv6");
}

export class ImageProxyError extends Error {
  constructor(public status: number, message: string) { super(message); }
}
type Address = { address: string; family: number };
type RemoteImageResponse = {
  status: number;
  headers: Record<string, string | string[] | undefined>;
  body: AsyncIterable<Uint8Array>;
  close: () => void;
};
export type ImageProxyAdapters = {
  resolve: (hostname: string) => Promise<Address[]>;
  request: (url: URL, address: Address, signal: AbortSignal) => Promise<RemoteImageResponse>;
};

export const imageProxyAdapters: ImageProxyAdapters = {
  resolve: hostname => lookup(hostname, { all: true, verbatim: true }),
  request: (url, address, signal) => new Promise((resolve, reject) => {
    const client = url.protocol === "https:" ? https : http;
    const req = client.get(url, {
      agent: false,
      signal,
      family: address.family,
      // Keep URL hostname for Host and TLS certificate/SNI validation. The
      // actual socket can only use the address from the validated DNS snapshot.
      lookup: (_hostname, _options, callback) => callback(null, address.address, address.family),
      headers: { Accept: "image/avif,image/webp,image/png,image/jpeg,image/gif,image/svg+xml" },
    }, response => resolve({
      status: response.statusCode ?? 502,
      headers: response.headers,
      body: response,
      close: () => response.destroy(),
    }));
    req.on("error", reject);
  }),
};

const imageTypes = new Set(["image/jpeg", "image/png", "image/webp", "image/gif", "image/avif", "image/svg+xml", "image/apng", "image/x-icon", "image/vnd.microsoft.icon"]);
const redirects = new Set([301, 302, 303, 307, 308]);
export const IMAGE_PROXY_MAX_BYTES = 10 * 1024 * 1024;
export const IMAGE_PROXY_TIMEOUT_MS = 8000;
export const IMAGE_PROXY_MAX_REDIRECTS = 3;

function parseImageUrl(value: string, base?: URL): URL {
  let url: URL;
  try { url = new URL(value, base); } catch { throw new ImageProxyError(400, "Invalid image URL"); }
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password ||
      (url.port && url.port !== "80" && url.port !== "443")) {
    throw new ImageProxyError(400, "Image origin not allowed");
  }
  url.hash = "";
  return url;
}

export async function downloadPublicImage(src: string, adapters = imageProxyAdapters, timeoutMs = IMAGE_PROXY_TIMEOUT_MS) {
  const controller = new AbortController();
  const timeoutError = new ImageProxyError(504, "Image request timed out");
  let activeResponse: RemoteImageResponse | undefined;
  let timer: ReturnType<typeof setTimeout>;
  const deadline = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => { controller.abort(); reject(timeoutError); }, timeoutMs);
  });
  const run = async () => {
    let url = parseImageUrl(src);
    const visited = new Set<string>();
    for (let hop = 0; ; hop++) {
      if (controller.signal.aborted) throw timeoutError;
      if (visited.has(url.href)) throw new ImageProxyError(400, "Image redirect loop");
      visited.add(url.href);
      const hostname = url.hostname.replace(/^\[|\]$/g, "");
      const literalFamily = isIP(hostname);
      const addresses = literalFamily ? [{ address: hostname, family: literalFamily }] : await adapters.resolve(hostname);
      if (controller.signal.aborted) throw timeoutError;
      if (!addresses.length || addresses.some(a => !isPublicImageAddress(a.address) || isIP(a.address) !== a.family)) {
        throw new ImageProxyError(400, "Image origin not public");
      }
      const response = await adapters.request(url, addresses[0], controller.signal);
      activeResponse = response;
      if (controller.signal.aborted) { response.close(); throw timeoutError; }
      try {
        if (redirects.has(response.status)) {
          const location = response.headers.location;
          if (hop >= IMAGE_PROXY_MAX_REDIRECTS || typeof location !== "string") {
            throw new ImageProxyError(400, "Image redirect limit or invalid location");
          }
          url = parseImageUrl(location, url);
          continue;
        }
        if (response.status < 200 || response.status >= 300) throw new ImageProxyError(404, "Image unavailable");
        const contentType = String(response.headers["content-type"] ?? "").split(";")[0].trim().toLowerCase();
        if (!imageTypes.has(contentType)) throw new ImageProxyError(415, "Invalid image type");
        if (Number(response.headers["content-length"]) > IMAGE_PROXY_MAX_BYTES) throw new ImageProxyError(413, "Image too large");
        const chunks: Buffer[] = [];
        let size = 0;
        for await (const chunk of response.body) {
          size += chunk.byteLength;
          if (size > IMAGE_PROXY_MAX_BYTES) throw new ImageProxyError(413, "Image too large");
          chunks.push(Buffer.from(chunk));
        }
        return { contentType, buffer: Buffer.concat(chunks, size) };
      } finally { response.close(); activeResponse = undefined; }
    }
  };
  try { return await Promise.race([run(), deadline]); }
  finally { clearTimeout(timer!); controller.abort(); activeResponse?.close(); }
}

export const imageProxyHandler: RequestHandler = async (req, res) => {
  try {
    if (typeof req.query.src !== "string" || !req.query.src.trim()) throw new ImageProxyError(400, "Missing image");
    const image = await downloadPublicImage(req.query.src.trim());
    res.set({
      "Content-Type": image.contentType,
      "Cache-Control": "public, max-age=86400",
      "Content-Disposition": "inline",
      "Cross-Origin-Resource-Policy": "cross-origin",
      "Access-Control-Allow-Origin": "*",
    }).status(200).send(image.buffer);
  } catch (error) {
    // Never log source URLs: they can contain signed storage credentials.
    res.status(error instanceof ImageProxyError ? error.status : 502).json({ error: "Falha ao carregar imagem" });
  }
};
