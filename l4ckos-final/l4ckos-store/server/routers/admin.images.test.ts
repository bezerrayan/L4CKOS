import { describe, expect, it } from "vitest";
import { buildProductImageList } from "./admin";

describe("product image persistence", () => {
  it("keeps cover variants and avoids duplicating the cover in the gallery", () => {
    const images = buildProductImageList(
      {
        imageUrl: "https://cdn.example.com/camiseta-detail.webp",
        imageThumbnailUrl: "https://cdn.example.com/camiseta-thumb.webp",
        imageDetailUrl: "https://cdn.example.com/camiseta-detail.webp",
        imageBannerUrl: "https://cdn.example.com/camiseta-banner.webp",
      },
      [
        {
          imageUrl: "https://cdn.example.com/camiseta-detail.webp",
          imageThumbnailUrl: "https://cdn.example.com/camiseta-thumb.webp",
        },
        {
          imageUrl: "https://cdn.example.com/camiseta-costas.webp",
          imageThumbnailUrl: "https://cdn.example.com/camiseta-costas-thumb.webp",
          color: "azul-marinho",
        },
      ],
    );

    expect(images).toEqual([
      {
        imageUrl: "https://cdn.example.com/camiseta-detail.webp",
        imageThumbnailUrl: "https://cdn.example.com/camiseta-thumb.webp",
        imageDetailUrl: "https://cdn.example.com/camiseta-detail.webp",
        imageBannerUrl: "https://cdn.example.com/camiseta-banner.webp",
        color: null,
      },
      {
        imageUrl: "https://cdn.example.com/camiseta-costas.webp",
        imageThumbnailUrl: "https://cdn.example.com/camiseta-costas-thumb.webp",
        color: "azul-marinho",
      },
    ]);
  });
});
