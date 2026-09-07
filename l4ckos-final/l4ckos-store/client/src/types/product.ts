export type Product = {
  id: number;
  name: string;
  description?: string;
  price: number;
  image: string;
  imageThumbnailUrl?: string;
  imageDetailUrl?: string;
  imageBannerUrl?: string;
  category?: string;
  stock?: number;
  rating?: number;
  variants?: Array<{
    id: number;
    stock?: number | null;
    size?: string | null;
    color?: string | null;
    price?: number | null;
  }>;
};
