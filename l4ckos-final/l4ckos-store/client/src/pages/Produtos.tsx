/**
 * Página de produtos.
 */

import { useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import type { CSSProperties } from "react";
import { PackageOpen, SearchX } from "lucide-react";
import ProductCard from "../components/ProductCard";
import EmptyState from "../components/EmptyState";
import type { Product } from "../types/product";
import { useIsMobile } from "../hooks/useIsMobile";
import { trpc } from "../lib/trpc";
import { getCategoryLabel, normalizeCategoryValue } from "../lib/productCategories";
import { resolveCatalogImageUrl } from "../lib/images";
import camisaFallback from "../images/camisa.png";

function normalizePrice(value: number) {
  return value / 100;
}

function resolveProductImageUrl(imageUrl?: string | null) {
  if (!imageUrl) return camisaFallback;
  return resolveCatalogImageUrl(imageUrl) || camisaFallback;
}

export default function Produtos() {
  const isMobile = useIsMobile();
  const navigate = useNavigate();
  const { categorySlug } = useParams<{ categorySlug?: string }>();
  const [searchTerm, setSearchTerm] = useState("");
  const selectedCategory = normalizeCategoryValue(categorySlug);

  const productsQuery = trpc.products.list.useQuery({ limit: 200 });

  const produtosBrutos: Product[] = useMemo(
    () =>
      (productsQuery.data ?? []).map(item => ({
        id: item.id,
        name: item.name,
        description: item.description || "",
        price: normalizePrice(Number(item.price)),
        image: resolveProductImageUrl((item as any).imageThumbnailUrl || item.imageUrl),
        imageThumbnail: resolveProductImageUrl((item as any).imageThumbnailUrl || item.imageUrl),
        imageDetail: resolveProductImageUrl((item as any).imageDetailUrl || item.imageUrl),
        imageBanner: resolveProductImageUrl((item as any).imageBannerUrl || item.imageUrl),
        category: item.category,
        stock: Number(item.stock ?? 0),
      })),
    [productsQuery.data],
  );

  const availableCategories = useMemo(() => {
    const categoryMap = new Map<string, { label: string; count: number }>();
    for (const product of produtosBrutos) {
      const normalized = normalizeCategoryValue(product.category);
      if (!normalized) continue;
      const current = categoryMap.get(normalized);
      categoryMap.set(normalized, {
        label: current?.label || getCategoryLabel(product.category),
        count: (current?.count || 0) + 1,
      });
    }
    return Array.from(categoryMap.entries()).map(([value, meta]) => ({ value, label: meta.label, count: meta.count }));
  }, [produtosBrutos]);

  const produtos = useMemo(() => {
    const normalizedSearch = searchTerm.trim().toLowerCase();
    return produtosBrutos.filter(item => {
      const matchesCategory = selectedCategory ? normalizeCategoryValue(item.category) === selectedCategory : true;
      if (!matchesCategory) return false;
      if (!normalizedSearch) return true;
      const haystack = [item.name, item.description, getCategoryLabel(item.category), item.category]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return haystack.includes(normalizedSearch);
    });
  }, [produtosBrutos, searchTerm, selectedCategory]);

  const activeCategoryLabel = selectedCategory ? getCategoryLabel(selectedCategory) : "";
  const hasCatalog = produtosBrutos.length > 0;
  const showFilters = availableCategories.length > 1;
  const showSearch = hasCatalog;

  return (
    <div>
      <div
        style={{
          ...styles.header,
          marginBottom: isMobile ? 28 : styles.header.marginBottom,
          paddingBottom: isMobile ? 20 : styles.header.paddingBottom,
        }}
      >
        <div>
          <h1 style={{ ...styles.title, fontSize: isMobile ? 30 : styles.title.fontSize }}>Produtos</h1>
          <p style={{ ...styles.subtitle, fontSize: isMobile ? 15 : styles.subtitle.fontSize }}>
            {activeCategoryLabel
              ? `Você está vendo produtos em ${activeCategoryLabel}.`
              : "Explore as peças disponíveis da L4CKOS, criadas para identidade urbana, movimento e espírito de aventura."}
          </p>
        </div>
      </div>

      {activeCategoryLabel ? (
        <section style={styles.categoryHero}>
          <div style={styles.categoryHeroTag}>Categoria selecionada</div>
          <h2 style={styles.categoryHeroTitle}>{activeCategoryLabel}</h2>
          <p style={styles.categoryHeroText}>
            Veja as peças publicadas nesta categoria. As opções exibidas são atualizadas conforme o catálogo real.
          </p>
        </section>
      ) : null}

      {showFilters ? (
        <div style={{ ...styles.categoryBar, gap: isMobile ? 8 : styles.categoryBar.gap }}>
          <button
            type="button"
            style={{
              ...styles.categoryChip,
              ...(!selectedCategory ? styles.categoryChipActive : {}),
            }}
            onClick={() => navigate("/produtos")}
          >
            Todos
          </button>
          {availableCategories.map(category => (
            <button
              key={category.value}
              type="button"
              style={{
                ...styles.categoryChip,
                ...(selectedCategory === category.value ? styles.categoryChipActive : {}),
              }}
              onClick={() => navigate(`/categorias/${category.value}`)}
            >
              {category.label}
            </button>
          ))}
        </div>
      ) : null}

      {showSearch ? (
        <div style={{ ...styles.searchContainer, marginBottom: isMobile ? 30 : styles.searchContainer.marginBottom }}>
          <input
            type="search"
            placeholder="Buscar por produto ou categoria..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            style={styles.searchInput as CSSProperties}
            aria-label="Buscar produtos"
          />
          {searchTerm ? (
            <button onClick={() => setSearchTerm("")} style={styles.clearButton as CSSProperties} aria-label="Limpar busca">
              ×
            </button>
          ) : null}
        </div>
      ) : null}

      {productsQuery.isLoading ? <p style={styles.resultInfo}>Carregando produtos...</p> : null}
      {productsQuery.isError ? <p style={styles.resultInfo}>Não foi possível carregar os produtos agora.</p> : null}

      {!productsQuery.isLoading && produtos.length > 0 ? (
        <div>
          <div style={styles.resultInfo}>
            <p>
              {searchTerm
                ? `Mostrando ${produtos.length} resultado(s) para "${searchTerm}"`
                : activeCategoryLabel
                  ? `Exibindo ${produtos.length} produto(s) em ${activeCategoryLabel}`
                  : `Exibindo ${produtos.length} produtos disponíveis`}
            </p>
          </div>

          <div
            style={{
              ...styles.productsGrid,
              gridTemplateColumns: isMobile ? "1fr" : styles.productsGrid.gridTemplateColumns,
              gap: isMobile ? 16 : styles.productsGrid.gap,
            }}
          >
            {produtos.map((produto, idx) => (
              <div
                key={produto.id}
                style={{
                  animation: `fadeInUp 0.5s ease-out ${idx * 50}ms backwards`,
                }}
              >
                <ProductCard product={produto} />
              </div>
            ))}
          </div>
        </div>
      ) : !productsQuery.isLoading && !hasCatalog ? (
        <EmptyState
          icon={PackageOpen}
          title="NOVAS PEÇAS EM PREPARAÇÃO"
          text="O catálogo da L4CKOS está sendo preparado. Acompanhe os canais oficiais para conhecer os próximos lançamentos."
          action={{ label: "ENTRAR NA LISTA", to: "/em-breve" }}
        />
      ) : !productsQuery.isLoading ? (
        <EmptyState
          icon={SearchX}
          title="NENHUM PRODUTO ENCONTRADO"
          text="Não encontramos peças correspondentes à sua busca."
          action={{ label: "LIMPAR FILTROS", onClick: () => setSearchTerm("") }}
          secondaryAction={{ label: "VER TODOS OS PRODUTOS", to: "/produtos" }}
        />
      ) : null}
    </div>
  );
}

const styles: Record<string, CSSProperties> = {
  header: {
    marginBottom: 48,
    paddingBottom: 24,
    borderBottom: "1px solid #262626",
  },
  title: {
    fontSize: 40,
    fontWeight: 900,
    color: "#f0ede8",
    marginBottom: 12,
  },
  subtitle: {
    fontSize: 18,
    color: "#9ca3af",
    margin: 0,
  },
  categoryBar: {
    display: "flex",
    gap: 10,
    flexWrap: "wrap",
    marginBottom: 28,
  },
  categoryHero: {
    border: "1px solid #252525",
    background: "linear-gradient(135deg, rgba(24,24,24,0.98) 0%, rgba(53,5,15,0.92) 100%)",
    borderRadius: 18,
    padding: "26px 24px",
    marginBottom: 28,
  },
  categoryHeroTag: {
    display: "inline-flex",
    padding: "6px 10px",
    border: "1px solid #6b1d2a",
    color: "#f0ede8",
    fontSize: 10,
    letterSpacing: 2,
    textTransform: "uppercase",
    fontFamily: '"Space Mono", monospace',
    marginBottom: 14,
  },
  categoryHeroTitle: {
    margin: "0 0 10px 0",
    color: "#f0ede8",
    fontSize: 32,
    lineHeight: 1.05,
    fontWeight: 900,
  },
  categoryHeroText: {
    margin: 0,
    color: "#d1d5db",
    maxWidth: 760,
    fontSize: 15,
    lineHeight: 1.7,
  },
  categoryChip: {
    border: "1px solid #2f2f2f",
    borderRadius: 999,
    padding: "10px 14px",
    fontSize: 13,
    fontWeight: 700,
    background: "#111111",
    color: "#d1d5db",
    cursor: "pointer",
  },
  categoryChipActive: {
    background: "#f0ede8",
    color: "#111111",
    border: "1px solid #f0ede8",
  },
  searchContainer: {
    position: "relative",
    maxWidth: 500,
    marginBottom: 48,
  },
  searchInput: {
    width: "100%",
    padding: "14px 20px",
    border: "1px solid #2f2f2f",
    borderRadius: 10,
    fontSize: 16,
    transition: "all 0.3s ease",
    backgroundColor: "#111111",
    color: "#f0ede8",
    boxShadow: "none",
  },
  clearButton: {
    position: "absolute",
    right: 16,
    top: "50%",
    transform: "translateY(-50%)",
    border: "none",
    fontSize: 18,
    cursor: "pointer",
    color: "#6b7280",
    background: "transparent",
    padding: 0,
    width: 24,
    height: 24,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    transition: "color 0.2s ease",
  },
  resultInfo: {
    marginBottom: 24,
    color: "#9ca3af",
    fontSize: 14,
  },
  productsGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))",
    gap: 32,
    marginBottom: 60,
  },
  emptyState: {
    textAlign: "center",
    padding: "80px 20px",
    backgroundColor: "#111111",
    border: "1px solid #2a2a2a",
    borderRadius: 16,
    marginBottom: 40,
  },
  emptyIcon: {
    fontSize: 64,
    marginBottom: 20,
  },
  emptyTitle: {
    fontSize: 24,
    fontWeight: 700,
    color: "#f0ede8",
    marginBottom: 12,
  },
  emptyText: {
    color: "#9ca3af",
    marginBottom: 24,
  },
  emptyActions: {
    display: "flex",
    gap: 12,
    justifyContent: "center",
    flexWrap: "wrap",
  },
  emptyButton: {
    padding: "12px 24px",
    background: "linear-gradient(135deg, #1a1a1a 0%, #333333 100%)",
    color: "white",
    border: "none",
    borderRadius: 8,
    fontWeight: 700,
    cursor: "pointer",
    transition: "all 0.3s ease",
    fontSize: 16,
  },
  emptyButtonSecondary: {
    padding: "12px 24px",
    background: "transparent",
    color: "#f0ede8",
    border: "1px solid #3a3a3a",
    borderRadius: 8,
    fontWeight: 700,
    cursor: "pointer",
    transition: "all 0.3s ease",
    fontSize: 16,
  },
};
