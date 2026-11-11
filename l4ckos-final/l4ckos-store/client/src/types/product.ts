export type Product = {
  id: number;
  name: string;
  description?: string;
  price: number;
  image: string;
  imageThumbnail?: string;
  imageDetail?: string;
  imageBanner?: string;
  category?: string;
  stock?: number;
  rating?: number;
  variantCatalogPresent?: boolean;
  variants?: Array<{
    id: number;
    productId: number;
    sku?: string | null;
    size: string;
    color: string;
    active: boolean;
    stock?: number;
    price?: number | null;
  }>;
};
