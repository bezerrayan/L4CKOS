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
};
