import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { hasAllowedReviewImageSignature, normalizeReviewImage } from "./reviewUpload";

describe("review image validation", () => {
  it("accepts coherent JPEG, PNG and WebP signatures", async () => {
    const source = sharp({ create: { width: 40, height: 20, channels: 3, background: "red" } });
    const [jpeg, png, webp] = await Promise.all([source.clone().jpeg().toBuffer(), source.clone().png().toBuffer(), source.clone().webp().toBuffer()]);
    expect(hasAllowedReviewImageSignature(jpeg, "image/jpeg")).toBe(true);
    expect(hasAllowedReviewImageSignature(png, "image/png")).toBe(true);
    expect(hasAllowedReviewImageSignature(webp, "image/webp")).toBe(true);
  });

  it("rejects mismatched, arbitrary and corrupt content", async () => {
    const png = await sharp({ create: { width: 10, height: 10, channels: 3, background: "blue" } }).png().toBuffer();
    expect(hasAllowedReviewImageSignature(png, "image/jpeg")).toBe(false);
    expect(hasAllowedReviewImageSignature(Buffer.from("not an image"), "image/webp")).toBe(false);
    await expect(normalizeReviewImage(Buffer.from([0xff, 0xd8, 0xff, 0x00]))).rejects.toThrow();
  });

  it("decodes, bounds and re-encodes a metadata-free WebP", async () => {
    const source = await sharp({ create: { width: 2600, height: 2000, channels: 3, background: "green" } }).withMetadata({ exif: { IFD0: { Artist: "untrusted" } } }).jpeg().toBuffer();
    const result = await normalizeReviewImage(source);
    const metadata = await sharp(result).metadata();
    expect(metadata.format).toBe("webp");
    expect(metadata.width).toBeLessThanOrEqual(1600);
    expect(metadata.height).toBeLessThanOrEqual(1600);
    expect(metadata.exif).toBeUndefined();
  });
});
