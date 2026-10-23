import { PreorderInfo } from "../components/PreorderInfo";
import { batchAcceptsSales, transportEstimate, TRANSPORT_DEADLINE_NOTICE } from "../../../shared/preorder";
﻿/**
 * Pagina ProductDetail - Detalhes completos do produto
 * Exibe informações completas, opções de customização e ações de compra.
 */

import { useParams, useNavigate, useLocation } from "react-router-dom";
import { Link } from "react-router-dom";
import { useCart } from "../contexts/CartContext";
import { useFavorites } from "../contexts/FavoritesContext";
import { useToast } from "../contexts/ToastContext";
import type { CSSProperties } from "react";
import { useMemo, useState, useEffect, useRef, useCallback } from "react";
import { useIsMobile } from "../hooks/useIsMobile";
import { trpc } from "../lib/trpc";
import camisaFallback from "../images/camisa.png";
import { getCategoryLabel } from "../lib/productCategories";
import { resolveCatalogImageUrl, retryImageWithVersion } from "../lib/images";
import { apiUrl } from "../const";
import { csrfFetch } from "../lib/csrf";
import { trackStoreEvent } from "../lib/analytics";
import { ProductReviews } from "../components/reviews/ProductReviews";
import { productPriceFromCents } from "../utils/money";
import ProductCard from "../components/ProductCard";
import type { Product } from "../types/product";
import { Heart } from "lucide-react";
import "./ProductDetail.css";

import { DEFAULT_COLORS, DEFAULT_SIZES } from "@shared/catalogOptions";
const COLOR_HEX_BY_NAME: Record<string, string> = {
  preto: "#1a1a1a",
  branco: "#ffffff",
  azul: "#1e40af",
  "azul-marinho": "#07112f",
  vermelho: "#dc2626",
  verde: "#15803d",
  cinza: "#6b7280",
  amarelo: "#f59e0b",
  bege: "#d6c6a5",
  marrom: "#7c4a2d",
  rosa: "#ec4899",
  roxo: "#7c3aed",
  laranja: "#ea580c",
};

const purchaseHighlights = [
  "Selecione cor e tamanho antes de concluir a compra.",
  "Frete e prazo são calculados conforme CEP e disponibilidade.",
  "Trocas e devoluções seguem a política publicada no site.",
];

type ShippingOption = {
  id: string;
  label: string;
  description: string;
  price: number;
  minDays: number | null;
  maxDays: number | null;
};

function sanitizeCep(value: string) {
  return value.replace(/\D/g, "").slice(0, 8);
}

function formatCep(value: string) {
  const digits = sanitizeCep(value);
  return digits.length > 5 ? `${digits.slice(0, 5)}-${digits.slice(5)}` : digits;
}

function normalizePrice(value: number) {
  return productPriceFromCents(value);
}

function resolveProductImageUrl(imageUrl?: string | null) {
  if (!imageUrl) return camisaFallback;
  return resolveCatalogImageUrl(imageUrl) || camisaFallback;
}

function parseJsonList(raw: unknown): string[] {
  if (!raw || typeof raw !== "string") return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.map(item => String(item).trim()).filter(Boolean);
  } catch {
    return [];
  }
}

function normalizeColorToken(value: string | null | undefined) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, "-");
}

export default function ProductDetail() {
  const isMobile = useIsMobile();
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const { addToCart, closeCartDrawer, preorderAdditionalLimit } = useCart();
  const { addToFavorites, removeFromFavorites, isFavorited } = useFavorites();
  const { showToast } = useToast();

  const [selectedColor, setSelectedColor] = useState<string | null>(null);
  const [selectedSize, setSelectedSize] = useState<string | null>(null);
  const [quantity, setQuantity] = useState(1);
  const [showSelectionWarning, setShowSelectionWarning] = useState(false);
  const [selectedImage, setSelectedImage] = useState<string | null>(null);
  const [cep, setCep] = useState("");
  const [shippingOptions, setShippingOptions] = useState<ShippingOption[]>([]);
  const [shippingError, setShippingError] = useState("");
  const [isCalculatingShipping, setIsCalculatingShipping] = useState(false);
  const shippingContextRef = useRef("");
  shippingContextRef.current = `${id}:${sanitizeCep(cep)}:${quantity}`;
  useEffect(() => { setShippingOptions([]); }, [id, cep, quantity]);

  const productId = id ? parseInt(id) : null;
  const productQuery = trpc.products.getById.useQuery(productId ?? 0, {
    enabled: Boolean(productId),
    staleTime: 0,
    refetchOnMount: "always",
    refetchInterval: 15000,
  });
  const sellableVariantsQuery = trpc.products.sellableVariants.useQuery(productId ?? 0, {
    enabled: Boolean(productId),
    staleTime: 0,
    refetchOnMount: "always",
    refetchOnWindowFocus: true,
    refetchInterval: 15000,
  });
  const sellableVariantCatalog = sellableVariantsQuery.data?.productId === productId
    ? sellableVariantsQuery.data
    : undefined;
  const product = productQuery.data
    ? {
        id: productQuery.data.id,
        name: productQuery.data.name,
        salesMode: productQuery.data.salesMode,
        productionBatch: productQuery.data.productionBatch,
        description: productQuery.data.description || "",
        fullDescription: productQuery.data.fullDescription || "",
        price: normalizePrice(Number(productQuery.data.price)),
        image: resolveProductImageUrl((productQuery.data as any).imageDetailUrl || productQuery.data.imageUrl),
        imageThumbnail: resolveProductImageUrl((productQuery.data as any).imageThumbnailUrl || productQuery.data.imageUrl),
        imageDetail: resolveProductImageUrl((productQuery.data as any).imageDetailUrl || productQuery.data.imageUrl),
        imageBanner: resolveProductImageUrl((productQuery.data as any).imageBannerUrl || productQuery.data.imageUrl),
        category: productQuery.data.category,
        stock: Number(productQuery.data.stock ?? 0),
        optionColors: parseJsonList((productQuery.data as any).optionColors),
        optionSizes: parseJsonList((productQuery.data as any).optionSizes),
        sizeType: String((productQuery.data as any).sizeType ?? "alpha"),
        images:
          Array.isArray((productQuery.data as any).images) && (productQuery.data as any).images.length > 0
            ? ((productQuery.data as any).images as Array<any>).map((img) => ({
                imageUrl: resolveProductImageUrl(typeof img === "string" ? img : img?.imageDetailUrl || img?.imageUrl),
                imageThumbnailUrl: resolveProductImageUrl(typeof img === "string" ? img : img?.imageThumbnailUrl || img?.imageUrl),
                color: typeof img === "string" ? null : String(img?.color ?? "").trim() || null,
              }))
            : [],
      }
    : null;
  const isFav = product ? isFavorited(product.id) : false;

  useEffect(() => {
    window.scrollTo(0, 0);
  }, [id]);

  useEffect(() => {
    if (selectedColor && selectedSize) {
      setShowSelectionWarning(false);
    }
  }, [selectedColor, selectedSize]);

  useEffect(() => {
    if (!product) return;
    setSelectedImage(product.image);
  }, [product?.id, product?.image]);

  useEffect(() => {
    if (product) trackStoreEvent("product_viewed", { product_id: product.id, category: product.category || null });
  }, [product?.id]);

  const galleryImages = useMemo(
    () =>
      !product
        ? []
        : Array.from(
            new Map(
              [
                { imageUrl: product.image, color: null },
                ...(product.images || []),
              ]
                .filter(item => item?.imageUrl)
                .map(item => [item.imageUrl, item]),
            ).values(),
          ),
    [product],
  );
  const activeGalleryImages = useMemo(() => {
    if (!selectedColor) return galleryImages;
    const colorMatches = galleryImages.filter(
      item => normalizeColorToken(item.color) === normalizeColorToken(selectedColor),
    );
    if (colorMatches.length === 0) return galleryImages;

    // Fotos sem cor vinculada são fotos gerais do produto e devem continuar na galeria.
    // Assim, selecionar uma cor não faz as fotos adicionais desaparecerem.
    const sharedImages = galleryImages.filter(item => !normalizeColorToken(item.color));
    return Array.from(
      new Map([...colorMatches, ...sharedImages].map(item => [item.imageUrl, item])).values(),
    );
  }, [galleryImages, selectedColor]);
  const handleGoBack = () => {
    const from = (location.state as any)?.from;
    if (from === "/" || from === "/produtos") {
      navigate(from);
    } else {
      navigate("/");
    }
  };

  useEffect(() => {
    if (activeGalleryImages.length === 0) return;
    const currentImageVisible = selectedImage
      ? activeGalleryImages.some(item => item.imageUrl === selectedImage)
      : false;
    if (!currentImageVisible && activeGalleryImages[0]?.imageUrl) {
      setSelectedImage(activeGalleryImages[0].imageUrl);
    }
  }, [activeGalleryImages, selectedImage]);

  if (!product) {
    if (productQuery.isLoading) {
      return <div className="l4-product-loading" role="status"><div className="l4-skeleton-card" aria-hidden="true" /><p>Carregando os detalhes da peça...</p></div>;
    }
    return (
      <div style={styles.errorContainer as CSSProperties}>
        <h1>{productQuery.isError ? "Não conseguimos carregar esta peça" : "Produto não encontrado"}</h1>
        <p>{productQuery.isError ? "Verifique sua conexão e tente novamente em instantes." : "Explore a coleção para encontrar outras peças."}</p>
        <button
          onClick={handleGoBack}
          style={styles.backButton as CSSProperties}
        >
          Voltar
        </button>
      </div>
    );
  }

  const normalizedGalleryImages = Array.from(
    new Map(
      Array.from(activeGalleryImages.map(item => [item.imageUrl, item])),
    ).values(),
  );
  const hasVariants = sellableVariantCatalog?.hasVariants === true;
  const publicVariants = hasVariants ? sellableVariantCatalog.variants : [];
  const colorNames = hasVariants
    ? Array.from(new Set(publicVariants.map(variant => variant.color)))
    : (product.optionColors?.length ? product.optionColors : DEFAULT_COLORS);
  const colorOptions = colorNames.map(name => ({
    name,
    hex: COLOR_HEX_BY_NAME[name.toLowerCase()] ?? "#d1d5db",
  }));
  const sizeOptions = hasVariants
    ? Array.from(new Set(publicVariants
        .filter(variant => !selectedColor || variant.color === selectedColor)
        .map(variant => variant.size)))
    : (product.optionSizes?.length ? product.optionSizes : DEFAULT_SIZES);
  const selectedVariant = hasVariants && selectedColor && selectedSize
    ? publicVariants.find(variant => variant.color === selectedColor && variant.size === selectedSize)
    : undefined;
  const variantCatalogReady = sellableVariantCatalog !== undefined;
  const publicPurchaseAllowed = sellableVariantCatalog?.publicPurchaseAllowed === true;
  const preorderLimit = preorderAdditionalLimit(product);
  const available = publicPurchaseAllowed && (hasVariants
    ? variantCatalogReady && Boolean(selectedVariant?.available) &&
      (selectedVariant?.availableUnits === null || Number(selectedVariant?.availableUnits) >= quantity) &&
      (product.salesMode !== "PREORDER" || (batchAcceptsSales(product.productionBatch) && (preorderLimit === null || preorderLimit >= quantity)))
    : variantCatalogReady && (product.salesMode === "PREORDER"
      ? batchAcceptsSales(product.productionBatch) && (preorderLimit === null || preorderLimit >= quantity)
      : product.stock >= quantity));
  const stockQuantityLimit = hasVariants
    ? selectedVariant?.availableUnits ?? 99
    : product.stock;
  const quantityLimit = product.salesMode === "PREORDER"
    ? Math.max(1, Math.min(preorderLimit ?? 99, 99))
    : Math.max(1, Math.min(stockQuantityLimit, 99));
  const canAddToCart = Boolean(selectedColor && selectedSize && available);
  const missingSelections: string[] = [];
  const formattedPrice = new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
  }).format(selectedVariant ? productPriceFromCents(selectedVariant.price) : product.price);
  if (!selectedColor) missingSelections.push("cor");
  if (!selectedSize) missingSelections.push("tamanho");

  const handleAddToCart = () => {
    if (!available) {
      showToast({
        message: "Este produto está Indisponível no momento.",
        duration: 3500,
      });
      return;
    }

    if (!selectedColor || !selectedSize) {
      setShowSelectionWarning(true);
      showToast({
        message: "Selecione cor e tamanho antes de adicionar à sacola",
        duration: 3500,
      });
      return;
    }
    if (!variantCatalogReady || (hasVariants && !selectedVariant)) {
      showToast({
        message: "Selecione uma combinação disponível antes de continuar.",
        duration: 3500,
      });
      return;
    }

    if (
      !addToCart(product, quantity, {
        cor: selectedColor,
        tamanho: selectedSize,
      }, selectedVariant ? {
        variantId: selectedVariant.variantId,
        color: selectedVariant.color,
        size: selectedVariant.size,
        priceCents: selectedVariant.price,
        availableUnits: selectedVariant.availableUnits,
      } : undefined)
    ) {
      showToast({
        message: "A disponibilidade da pré-venda mudou. Ajuste a quantidade.",
        duration: 3500,
      });
      return;
    }
    setShowSelectionWarning(false);
    setQuantity(1);
  };

  const handleBuyNow = () => {
    if (!available) {
      showToast({ message: "Este produto está indisponível no momento.", duration: 3500 });
      return;
    }

    if (!selectedColor || !selectedSize) {
      setShowSelectionWarning(true);
      showToast({ message: "Selecione cor e tamanho antes de comprar.", duration: 3500 });
      return;
    }
    if (!variantCatalogReady || (hasVariants && !selectedVariant)) {
      showToast({
        message: "Selecione uma combinação disponível antes de continuar.",
        duration: 3500,
      });
      return;
    }

    if (
      !addToCart(product, quantity, {
        cor: selectedColor,
        tamanho: selectedSize,
      }, selectedVariant ? {
        variantId: selectedVariant.variantId,
        color: selectedVariant.color,
        size: selectedVariant.size,
        priceCents: selectedVariant.price,
        availableUnits: selectedVariant.availableUnits,
      } : undefined)
    ) {
      showToast({
        message: "A disponibilidade da pré-venda mudou. Ajuste a quantidade.",
        duration: 3500,
      });
      return;
    }
    setShowSelectionWarning(false);
    closeCartDrawer();
    navigate("/checkout");
  };

  const handleCalculateShipping = async () => {
    const context = shippingContextRef.current;
    const normalizedCep = sanitizeCep(cep);
    setShippingError("");

    if (normalizedCep.length !== 8) {
      setShippingOptions([]);
      setShippingError("Informe um CEP válido com 8 dígitos.");
      return;
    }

    setIsCalculatingShipping(true);
    try {
      const response = await csrfFetch(apiUrl("/api/shipping/quote"), {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          cep: normalizedCep,
          itemCount: quantity,
          subtotal: Number((product.price * quantity).toFixed(2)),
        }),
      });

      const data = (await response.json()) as { options?: ShippingOption[]; error?: string; warning?: string };
      if (context !== shippingContextRef.current) return;
      if (!response.ok) throw new Error(data.error || "Não foi possível calcular o frete.");

      setShippingOptions(data.options || []);
      setShippingError(data.warning || (data.options?.length ? "" : "Não há cotação disponível para este CEP. Consulte a loja antes de comprar."));
      trackStoreEvent("shipping_quoted", { product_id: product.id, options_count: data.options?.length ?? 0 });
    } catch (error) {
      if (context !== shippingContextRef.current) return;
      setShippingOptions([]);
      setShippingError(error instanceof Error ? error.message : "Não foi possível calcular o frete.");
      trackStoreEvent("shipping_quoted", { product_id: product.id, success: false });
    } finally {
      setIsCalculatingShipping(false);
    }
  };

  const handleAddToFavorites = () => {
    if (!product) return;

    if (isFav) {
      removeFromFavorites(product.id);
      showToast({
        message: `${product.name} removido dos favoritos`,
        duration: 3000,
      });
    } else {
      addToFavorites(product);
      showToast({
        message: `${product.name} adicionado aos favoritos`,
        duration: 3000,
      });
    }
  };

  return (
    <div className="l4-product-page l4-detail-editorial">
      <button
        onClick={handleGoBack}
        style={{
          ...styles.backButton,
          marginBottom: isMobile ? 18 : styles.backButton.marginBottom,
          padding: isMobile ? "10px 16px" : styles.backButton.padding,
          borderRadius: isMobile ? 10 : styles.backButton.borderRadius,
        } as CSSProperties}
      >
        Voltar
      </button>

      <div className="l4-product-layout">
        <div className="l4-detail-gallery">
          <div className="l4-detail-gallery-surface">
            <img
              className="l4-product-media-image"
              src={selectedImage || product.image}
              alt={product.name}
              style={styles.productImage as CSSProperties}
              onError={(event) => {
                retryImageWithVersion(event, selectedImage || product.image, camisaFallback, `${product.id}-hero`);
              }}
            />
          </div>

          {normalizedGalleryImages.length > 1 && <div className="l4-detail-thumbnails" aria-label="Fotos do produto">
            {normalizedGalleryImages.map((image, idx) => {
              const active = (selectedImage || product.image) === image.imageUrl;
              return (
                <button
                  className="l4-detail-thumbnail"
                  aria-label={`Ver foto ${idx + 1} de ${product.name}`}
                  aria-pressed={active}
                  key={`${image.imageUrl}-${idx}`}
                  type="button"
                  onClick={() => setSelectedImage(image.imageUrl)}
                >
                  <img
                    className="l4-product-media-image"
                    src={(image as any).imageThumbnailUrl || image.imageUrl}
                    alt={`Foto ${idx + 1}`}
                    style={styles.thumbImage as CSSProperties}
                    onError={(event) => {
                      retryImageWithVersion(event, image.imageUrl, camisaFallback, `${product.id}-${idx}`);
                    }}
                  />
                </button>
              );
            })}
          </div>}
        </div>

        <div className="l4-detail-info">
          <div style={styles.headerSection as CSSProperties}>
            <h1>{product.name}</h1>
            <PreorderInfo product={product} />
            <div style={styles.headerMetaRow as CSSProperties}>
              <span className="l4-detail-category">{getCategoryLabel(product.category) || "Produto oficial"}</span>
                <button
                  type="button"
                  className="l4-detail-favorite"
                  aria-label={isFav ? "Remover dos favoritos" : "Adicionar aos favoritos"}
                  aria-pressed={isFav}
                  onClick={handleAddToFavorites}
                >
                  <Heart size={21} fill={isFav ? "currentColor" : "none"} aria-hidden="true" />
              </button>
            </div>
          </div>

          <div style={styles.priceSection as CSSProperties}>
            <p className="l4-product-price">{formattedPrice}</p>
            {product.description ? <p style={styles.priceDescription as CSSProperties}>{product.description}</p> : null}
          </div>

          <div style={styles.sectionBlock as CSSProperties}>
            <h3 style={styles.sectionTitle as CSSProperties}>Cores disponíveis</h3>
            {hasVariants && publicVariants.length === 0 ? <p className="l4-product-option-note" role="status">Nenhuma combinação está disponível para seleção no momento.</p> : null}
            <div style={styles.colorGrid as CSSProperties}>
              {colorOptions.map((color) => (
                (() => {
                  const isSelected = selectedColor === color.name;
                  const isLightColor = ["#ffffff", "#fff", "#f5f5f5", "#d1d5db"].includes(color.hex.toLowerCase());
                  return (
                    <button
                      key={color.name}
                      className="l4-detail-color"
                      type="button"
                      onClick={() => {
                        setSelectedColor(color.name);
                        if (hasVariants && selectedSize && !publicVariants.some(variant => variant.color === color.name && variant.size === selectedSize)) setSelectedSize(null);
                        trackStoreEvent("product_option_selected", { product_id: product.id, option_type: "color" });
                      }}
                      aria-pressed={isSelected}
                      aria-label={`Selecionar cor ${color.name}`}
                      style={{
                        "--l4-variant-color": color.hex,
                      } as CSSProperties}
                      title={color.name}
                    >
                      {isSelected && (
                        <span
                          style={{
                            ...styles.colorCheckmark,
                            color: isLightColor ? "#080808" : "#ffffff",
                            textShadow: isLightColor ? "0 1px 0 rgba(255,255,255,0.55)" : "0 1px 5px rgba(0,0,0,0.85)",
                          } as CSSProperties}
                        >
                          ✓
                        </span>
                      )}
                    </button>
                  );
                })()
              ))}
            </div>
            <p style={styles.selectedLabel as CSSProperties}>
              Selecionado:{" "}
              <strong style={selectedColor ? styles.selectedValue : undefined}>{selectedColor || "Nenhuma cor"}</strong>
            </p>
          </div>

          <div style={styles.sectionBlock as CSSProperties}>
            <h3 style={styles.sectionTitle as CSSProperties}>{product.sizeType === "numeric" ? "Tamanho (numérico)" : "Tamanho"}</h3>
            <div
              style={{
                ...styles.sizeGrid,
                gridTemplateColumns: isMobile ? (product.sizeType === "numeric" ? "repeat(4, 1fr)" : "repeat(3, 1fr)") : styles.sizeGrid.gridTemplateColumns,
                gap: isMobile ? 10 : styles.sizeGrid.gap,
              } as CSSProperties}
            >
              {sizeOptions.map((size) => (
                <button
                  key={size}
                  type="button"
                  onClick={() => { setSelectedSize(size); trackStoreEvent("product_option_selected", { product_id: product.id, option_type: "size" }); }}
                  aria-pressed={selectedSize === size}
                  style={{
                    ...styles.sizeOption,
                    background: selectedSize === size ? "#e8002a" : "#111111",
                    color: selectedSize === size ? "#ffffff" : "#f0ede8",
                    border: selectedSize === size ? "2px solid #ff4966" : styles.sizeOption.border,
                  } as CSSProperties}
                >
                  {size}
                </button>
              ))}
            </div>
            <p style={styles.selectedLabel as CSSProperties}>
              Selecionado:{" "}
              <strong style={selectedSize ? styles.selectedValue : undefined}>{selectedSize || "Nenhum tamanho"}</strong>
            </p>
          </div>

          <div style={styles.sectionBlock as CSSProperties}>
            <h3 style={styles.sectionTitle as CSSProperties}>Quantidade</h3>
            <div style={styles.quantityControl as CSSProperties}>
              <button
                type="button"
                aria-label="Diminuir quantidade"
                onClick={() => setQuantity(Math.max(1, quantity - 1))}
                style={styles.quantityBtn as CSSProperties}
                disabled={!available}
              >
                -
              </button>
              <input
                aria-label="Quantidade"
                type="number"
                min="1"
                 max={quantityLimit}
                value={quantity}
                 onChange={(e) =>
                   setQuantity(
                     Math.min(quantityLimit, Math.max(1, parseInt(e.target.value) || 1))
                   )
                 }
                style={styles.quantityInput as CSSProperties}
              />
              <button
                type="button"
                aria-label="Aumentar quantidade"
                onClick={() => setQuantity(Math.min(quantityLimit, quantity + 1))}
                style={styles.quantityBtn as CSSProperties}
                disabled={!available}
              >
                +
              </button>
            </div>
          {product.salesMode === "PREORDER" && preorderLimit !== null ? (
              <p style={styles.helperText}>
                {preorderLimit > 0
                  ? `${preorderLimit} peça${preorderLimit === 1 ? "" : "s"} disponível${preorderLimit === 1 ? "" : "is"} neste lote.`
                  : "Lote esgotado."}
              </p>
            ) : null}
          </div>

          <div className="l4-detail-actions">
            <button
              onClick={handleBuyNow}
              className="l4-detail-buy"
              disabled={!available}
            >
              {available ? "Comprar agora" : "Indisponível"}
            </button>
            <button
              onClick={handleAddToCart}
              className="l4-detail-add"
              disabled={!available}
            >
              Adicionar à sacola
            </button>
          </div>

          {showSelectionWarning && !canAddToCart && (
            <p style={styles.selectionWarning as CSSProperties}>
              Selecione {missingSelections.join(" e ")} antes de continuar.
            </p>
          )}

          {product.salesMode !== "PREORDER" && (hasVariants || product.stock >= 0) && (
            <div style={styles.stockInfo as CSSProperties} role="status">
              <span style={{ color: (hasVariants ? Number(selectedVariant?.availableUnits ?? 0) : product.stock) > 5 ? "#d1d5db" : "#ff869a" }}>
                {hasVariants && !selectedVariant
                  ? "Selecione uma combinação disponível"
                  : (hasVariants ? Number(selectedVariant?.availableUnits ?? 0) : product.stock) > 5
                  ? "Disponível para compra"
                  : (hasVariants ? Number(selectedVariant?.availableUnits ?? 0) : product.stock) > 0
                    ? "Estoque reduzido"
                    : "Indisponível no momento"}
              </span>
            </div>
          )}

          <div className="l4-detail-secondary">
            <div>
              <strong style={styles.shippingEstimatorTitle as CSSProperties}>Calcule o frete</strong>
            </div>
            <div style={styles.shippingInputRow as CSSProperties}>
              <input
                value={formatCep(cep)}
                onChange={(event) => setCep(sanitizeCep(event.target.value))}
                onKeyDown={(event) => {
                  if (event.key === "Enter") void handleCalculateShipping();
                }}
                placeholder="Seu CEP"
                inputMode="numeric"
                autoComplete="postal-code"
                aria-label="CEP para calcular frete"
                style={styles.shippingInput as CSSProperties}
              />
              <button type="button" onClick={handleCalculateShipping} disabled={isCalculatingShipping} style={styles.shippingCalcButton as CSSProperties}>
                {isCalculatingShipping ? "Calculando..." : "Calcular"}
              </button>
            </div>
            <details className="l4-detail-disclosure l4-detail-shipping-notice">
              <summary>Como funcionam os prazos</summary>
              <p>Consulte valor e prazo de transporte para seu CEP. {TRANSPORT_DEADLINE_NOTICE}</p>
            </details>
            {shippingError ? <p style={styles.shippingMessage as CSSProperties}>{shippingError}</p> : null}
            {shippingOptions.length > 0 ? (
              <div style={styles.shippingResults as CSSProperties}>
                {shippingOptions.map((option) => (
                  <div key={option.id} style={styles.shippingResult as CSSProperties}>
                    <div style={styles.shippingResultInfo as CSSProperties}>
                      <strong>{option.label}</strong>
                      <span style={styles.shippingResultDeadline as CSSProperties}>{transportEstimate(option)}</span>
                    </div>
                    <strong>{new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(option.price)}</strong>
                  </div>
                ))}
              </div>
            ) : null}
          </div>

          <div className="l4-detail-disclosures">
            <details className="l4-detail-disclosure">
              <summary>DETALHES DO PRODUTO</summary>
              {(product.fullDescription || product.description) && <p>{product.fullDescription || product.description}</p>}
              <p>{purchaseHighlights[0]}</p>
            </details>
            <details className="l4-detail-disclosure">
              <summary>ENTREGA E PRAZOS</summary>
              <p>{purchaseHighlights[1]}</p>
              <p>Consulte “Como funcionam os prazos” no cálculo de frete para as condições de transporte.</p>
            </details>
            <details className="l4-detail-disclosure">
              <summary>TROCAS E DEVOLUÇÕES</summary>
              <p>{purchaseHighlights[2]}</p>
              <Link to="/trocas-e-devolucoes">Consultar política de trocas e devoluções →</Link>
            </details>
          </div>

          <div className="l4-detail-help">
            <strong>PRECISA DE AJUDA?</strong>
            <p>Dúvidas sobre tamanho ou disponibilidade?</p>
            <Link to="/contato">Falar com a L4CKOS →</Link>
          </div>

        </div>
      </div>
      <ProductReviews productId={product.id} />
      <RelatedProducts currentId={product.id} category={product.category} />
    </div>
  );
}

function RelatedProducts({ currentId, category }: { currentId: number; category: string | null }) {
  const query = trpc.products.list.useQuery({ limit: 200 }, { staleTime: 30_000 });
  const track = useRef<HTMLDivElement>(null);
  const [bounds, setBounds] = useState({ start: true, end: true, overflow: false });
  const products = useMemo<Product[]>(() => {
    const unique = [...new Map((query.data ?? []).filter(item => item.id !== currentId).map(item => [item.id, item])).values()];
    return unique.sort((a, b) => Number(b.category === category) - Number(a.category === category) || a.id - b.id)
      .slice(0, 8).map(item => ({
        id: item.id, name: item.name, category: item.category ?? undefined,
        price: normalizePrice(Number(item.price)), stock: Number(item.stock ?? 0),
        salesMode: item.salesMode, productionBatch: item.productionBatch,
        image: resolveProductImageUrl(item.imageUrl),
        imageThumbnail: resolveProductImageUrl(item.imageThumbnailUrl || item.imageUrl),
      }));
  }, [query.data, currentId, category]);
  const updateBounds = useCallback(() => {
    const element = track.current;
    if (!element) return;
    const next = { start: element.scrollLeft <= 2, end: element.scrollLeft + element.clientWidth >= element.scrollWidth - 2, overflow: element.scrollWidth > element.clientWidth + 2 };
    setBounds(previous => previous.start === next.start && previous.end === next.end && previous.overflow === next.overflow ? previous : next);
  }, []);
  useEffect(() => {
    const element = track.current;
    if (!element) return;
    element.scrollLeft = 0;
    updateBounds();
    const observer = new ResizeObserver(updateBounds);
    observer.observe(element);
    return () => observer.disconnect();
  }, [currentId, products.length, query.isError, updateBounds]);
  const move = (direction: number) => {
    const element = track.current;
    if (!element) return;
    element.scrollBy({ left: direction * element.clientWidth * .8, behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
  };
  if (!products.length || query.isError) return null;
  return (
    <section className="l4-detail-related" aria-labelledby="l4-related-title">
      <div className="l4-related-heading">
        <h2 id="l4-related-title">EXPLORE OUTRAS PEÇAS</h2>
        <Link to="/produtos">VER COLEÇÃO COMPLETA</Link>
        {bounds.overflow && <div className="l4-related-controls">
          <button type="button" aria-label="Peças anteriores" aria-controls="l4-related-track" disabled={bounds.start} onClick={() => move(-1)}>←</button>
          <button type="button" aria-label="Próximas peças" aria-controls="l4-related-track" disabled={bounds.end} onClick={() => move(1)}>→</button>
        </div>}
      </div>
      <div id="l4-related-track" className="l4-related-track l4-minimal-products" ref={track} onScroll={updateBounds}
        tabIndex={0} role="group" aria-label="Outras peças; deslize ou use as setas do teclado"
        onKeyDown={event => {
          if (event.target !== event.currentTarget || !["ArrowLeft", "ArrowRight"].includes(event.key)) return;
          event.preventDefault(); move(event.key === "ArrowLeft" ? -1 : 1);
        }}>
        {products.map(item => <div key={item.id}><ProductCard product={item} /></div>)}
      </div>
    </section>
  );
}

const styles: Record<string, CSSProperties> = {
  backButton: {
    display: "inline-block",
    padding: "10px 20px",
    background: "#161616",
    border: "1px solid #2f2f2f",
    borderRadius: 8,
    cursor: "pointer",
    fontSize: 14,
    fontWeight: 600,
    color: "#f0ede8",
    marginBottom: 32,
    transition: "all 0.2s ease",
  },
  errorContainer: {
    textAlign: "center",
    padding: 60,
  },
  container: {
    display: "grid",
    gridTemplateColumns: "1fr 1fr",
    gap: 60,
    marginBottom: 80,
  },
  leftColumn: {
    display: "flex",
    alignItems: "flex-start",
    flexDirection: "column",
    gap: 12,
  },
  imageContainer: {
    width: "100%",
    background: "#080808",
    borderRadius: 12,
    overflow: "hidden",
    padding: 20,
    aspectRatio: "4 / 5",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
  },
  productImage: {
    width: "100%",
    height: "100%",
    objectFit: "contain",
  },
  galleryRow: {
    display: "flex",
    gap: 10,
    flexWrap: "wrap",
  },
  thumbButton: {
    width: 70,
    height: 70,
    borderRadius: 8,
    border: "2px solid #d1d5db",
    overflow: "hidden",
    padding: 0,
    cursor: "pointer",
    background: "#080808",
    aspectRatio: "4 / 5",
  },
  thumbButtonActive: {
    border: "2px solid #1a1a1a",
  },
  thumbImage: {
    width: "100%",
    height: "100%",
    objectFit: "contain",
    objectPosition: "center",
    display: "block",
  },
  rightColumn: {
    paddingTop: 12,
    paddingBottom: 0,
  },
  headerSection: {
    marginBottom: 24,
  },
  headerMetaRow: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
    flexWrap: "wrap",
  },
  productTitle: {
    fontSize: 32,
    fontWeight: 900,
    color: "#f0ede8",
    marginBottom: 12,
    lineHeight: 1.2,
  },
  badge: {
    display: "inline-block",
    background: "#1a1a1a",
    color: "white",
    padding: "8px 16px",
    borderRadius: 20,
    fontSize: 12,
    fontWeight: 700,
  },
  ratingSection: {
    display: "flex",
    alignItems: "center",
    gap: 12,
    marginBottom: 24,
    paddingBottom: 24,
    borderBottom: "1px solid #e0e0e0",
  },
  ratingStars: {
    display: "flex",
    gap: 4,
  },
  ratingText: {
    fontSize: 14,
    color: "#666",
  },
  priceSection: {
    marginBottom: 20,
  },
  price: {
    fontSize: 36,
    fontWeight: 900,
    color: "#f0ede8",
    margin: 0,
    marginBottom: 8,
  },
  priceNote: {
    fontSize: 13,
    color: "#9ca3af",
    margin: 0,
    fontWeight: 600,
  },
  priceDescription: {
    margin: 0,
    color: "#d1d5db",
    fontSize: 14,
    lineHeight: 1.6,
  },
  shippingEstimator: {
    marginBottom: 28,
    padding: "16px 18px",
    borderRadius: 10,
    background: "#111111",
    border: "1px solid #2a2a2a",
  },
  shippingEstimatorTitle: {
    display: "block",
    color: "#f0ede8",
    fontSize: 14,
    fontWeight: 800,
    textTransform: "uppercase",
    letterSpacing: "0.4px",
  },
  shippingEstimatorHint: {
    margin: "5px 0 14px",
    color: "#c8c1ba",
    fontSize: 13,
    lineHeight: 1.45,
  },
  shippingInputRow: {
    display: "flex",
    gap: 10,
  },
  shippingInput: {
    flex: 1,
    minWidth: 0,
    padding: "11px 12px",
    border: "1px solid #3a3a3a",
    borderRadius: 8,
    color: "#f0ede8",
    background: "#080808",
    fontSize: 14,
  },
  shippingCalcButton: {
    border: "none",
    borderRadius: 8,
    padding: "11px 16px",
    background: "#f0ede8",
    color: "#111111",
    fontWeight: 800,
    fontSize: 13,
    cursor: "pointer",
  },
  shippingMessage: {
    margin: "12px 0 0",
    color: "#facc15",
    fontSize: 12,
    lineHeight: 1.45,
  },
  shippingResults: {
    display: "grid",
    gap: 8,
    marginTop: 12,
  },
  shippingResult: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
    padding: "10px 12px",
    background: "#080808",
    border: "1px solid #2a2a2a",
    borderRadius: 8,
    color: "#f0ede8",
    fontSize: 13,
  },
  shippingResultInfo: {
    display: "grid",
    gap: 3,
  },
  shippingResultDeadline: {
    color: "#c8c1ba",
    fontSize: 12,
  },
  trustPanel: {
    marginBottom: 28,
    padding: "18px 18px 16px",
    borderRadius: 10,
    background: "#111111",
    border: "1px solid #2a2a2a",
  },
  trustPanelTitle: {
    display: "block",
    fontSize: 14,
    fontWeight: 800,
    color: "#f0ede8",
    marginBottom: 10,
    textTransform: "uppercase",
    letterSpacing: "0.4px",
  },
  trustList: {
    margin: 0,
    paddingLeft: 18,
    color: "#d1d5db",
    fontSize: 13,
    lineHeight: 1.6,
  },
  trustListItem: {
    marginBottom: 4,
  },
  sectionBlock: {
    marginBottom: 22,
  },
  sectionTitle: {
    fontSize: 14,
    fontWeight: 700,
    color: "#f0ede8",
    marginBottom: 12,
    textTransform: "uppercase",
    letterSpacing: "0.5px",
  },
  colorGrid: {
    display: "flex",
    gap: 12,
    marginBottom: 12,
    flexWrap: "wrap",
  },
  colorOption: {
    width: 44,
    height: 44,
    borderRadius: 3,
    cursor: "pointer",
    transition: "border-color 0.18s ease, box-shadow 0.18s ease, transform 0.18s ease",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    flex: "0 0 auto",
  },
  colorCheckmark: {
    color: "#ffffff",
    fontSize: 24,
    fontWeight: "bold",
    textShadow: "0 0 4px rgba(0,0,0,0.5)",
    lineHeight: 1,
  },
  sizeGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(6, 1fr)",
    gap: 8,
    marginBottom: 12,
  },
  sizeOption: {
    padding: 12,
    minHeight: 48,
    border: "2px solid #333333",
    borderRadius: 3,
    cursor: "pointer",
    fontWeight: 900,
    fontSize: 14,
    transition: "border-color 0.18s ease, background 0.18s ease, color 0.18s ease, box-shadow 0.18s ease, transform 0.18s ease",
  },
  selectedLabel: {
    fontSize: 13,
    color: "#c8c1ba",
    margin: 0,
  },
  selectedValue: {
    color: "#ffffff",
    marginLeft: 4,
  },
  quantityControl: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    maxWidth: 176,
  },
  quantityBtn: {
    width: 44,
    height: 44,
    flexShrink: 0,
    border: "1px solid #444444",
    background: "#111111",
    color: "#f0ede8",
    borderRadius: 6,
    cursor: "pointer",
    fontSize: 18,
    fontWeight: 700,
    transition: "all 0.2s ease",
  },
  quantityInput: {
    flex: 1,
    minWidth: 0,
    height: 44,
    padding: 8,
    border: "1px solid #444444",
    borderRadius: 6,
    textAlign: "center",
    fontSize: 14,
    fontWeight: 700,
    background: "#111111",
    color: "#f0ede8",
  },
  actionButtons: {
    display: "flex",
    gap: 12,
    marginBottom: 32,
    position: "static",
    left: "auto",
    right: "auto",
    bottom: "auto",
    zIndex: 0,
    padding: 0,
    background: "transparent",
    borderTop: "none",
    boxShadow: "none",
  },
  addToCartBtn: {
    flex: 1,
    padding: "14px 24px",
    background: "linear-gradient(135deg, #1a1a1a 0%, #333333 100%)",
    color: "white",
    border: "none",
    borderRadius: 8,
    fontSize: 15,
    fontWeight: 700,
    cursor: "pointer",
    transition: "all 0.3s ease",
    boxShadow: "0 4px 12px rgba(26,26,26,0.2)",
  },
  buyNowBtn: {
    flex: 1,
    padding: "14px 24px",
    background: "#e8002a",
    color: "#ffffff",
    border: "1px solid #ff4966",
    borderRadius: 8,
    fontSize: 15,
    fontWeight: 800,
    cursor: "pointer",
    transition: "all 0.3s ease",
    boxShadow: "0 4px 12px rgba(232, 0, 42, 0.22)",
  },
  favoriteQuickBtn: {
    padding: "10px 14px",
    border: "1px solid #dc2626",
    borderRadius: 10,
    fontSize: 13,
    fontWeight: 700,
    cursor: "pointer",
    transition: "all 0.2s ease",
    whiteSpace: "nowrap",
  },
  selectionWarning: {
    margin: "-18px 0 24px 0",
    fontSize: 13,
    fontWeight: 600,
    color: "#dc2626",
  },
  supportBox: {
    marginBottom: 28,
    padding: "18px 18px 16px",
    borderRadius: 10,
    background: "#111111",
    color: "#f3f4f6",
  },
  supportTitle: {
    display: "block",
    fontSize: 15,
    fontWeight: 800,
    marginBottom: 8,
  },
  supportText: {
    margin: "0 0 12px 0",
    color: "#d1d5db",
    fontSize: 13,
    lineHeight: 1.6,
  },
  supportLink: {
    display: "inline-flex",
    alignItems: "center",
    color: "#ffffff",
    background: "transparent",
    textDecoration: "none",
    padding: "12px 0",
    textDecorationLine: "underline",
    textUnderlineOffset: 4,
    fontSize: 12,
    fontWeight: 700,
    letterSpacing: "0.4px",
  },
  descriptionSection: {
    paddingTop: 24,
    borderTop: "1px solid #e0e0e0",
  },
  description: {
    fontSize: 14,
    color: "#666",
    lineHeight: 1.6,
    margin: 0,
  },
  stockInfo: {
    margin: "0 0 28px",
    fontSize: 14,
    fontWeight: 700,
    color: "#f0ede8",
  },
  loadingText: {
    color: "#6b7280",
    fontSize: 16,
    margin: 0,
  },
};







