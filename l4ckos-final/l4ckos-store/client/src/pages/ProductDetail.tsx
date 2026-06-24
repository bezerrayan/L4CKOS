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

const DEFAULT_COLORS = ["Preto", "Branco", "Azul", "Vermelho", "Verde"];
const DEFAULT_SIZES = ["PP", "P", "M", "G", "GG", "XG"];
const COLOR_HEX_BY_NAME: Record<string, string> = {
  preto: "#1a1a1a",
  branco: "#ffffff",
  azul: "#1e40af",
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
  const { addToCart } = useCart();
  const { addToFavorites, removeFromFavorites, isFavorited } = useFavorites();
  const { showToast } = useToast();

  const [selectedColor, setSelectedColor] = useState<string | null>(null);
  const [selectedSize, setSelectedSize] = useState<string | null>(null);
  const [quantity, setQuantity] = useState(1);
  const [showSelectionWarning, setShowSelectionWarning] = useState(false);
  const [selectedImage, setSelectedImage] = useState<string | null>(null);

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
        image: resolveProductImageUrl(productQuery.data.imageUrl),
        category: productQuery.data.category,
        stock: Number(productQuery.data.stock ?? 0),
        optionColors: parseJsonList((productQuery.data as any).optionColors),
        optionSizes: parseJsonList((productQuery.data as any).optionSizes),
        sizeType: String((productQuery.data as any).sizeType ?? "alpha"),
        images:
          Array.isArray((productQuery.data as any).images) && (productQuery.data as any).images.length > 0
            ? ((productQuery.data as any).images as Array<any>).map((img) => ({
                imageUrl: resolveProductImageUrl(typeof img === "string" ? img : img?.imageUrl),
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
    const matches = galleryImages.filter(
      item => normalizeColorToken(item.color) === normalizeColorToken(selectedColor),
    );
    return matches.length > 0 ? matches : galleryImages;
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
    showToast({
      message: `${product.name} adicionado à sacola (${quantity}x).`,
      actionLabel: "Ver sacola",
      action: () => navigate("/carrinho"),
      duration: 4500,
    });
    setShowSelectionWarning(false);
    setQuantity(1);
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
            style={{
              ...styles.imageContainer,
              padding: isMobile ? 12 : styles.imageContainer.padding,
              borderRadius: isMobile ? 16 : styles.imageContainer.borderRadius,
            } as CSSProperties}
          >
            <img
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
                    src={image.imageUrl}
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
            <p style={styles.priceNote as CSSProperties}>
              Frete e prazo calculados no checkout, conforme CEP e disponibilidade.
            </p>
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
                <button
                  key={color.name}
                  onClick={() => setSelectedColor(color.name)}
                  style={{
                    ...styles.colorOption,
                    background: color.hex,
                    border: selectedColor === color.name
                      ? "3px solid #1a1a1a"
                      : "2px solid #e0e0e0",
                  } as CSSProperties}
                  title={color.name}
                >
                  {selectedColor === color.name && (
                    <span style={styles.colorCheckmark as CSSProperties}>✓</span>
                  )}
                </button>
              ))}
            </div>
            <p style={styles.selectedLabel as CSSProperties}>
              Selecionado: <strong>{selectedColor || "Nenhuma cor"}</strong>
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
                  onClick={() => setSelectedSize(size)}
                  style={{
                    ...styles.sizeOption,
                    background: selectedSize === size ? "#1a1a1a" : "white",
                    color: selectedSize === size ? "white" : "#1a1a1a",
                  } as CSSProperties}
                >
                  {size}
                </button>
              ))}
            </div>
            <p style={styles.selectedLabel as CSSProperties}>
              Selecionado: <strong>{selectedSize || "Nenhum tamanho"}</strong>
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
              onClick={handleAddToCart}
              style={styles.addToCartBtn as CSSProperties}
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
              {product.stock > 0 ? "Adicionar à sacola" : "Indisponível"}
            </button>
          </div>

          {showSelectionWarning && !canAddToCart && (
            <p style={styles.selectionWarning as CSSProperties}>
              Selecione {missingSelections.join(" e ")} antes de adicionar à sacola.
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

          <div style={styles.descriptionSection as CSSProperties}>
            <h3 style={styles.sectionTitle as CSSProperties}>Descrição do produto</h3>
            <p style={styles.description as CSSProperties}>
              {product.description}
            </p>
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
    background: "#f5f5f5",
    borderRadius: 12,
    overflow: "hidden",
    padding: 20,
    aspectRatio: "1",
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
    background: "#ffffff",
  },
  thumbButtonActive: {
    border: "2px solid #1a1a1a",
  },
  thumbImage: {
    width: "100%",
    height: "100%",
    objectFit: "cover",
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
    marginBottom: 32,
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
    width: 48,
    height: 48,
    borderRadius: 8,
    cursor: "pointer",
    transition: "all 0.2s ease",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
  },
  colorCheckmark: {
    color: "#ffffff",
    fontSize: 20,
    fontWeight: "bold",
    textShadow: "0 0 4px rgba(0,0,0,0.5)",
  },
  sizeGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(6, 1fr)",
    gap: 8,
    marginBottom: 12,
  },
  sizeOption: {
    padding: 12,
    border: "2px solid #e0e0e0",
    borderRadius: 8,
    cursor: "pointer",
    fontWeight: 700,
    fontSize: 13,
    transition: "all 0.2s ease",
  },
  selectedLabel: {
    fontSize: 13,
    color: "#9ca3af",
    margin: 0,
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







