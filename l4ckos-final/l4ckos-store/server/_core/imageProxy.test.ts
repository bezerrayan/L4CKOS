import { describe, it, expect, vi } from "vitest";
import { EventEmitter } from "node:events";
import http from "node:http";
import https from "node:https";
import { downloadPublicImage, imageProxyAdapters, isPublicImageAddress, IMAGE_PROXY_MAX_BYTES, type ImageProxyAdapters } from "./imageProxy";

const publicAddress = { address: "93.184.216.34", family: 4 };
function response(status = 200, headers: Record<string, string> = { "content-type": "image/webp" }, chunks = [Buffer.from("fixture-image")]) {
  return { status, headers, body: (async function* () { yield* chunks; })(), close: vi.fn() };
}
function adapters(responses = [response()]): ImageProxyAdapters {
  return { resolve: vi.fn(async () => [publicAddress]), request: vi.fn(async () => responses.shift()!) };
}

describe("image proxy SSRF and resource boundaries (no network)", () => {
  it.each(["http", "https"])("loads a public %s image", async protocol => {
    const a = adapters();
    expect(await downloadPublicImage(`${protocol}://cdn.example/image.webp`, a)).toEqual({ contentType: "image/webp", buffer: Buffer.from("fixture-image") });
    expect(a.request).toHaveBeenCalledWith(new URL(`${protocol}://cdn.example/image.webp`), publicAddress, expect.any(AbortSignal));
  });
  it.each(["file:///etc/passwd", "ftp://cdn.example/x", "https://user:pass@cdn.example/x", "http://cdn.example:8080/x"])("rejects protocol/authority/port %s", async url => {
    const a = adapters(); await expect(downloadPublicImage(url, a)).rejects.toMatchObject({ status: 400 }); expect(a.request).not.toHaveBeenCalled();
  });
  const privateIPs = ["127.0.0.1", "0.0.0.0", "10.0.0.1", "172.16.0.1", "192.168.1.1", "169.254.169.254", "100.100.100.200", "168.63.129.16", "224.0.0.1", "255.255.255.255", "192.0.2.1", "198.18.0.1", "::1", "::", "::ffff:127.0.0.1", "::ffff:93.184.216.34", "fe80::1", "fc00::1", "ff02::1", "2001:db8::1", "2002:7f00:1::", "64:ff9b::7f00:1", "3fff::1", "2001::1"];
  it.each(privateIPs)("rejects literal %s before connection", async ip => {
    expect(isPublicImageAddress(ip)).toBe(false);
    const a = adapters(); await expect(downloadPublicImage(`http://${ip.includes(":") ? `[${ip}]` : ip}/x`, a)).rejects.toMatchObject({ status: 400 });
    expect(a.resolve).not.toHaveBeenCalled(); expect(a.request).not.toHaveBeenCalled();
  });
  it.each(["localhost", "internal.example"])("rejects %s resolving privately", async hostname => {
    const a = adapters(); a.resolve = vi.fn(async () => [{ address: "127.0.0.1", family: 4 }]);
    await expect(downloadPublicImage(`https://${hostname}/x`, a)).rejects.toMatchObject({ status: 400 }); expect(a.request).not.toHaveBeenCalled();
  });
  it.each(["10.0.0.1", "::1"])("rejects mixed A/AAAA containing %s", async ip => {
    const a = adapters(); a.resolve = vi.fn(async () => [publicAddress, { address: ip, family: ip.includes(":") ? 6 : 4 }]);
    await expect(downloadPublicImage("https://cdn.example/x", a)).rejects.toMatchObject({ status: 400 }); expect(a.request).not.toHaveBeenCalled();
  });
  it("accepts native public IPv6 and rejects empty/invalid resolver results", async () => {
    expect(isPublicImageAddress("2606:4700:4700::1111")).toBe(true);
    for (const values of [[], [{ address: "nonsense", family: 4 }], [{ address: "93.184.216.34", family: 6 }]]) {
      const a = adapters(); a.resolve = vi.fn(async () => values);
      await expect(downloadPublicImage("https://cdn.example/x", a)).rejects.toMatchObject({ status: 400 }); expect(a.request).not.toHaveBeenCalled();
    }
  });
  it("validates each public redirect and relative Location", async () => {
    const first = response(302, { location: "https://other.example/x" });
    const second = response(307, { location: "/final" });
    const a = adapters([first, second, response()]);
    await downloadPublicImage("https://cdn.example/x", a);
    expect(a.resolve).toHaveBeenCalledTimes(3); expect(a.request).toHaveBeenCalledTimes(3); expect(first.close).toHaveBeenCalled(); expect(second.close).toHaveBeenCalled();
  });
  it.each(["http://10.0.0.1/x", "http://[::1]/x", "file:///etc/passwd", "https://private.example/x"])("rejects redirect to %s before connecting", async location => {
    const a = adapters([response(302, { location })]);
    a.resolve = vi.fn(async hostname => hostname === "private.example" ? [{ address: "10.0.0.1", family: 4 }] : [publicAddress]);
    await expect(downloadPublicImage("https://cdn.example/x", a)).rejects.toMatchObject({ status: 400 }); expect(a.request).toHaveBeenCalledTimes(1);
  });
  it("rejects redirect loops and chains beyond three hops", async () => {
    const loop = adapters([response(302, { location: "/x" })]);
    await expect(downloadPublicImage("https://cdn.example/x", loop)).rejects.toMatchObject({ status: 400 }); expect(loop.request).toHaveBeenCalledTimes(1);
    const chain = adapters(Array.from({ length: 5 }, (_, i) => response(302, { location: `/${i}` })));
    await expect(downloadPublicImage("https://cdn.example/x", chain)).rejects.toMatchObject({ status: 400 }); expect(chain.request).toHaveBeenCalledTimes(4);
  });
  it("rejects non-image responses and header injection", async () => {
    for (const type of ["text/html", "image/unknown", "image/png\r\nx-injected: true"]) {
      await expect(downloadPublicImage("https://cdn.example/x", adapters([response(200, { "content-type": type })]))).rejects.toMatchObject({ status: 415 });
    }
  });
  it("bounds declared and streamed bodies, including missing Content-Length", async () => {
    const declared = response(200, { "content-type": "image/png", "content-length": String(IMAGE_PROXY_MAX_BYTES + 1) });
    await expect(downloadPublicImage("https://cdn.example/x", adapters([declared]))).rejects.toMatchObject({ status: 413 }); expect(declared.close).toHaveBeenCalled();
    const streamed = response(200, { "content-type": "image/png" }, [Buffer.alloc(IMAGE_PROXY_MAX_BYTES), Buffer.alloc(1)]);
    await expect(downloadPublicImage("https://cdn.example/x", adapters([streamed]))).rejects.toMatchObject({ status: 413 }); expect(streamed.close).toHaveBeenCalled();
  });
  it("times out DNS, network and body under one deadline", async () => {
    for (const stage of ["dns", "request", "body"]) {
      const a = adapters(); const never = () => new Promise<any>(() => {});
      if (stage === "dns") a.resolve = never;
      if (stage === "request") a.request = never;
      if (stage === "body") a.request = vi.fn(async () => ({ ...response(), body: (async function* () { await never(); yield Buffer.alloc(1); })() }));
      await expect(downloadPublicImage("https://cdn.example/x", a, 5)).rejects.toMatchObject({ status: 504 });
    }
  });
  it.each(["http", "https"])("pins production %s transport without a second DNS lookup", async protocol => {
    const client = protocol === "https" ? https : http;
    const spy = vi.spyOn(client, "get").mockImplementation(((url: URL, options: any, cb: any) => {
      expect(url.hostname).toBe("cdn.example"); expect(options.agent).toBe(false); expect(options.family).toBe(4);
      const callback = vi.fn(); options.lookup("cdn.example", {}, callback);
      expect(callback).toHaveBeenCalledWith(null, publicAddress.address, 4);
      const body = Object.assign(new EventEmitter(), { statusCode: 200, headers: { "content-type": "image/png" }, destroy: vi.fn(), async *[Symbol.asyncIterator]() { yield Buffer.from("pinned"); } });
      cb(body); return new EventEmitter();
    }) as any);
    try {
      const resolve = vi.fn().mockResolvedValueOnce([publicAddress]).mockResolvedValue([{ address: "127.0.0.1", family: 4 }]);
      await downloadPublicImage(`${protocol}://cdn.example/x`, { ...imageProxyAdapters, resolve });
      expect(resolve).toHaveBeenCalledTimes(1); expect(spy).toHaveBeenCalledTimes(1);
    } finally { spy.mockRestore(); }
  });
});
