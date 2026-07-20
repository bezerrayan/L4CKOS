import { describe, expect, it } from "vitest";
import sharp from "sharp";
import { hasAllowedReviewImageSignature } from "./reviewUpload";

describe("review image upload signatures", () => {
  it("accepts real JPEG, PNG and WEBP buffers", async () => {
    const source = sharp({
      create: {
        width: 20,
        height: 20,
        channels: 4,
        background: { r: 10, g: 20, b: 30, alpha: 1 },
      },
    });
    const [jpeg, png, webp] = await Promise.all([
      source.clone().jpeg().toBuffer(),
      source.clone().png().toBuffer(),
      source.clone().webp().toBuffer(),
    ]);

    expect(hasAllowedReviewImageSignature(jpeg, "image/jpeg")).toBe(true);
    expect(hasAllowedReviewImageSignature(png, "image/png")).toBe(true);
    expect(hasAllowedReviewImageSignature(webp, "image/webp")).toBe(true);
  });

  it("rejects SVG or mismatched content disguised as PNG", () => {
    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
    expect(hasAllowedReviewImageSignature(svg, "image/png")).toBe(false);
    expect(hasAllowedReviewImageSignature(Buffer.from("not-an-image"), "image/jpeg")).toBe(false);
  });
});

