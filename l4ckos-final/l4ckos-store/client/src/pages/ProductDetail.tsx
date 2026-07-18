/**
 * Pagina ProductDetail - Detalhes completos do produto
 * Exibe informações completas, opções de customização e ações de compra.
 */

import { useParams, useNavigate, useLocation } from "react-router-dom";
import { Link } from "react-router-dom";
import { useCart } from "../contexts/CartContext";
import { useFavorites } from "../contexts/FavoritesContext";
import { useToast } from "../contexts/ToastContext";
import type { CSSProperties } from "react";
import { useMemo, useState, useEffect } from "react";
import { useIsMobile } from "../hooks/useIsMobile";
import { trpc } from "../lib/trpc";
import camisaFallback from "../images/camisa.png";
import { getCategoryLabel } from "../lib/productCategories";
import { resolveCatalogImageUrl, retryImageWithVersion } from "../lib/images";
import { apiUrl } from "../const";
import { csrfFetch } from "../lib/csrf";
import { trackStoreEvent } from "../lib/analytics";

const DEFAULT_COLORS = ["Preto", "Branco", "Azul", "Vermelho", "Verde"];
const DEFAULT_SIZES = ["PP", "P", "M", "G", "GG", "XG"];
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
  minDays: number;
  maxDays: number;
};

function sanitizeCep(value: string) {
  return value.replace(/\D/g, "").slice(0, 8);
}

function formatCep(value: string) {
  const digits = sanitizeCep(value);
  return digits.length > 5 ? `${digits.slice(0, 5)}-${digits.slice(5)}` : digits;
}

function normalizePrice(value: number) {
  return value / 100;
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
  const { addToCart, closeCartDrawer } = useCart();
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

  const productId = id ? parseInt(id) : null;
  const productQuery = trpc.products.getById.useQuery(productId ?? 0, {
    enabled: Boolean(productId),
  });
  const product = productQuery.data
    ? {
        id: productQuery.data.id,
        name: productQuery.data.name,
        description: productQuery.data.description || "",
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
      return <p style={styles.loadingText}>Carregando produto...</p>;
    }
    return (
      <div style={styles.errorContainer as CSSProperties}>
        <h1>Produto não encontrado</h1>
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
  const colorOptions = (product.optionColors?.length ? product.optionColors : DEFAULT_COLORS).map(name => ({
    name,
    hex: COLOR_HEX_BY_NAME[name.toLowerCase()] ?? "#d1d5db",
  }));
  const sizeOptions = product.optionSizes?.length ? product.optionSizes : DEFAULT_SIZES;
  const canAddToCart = Boolean(selectedColor && selectedSize && product.stock > 0);
  const missingSelections: string[] = [];
  const formattedPrice = new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
  }).format(product.price);
  if (!selectedColor) missingSelections.push("cor");
  if (!selectedSize) missingSelections.push("tamanho");

  const handleAddToCart = () => {
    if (product.stock <= 0) {
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

    addToCart(product, quantity, {
      cor: selectedColor,
      tamanho: selectedSize,
    });
    setShowSelectionWarning(false);
    setQuantity(1);
  };

  const handleBuyNow = () => {
    if (product.stock <= 0) {
      showToast({ message: "Este produto está indisponível no momento.", duration: 3500 });
      return;
    }

    if (!selectedColor || !selectedSize) {
      setShowSelectionWarning(true);
      showToast({ message: "Selecione cor e tamanho antes de comprar.", duration: 3500 });
      return;
    }

    addToCart(product, quantity, { cor: selectedColor, tamanho: selectedSize });
    setShowSelectionWarning(false);
    closeCartDrawer();
    navigate("/checkout");
  };

  const handleCalculateShipping = async () => {
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
      if (!response.ok) throw new Error(data.error || "Não foi possível calcular o frete.");

      setShippingOptions(data.options || []);
      setShippingError(data.warning || "");
      trackStoreEvent("shipping_quoted", { product_id: product.id, options_count: data.options?.length ?? 0 });
    } catch (error) {
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
    <div>
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

      <div
        style={{
          ...styles.container,
          gridTemplateColumns: isMobile ? "1fr" : styles.container.gridTemplateColumns,
          gap: isMobile ? 24 : styles.container.gap,
          marginBottom: isMobile ? 40 : styles.container.marginBottom,
        } as CSSProperties}
      >
        <div style={styles.leftColumn as CSSProperties}>
          <div
            className="l4-product-media-surface"
            style={{
              ...styles.imageContainer,
              padding: isMobile ? 12 : styles.imageContainer.padding,
              borderRadius: isMobile ? 16 : styles.imageContainer.borderRadius,
              aspectRatio: isMobile ? "1 / 1" : styles.imageContainer.aspectRatio,
              maxHeight: isMobile ? 560 : 720,
            } as CSSProperties}
          >
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

          <div
            style={{
              ...styles.galleryRow,
              flexWrap: isMobile ? "nowrap" : styles.galleryRow.flexWrap,
              overflowX: isMobile ? "auto" : "visible",
              paddingBottom: isMobile ? 6 : 0,
            } as CSSProperties}
          >
            {normalizedGalleryImages.map((image, idx) => {
              const active = (selectedImage || product.image) === image.imageUrl;
              return (
                <button
                  className="l4-product-media-surface l4-product-media-surface--thumb"
                  key={`${image.imageUrl}-${idx}`}
                  type="button"
                  onClick={() => setSelectedImage(image.imageUrl)}
                  style={{
                    ...styles.thumbButton,
                    width: isMobile ? 64 : styles.thumbButton.width,
                    height: isMobile ? 64 : styles.thumbButton.height,
                    flex: isMobile ? "0 0 auto" : undefined,
                    ...(active ? styles.thumbButtonActive : {}),
                  } as CSSProperties}
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
          </div>
        </div>

        <div
          style={{
            ...styles.rightColumn,
            paddingBottom: isMobile ? 120 : styles.rightColumn.paddingBottom,
          } as CSSProperties}
        >
          <div style={styles.headerSection as CSSProperties}>
            <h1 style={{ ...styles.productTitle, fontSize: isMobile ? 24 : styles.productTitle.fontSize } as CSSProperties}>{product.name}</h1>
            <div style={styles.headerMetaRow as CSSProperties}>
              <span style={styles.badge as CSSProperties}>{getCategoryLabel(product.category) || "Produto oficial"}</span>
                <button
                  onClick={handleAddToFavorites}
                  style={{
                    ...styles.favoriteQuickBtn,
                    width: isMobile ? "auto" : "auto",
                    minWidth: isMobile ? 140 : undefined,
                    justifyContent: "center",
                    background: isFav ? "#dc2626" : "#ffffff",
                    color: isFav ? "#ffffff" : "#dc2626",
                    borderColor: "#dc2626",
                    alignSelf: isMobile ? "flex-start" : "auto",
                  } as CSSProperties}
                >
                  {isFav ? "Nos favoritos" : "Favoritar"}
              </button>
            </div>
          </div>

          <div style={styles.priceSection as CSSProperties}>
            <h2 style={{ ...styles.price, fontSize: isMobile ? 30 : styles.price.fontSize } as CSSProperties}>{formattedPrice}</h2>
            {product.description ? <p style={styles.priceDescription as CSSProperties}>{product.description}</p> : null}
          </div>

          <div style={styles.shippingEstimator as CSSProperties}>
            <div>
              <strong style={styles.shippingEstimatorTitle as CSSProperties}>Calcule o frete</strong>
              <p style={styles.shippingEstimatorHint as CSSProperties}>Veja prazo e valor para o seu CEP antes de comprar.</p>
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
            {shippingError ? <p style={styles.shippingMessage as CSSProperties}>{shippingError}</p> : null}
            {shippingOptions.length > 0 ? (
              <div style={styles.shippingResults as CSSProperties}>
                {shippingOptions.map((option) => (
                  <div key={option.id} style={styles.shippingResult as CSSProperties}>
                    <div style={styles.shippingResultInfo as CSSProperties}>
                      <strong>{option.label}</strong>
                      <span style={styles.shippingResultDeadline as CSSProperties}>{option.minDays} a {option.maxDays} dias úteis</span>
                    </div>
                    <strong>{new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(option.price)}</strong>
                  </div>
                ))}
              </div>
            ) : null}
          </div>

          <div style={styles.trustPanel as CSSProperties}>
            <strong style={styles.trustPanelTitle as CSSProperties}>Compra com informação clara</strong>
            <ul style={styles.trustList as CSSProperties}>
              {purchaseHighlights.map(item => (
                <li key={item} style={styles.trustListItem as CSSProperties}>
                  {item}
                </li>
              ))}
            </ul>
          </div>

          <div style={styles.sectionBlock as CSSProperties}>
            <h3 style={styles.sectionTitle as CSSProperties}>Cores disponíveis</h3>
            <div style={styles.colorGrid as CSSProperties}>
              {colorOptions.map((color) => (
                (() => {
                  const isSelected = selectedColor === color.name;
                  const isLightColor = ["#ffffff", "#fff", "#f5f5f5", "#d1d5db"].includes(color.hex.toLowerCase());
                  return (
                    <button
                      key={color.name}
                      type="button"
                      onClick={() => { setSelectedColor(color.name); trackStoreEvent("product_option_selected", { product_id: product.id, option_type: "color" }); }}
                      aria-pressed={isSelected}
                      aria-label={`Selecionar cor ${color.name}`}
                      style={{
                        ...styles.colorOption,
                        background: color.hex,
                        border: isSelected
                          ? "3px solid #e8002a"
                          : "2px solid #4b5563",
                        boxShadow: isSelected
                          ? "0 0 0 4px rgba(232, 0, 42, 0.28), 0 0 0 7px rgba(240, 237, 232, 0.16)"
                          : "inset 0 0 0 1px rgba(255, 255, 255, 0.1)",
                        transform: isSelected ? "translateY(-2px) scale(1.04)" : "none",
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
              Selecionado: <strong style={selectedColor ? styles.selectedValue : undefined}>{selectedColor || "Nenhuma cor"}</strong>
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
                    boxShadow: selectedSize === size
                      ? "0 0 0 4px rgba(232, 0, 42, 0.22), inset 0 -2px 0 rgba(0,0,0,0.22)"
                      : "none",
                    transform: selectedSize === size ? "translateY(-2px)" : "none",
                  } as CSSProperties}
                >
                  {size}
                </button>
              ))}
            </div>
            <p style={styles.selectedLabel as CSSProperties}>
              Selecionado: <strong style={selectedSize ? styles.selectedValue : undefined}>{selectedSize || "Nenhum tamanho"}</strong>
            </p>
          </div>

          <div style={styles.sectionBlock as CSSProperties}>
            <h3 style={styles.sectionTitle as CSSProperties}>Quantidade</h3>
            <div style={styles.quantityControl as CSSProperties}>
              <button
                onClick={() => setQuantity(Math.max(1, quantity - 1))}
                style={styles.quantityBtn as CSSProperties}
                disabled={product.stock <= 0}
              >
                -
              </button>
              <input
                type="number"
                min="1"
                 max={product.stock > 0 ? product.stock : 1}
                value={quantity}
                 onChange={(e) =>
                   setQuantity(
                     Math.min(product.stock > 0 ? product.stock : 1, Math.max(1, parseInt(e.target.value) || 1))
                   )
                 }
                style={styles.quantityInput as CSSProperties}
              />
              <button
                onClick={() => setQuantity(Math.min(product.stock > 0 ? product.stock : 1, quantity + 1))}
                style={styles.quantityBtn as CSSProperties}
                disabled={product.stock <= 0}
              >
                +
              </button>
            </div>
          </div>

          <div
            style={{
              ...styles.actionButtons,
              flexDirection: "row",
              position: "static",
              left: "auto",
              right: "auto",
              bottom: "auto",
              zIndex: 0,
              marginBottom: isMobile ? 20 : styles.actionButtons.marginBottom,
              padding: isMobile ? "0" : 0,
              background: isMobile ? "#080808" : "transparent",
              borderTop: "none",
              boxShadow: "none",
              borderRadius: isMobile ? 0 : undefined,
            } as CSSProperties}
          >
            <button
              onClick={handleBuyNow}
              style={styles.buyNowBtn as CSSProperties}
              disabled={product.stock <= 0}
              onMouseEnter={(e) => {
                if (product.stock <= 0) return;
                const btn = e.currentTarget as HTMLElement;
                btn.style.transform = "scale(1.02)";
                btn.style.boxShadow = "0 12px 24px rgba(26,26,26,0.3)";
              }}
              onMouseLeave={(e) => {
                if (product.stock <= 0) return;
                const btn = e.currentTarget as HTMLElement;
                btn.style.transform = "scale(1)";
                btn.style.boxShadow = "0 4px 12px rgba(26,26,26,0.2)";
              }}
            >
              {product.stock > 0 ? "Comprar agora" : "Indisponível"}
            </button>
            <button
              onClick={handleAddToCart}
              style={styles.addToCartBtn as CSSProperties}
              disabled={product.stock <= 0}
            >
              Adicionar à sacola
            </button>
          </div>

          {showSelectionWarning && !canAddToCart && (
            <p style={styles.selectionWarning as CSSProperties}>
              Selecione {missingSelections.join(" e ")} antes de continuar.
            </p>
          )}

          <div style={styles.supportBox as CSSProperties}>
            <strong style={styles.supportTitle as CSSProperties}>Ainda em dúvida?</strong>
            <p style={styles.supportText as CSSProperties}>
              Se quiser confirmar tamanho, disponibilidade ou detalhes do item antes de comprar, fale com a loja.
            </p>
            <Link to="/contato" style={styles.supportLink as CSSProperties}>
              Tirar dúvida antes de comprar
            </Link>
          </div>

          {product.stock >= 0 && (
            <div style={styles.stockInfo as CSSProperties}>
              <span style={{
                color: product.stock > 5 ? "#86efac" : product.stock > 0 ? "#facc15" : "#f87171"
              }}>
                {product.stock > 5
                  ? "Disponível para compra"
                  : product.stock > 0
                    ? "Estoque reduzido"
                    : "Indisponível no momento"}
              </span>
            </div>
          )}
        </div>
      </div>
    </div>
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
    marginBottom: 28,
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
    width: 52,
    height: 52,
    borderRadius: 8,
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
    borderRadius: 8,
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
    background: "rgba(232, 0, 42, 0.18)",
    border: "1px solid rgba(232, 0, 42, 0.42)",
    borderRadius: 6,
    padding: "3px 7px",
    marginLeft: 4,
  },
  quantityControl: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    maxWidth: 140,
  },
  quantityBtn: {
    width: 40,
    height: 40,
    border: "2px solid #e0e0e0",
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
    padding: 8,
    border: "2px solid #e0e0e0",
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
    background: "#dc2626",
    textDecoration: "none",
    padding: "10px 14px",
    borderRadius: 8,
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
    marginTop: 16,
    padding: 12,
    background: "#111111",
    border: "1px solid #2a2a2a",
    borderRadius: 10,
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







