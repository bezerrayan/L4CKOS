import { batchAcceptsSales, batchHasCapacity } from "../../../shared/preorder";
﻿import { Link, useLocation } from "react-router-dom";
import { Heart } from "lucide-react";
import type { Product } from "../types/product";
import { useFavorites } from "../contexts/FavoritesContext";
import { getCategoryLabel } from "../lib/productCategories";
import { retryImageWithVersion } from "../lib/images";
import "./ProductCard.css";
import camisaFallback from "../images/camisa.png";

type Props = {
  product: Product;
  showFavorite?: boolean;
  imageLoading?: "eager" | "lazy";
};

export default function ProductCard({ product, showFavorite = true, imageLoading = "lazy" }: Props) {
  const location = useLocation();
  const { addToFavorites, removeFromFavorites, isFavorited } = useFavorites();
  const favorited = isFavorited(product.id);
  const formattedPrice = new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
  }).format(product.price);

  const getBadgeInfo = () => {
    if (product.salesMode === "PREORDER")
      return { text: !batchAcceptsSales(product.productionBatch)
          ? "PRÉ-VENDA INDISPONÍVEL"
          : !batchHasCapacity(product.productionBatch)
            ? "PRÉ-VENDA ESGOTADA"
            : "PRÉ-VENDA", color: "#191919",
      };
    if (product.hasVariants) return product.hasSellableVariants
      ? { text: "ESCOLHA SUA VARIANTE", color: "#244f38" }
      : { text: "INDISPONÍVEL", color: "#5b1d1d" };
    if ((product.stock ?? 0) <= 0) return { text: "INDISPONÍVEL", color: "#5b1d1d" };
    if ((product.stock ?? 0) <= 3) return { text: "ESTOQUE REDUZIDO", color: "#6b3e0b" };
    return null;
  };

  const badge = getBadgeInfo();
  const available = product.salesMode === "PREORDER"
    ? batchAcceptsSales(product.productionBatch) && batchHasCapacity(product.productionBatch) &&
      (product.hasVariants !== true || product.hasSellableVariants === true)
    : product.hasVariants === true ? product.hasSellableVariants === true : (product.stock ?? 0) > 0;

  return (
    <article className="l4-catalog-card">
      <Link className="l4-catalog-card-link" to={`/produto/${product.id}`} state={{ from: location.pathname }}>
        <div className="l4-catalog-card-media l4-product-media-surface">
          <img className="l4-product-media-image" src={product.imageThumbnail || product.image}
            alt={product.name} loading={imageLoading} decoding="async"
            onError={event => retryImageWithVersion(event, product.image, camisaFallback, product.id)} />
          {badge ? <span className="l4-catalog-card-badge">{badge.text}</span> : null}
        </div>
        <div className="l4-catalog-card-content">
          <p className="l4-catalog-card-category">{getCategoryLabel(product.category) || "L4CKOS ORIGINAL"}</p>
          <h3>{product.name}</h3>
          <div className="l4-catalog-card-bottom"><strong>{formattedPrice}</strong><span aria-hidden="true">↗</span></div>
          <p className="l4-catalog-card-hint">{available ? "Ver tamanhos e detalhes" : "Indisponível no momento"}</p>
        </div>
      </Link>
      {showFavorite ? <button className="l4-catalog-card-favorite" type="button"
        aria-label={favorited ? `Remover ${product.name} dos favoritos` : `Adicionar ${product.name} aos favoritos`}
        aria-pressed={favorited}
        onClick={() => favorited ? removeFromFavorites(product.id) : addToFavorites(product)}>
        <Heart size={18} fill={favorited ? "currentColor" : "none"} aria-hidden="true" />
      </button> : null}
    </article>
  );
}
