import { useNavigate, useLocation } from "react-router-dom";
import type { Product } from "../types/product";
import { Heart } from "lucide-react";
import { useFavorites } from "../contexts/FavoritesContext";
import { getCategoryLabel } from "../lib/productCategories";
import { retryImageWithVersion } from "../lib/images";
import camisaFallback from "../images/camisa.png";
import "./ProductCard.css";

type Props = { product: Product };

export default function ProductCard({ product }: Props) {
  const navigate = useNavigate();
  const location = useLocation();
  const { addToFavorites, removeFromFavorites, isFavorited } = useFavorites();
  const favorited = isFavorited(product.id);
  const formattedPrice = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(product.price);
  const badge = (product.stock ?? 0) <= 0
    ? { text: "INDISPONÍVEL", tone: "unavailable" }
    : (product.stock ?? 0) <= 3
      ? { text: "ESTOQUE REDUZIDO", tone: "low" }
      : product.category?.trim()
        ? { text: getCategoryLabel(product.category).toUpperCase(), tone: "category" }
        : null;
  const goToProduct = () => navigate(`/produto/${product.id}`, { state: { from: location.pathname } });

  return (
    <article className="l4-product-card" onClick={goToProduct}>
      <div className="l4-product-card__media l4-product-media-surface">
        <img className="l4-product-card__image l4-product-media-image" src={product.imageThumbnailUrl || product.image} alt={product.name} onError={(event) => retryImageWithVersion(event, product.image, camisaFallback, product.id)} />
        {badge ? <span className={`l4-product-card__badge l4-product-card__badge--${badge.tone}`}>{badge.text}</span> : null}
        <button
          type="button"
          aria-label={favorited ? `Remover ${product.name} dos favoritos` : `Adicionar ${product.name} aos favoritos`}
          aria-pressed={favorited}
          className={`l4-product-card__favorite ${favorited ? "is-active" : ""}`}
          onClick={(event) => { event.stopPropagation(); if (favorited) removeFromFavorites(product.id); else addToFavorites(product); }}
        >
          <Heart size={15} fill={favorited ? "currentColor" : "none"} aria-hidden="true" />
          <span>{favorited ? "Salvo" : "Salvar"}</span>
        </button>
        <div className="l4-product-card__overlay" aria-hidden="true">{(product.stock ?? 0) > 0 ? "Clique para ver detalhes" : "Indisponível no momento"}</div>
      </div>
      <div className="l4-product-card__content">
        <h3>{product.name}</h3>
        <p className="l4-product-card__price">{formattedPrice}</p>
        <p className="l4-product-card__helper">{(product.stock ?? 0) > 0 ? "Consulte variações, disponibilidade e prazo na página do produto." : "Este item está temporariamente indisponível."}</p>
        <button type="button" className="l4-product-card__cta" onClick={(event) => { event.stopPropagation(); goToProduct(); }}>Ver detalhes</button>
      </div>
    </article>
  );
}
