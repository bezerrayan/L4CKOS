import type { BatchPreview } from "../../../shared/preorder";
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
  salesMode?: "STOCK" | "PREORDER";
  productionBatch?: BatchPreview | null;
  rating?: number;
};
