import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { buildProductImageVariants } from "./upload";

describe("product upload image variants", () => {
  it("keeps a panoramic product image whole in every generated variant", async () => {
    const blueBase = sharp({
      create: {
        width: 1600,
        height: 800,
        channels: 4,
        background: { r: 25, g: 40, b: 90, alpha: 1 },
      },
    });
    const [leftEdge, rightEdge] = await Promise.all([
      sharp({ create: { width: 40, height: 800, channels: 4, background: { r: 230, g: 40, b: 40, alpha: 1 } } }).png().toBuffer(),
      sharp({ create: { width: 40, height: 800, channels: 4, background: { r: 40, g: 210, b: 80, alpha: 1 } } }).png().toBuffer(),
    ]);
    const source = await blueBase
      .composite([
        { input: leftEdge, left: 0, top: 0 },
        { input: rightEdge, left: 1560, top: 0 },
      ])
      .png()
      .toBuffer();

    const variants = await buildProductImageVariants(source);
    const [thumbnail, detail, banner] = await Promise.all([
      sharp(variants.thumbnail).metadata(),
      sharp(variants.detail).metadata(),
      sharp(variants.banner).metadata(),
    ]);

    expect(thumbnail).toMatchObject({ width: 800, height: 1000, format: "webp" });
    expect(detail).toMatchObject({ width: 1200, height: 1500, format: "webp" });
    expect(banner).toMatchObject({ width: 1600, height: 900, format: "webp" });

    // As faixas coloridas nas bordas confirmam que os dois lados da foto continuam presentes.
    const { data, info } = await sharp(variants.thumbnail).raw().toBuffer({ resolveWithObject: true });
    const pixelAt = (x: number, y: number) => data.slice((y * info.width + x) * info.channels, (y * info.width + x) * info.channels + 3);
    const leftPixel = pixelAt(5, 500);
    const rightPixel = pixelAt(795, 500);
    expect(leftPixel[0]).toBeGreaterThan(160);
    expect(leftPixel[1]).toBeLessThan(100);
    expect(rightPixel[0]).toBeLessThan(100);
    expect(rightPixel[1]).toBeGreaterThan(140);
  });

  it("preserves transparency around a cutout product in every generated variant", async () => {
    const transparentSource = await sharp({
      create: {
        width: 500,
        height: 700,
        channels: 4,
        background: { r: 0, g: 0, b: 0, alpha: 0 },
      },
    })
      .composite([
        {
          input: await sharp({
            create: {
              width: 260,
              height: 520,
              channels: 4,
              background: { r: 15, g: 30, b: 75, alpha: 1 },
            },
          }).png().toBuffer(),
          left: 120,
          top: 90,
        },
      ])
      .png()
      .toBuffer();

    const variants = await buildProductImageVariants(transparentSource);

    for (const variant of Object.values(variants)) {
      const { data, info } = await sharp(variant).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
      expect(info.channels).toBe(4);
      expect(data[3]).toBe(0);

      const centerAlphaIndex = (Math.floor(info.height / 2) * info.width + Math.floor(info.width / 2)) * info.channels + 3;
      expect(data[centerAlphaIndex]).toBe(255);
    }
  });
});
