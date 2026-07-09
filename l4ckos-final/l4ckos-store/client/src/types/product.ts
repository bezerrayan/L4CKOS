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
};
