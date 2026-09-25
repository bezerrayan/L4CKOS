/**
 * Página de produtos.
 */

import { useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { PackageOpen, Search, SearchX, X } from "lucide-react";
import ProductCard from "../components/ProductCard";
import EmptyState from "../components/EmptyState";
import type { Product } from "../types/product";
import { trpc } from "../lib/trpc";
import { getCategoryLabel, normalizeCategoryValue } from "../lib/productCategories";
import { resolveCatalogImageUrl } from "../lib/images";
import camisaFallback from "../images/camisa.png";
import "./Produtos.css";

function normalizePrice(value: number) {
  return value / 100;
}

function resolveProductImageUrl(imageUrl?: string | null) {
  if (!imageUrl) return camisaFallback;
  return resolveCatalogImageUrl(imageUrl) || camisaFallback;
}

export default function Produtos() {
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
        imageThumbnailUrl: resolveProductImageUrl((item as any).imageThumbnailUrl || item.imageUrl),
        imageDetailUrl: resolveProductImageUrl((item as any).imageDetailUrl || item.imageUrl),
        imageBannerUrl: resolveProductImageUrl((item as any).imageBannerUrl || item.imageUrl),
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
      return [item.name, item.description, getCategoryLabel(item.category), item.category]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .includes(normalizedSearch);
    });
  }, [produtosBrutos, searchTerm, selectedCategory]);

  const activeCategoryLabel = selectedCategory ? getCategoryLabel(selectedCategory) : "";
  const hasCatalog = produtosBrutos.length > 0;
  const showFilters = availableCategories.length > 1;
  const showSearch = hasCatalog;
  const resultLabel = searchTerm
    ? `Mostrando ${produtos.length} resultado(s) para “${searchTerm}”`
    : activeCategoryLabel
      ? `Exibindo ${produtos.length} produto(s) em ${activeCategoryLabel}`
      : `Exibindo ${produtos.length} produtos disponíveis`;

  return (
    <main className="l4-products-page">
      <header className="l4-products-page__header">
        <span className="l4-products-page__eyebrow">CATÁLOGO L4CKOS</span>
        <h1>Produtos</h1>
        <p>
          {activeCategoryLabel
            ? `Você está vendo produtos em ${activeCategoryLabel}.`
            : "Explore as peças disponíveis da L4CKOS, criadas para identidade urbana, movimento e espírito de aventura."}
        </p>
      </header>

      {activeCategoryLabel ? (
        <section className="l4-products-category-hero">
          <span className="l4-products-category-hero__tag">Categoria selecionada</span>
          <h2>{activeCategoryLabel}</h2>
          <p>Veja as peças publicadas nesta categoria. As opções exibidas são atualizadas conforme o catálogo real.</p>
        </section>
      ) : null}

      {showFilters ? (
        <nav className="l4-products-category-bar" aria-label="Categorias de produtos">
          <button type="button" className={`l4-products-category-chip ${!selectedCategory ? "is-active" : ""}`} onClick={() => navigate("/produtos")}>
            Todos
          </button>
          {availableCategories.map(category => (
            <button
              key={category.value}
              type="button"
              className={`l4-products-category-chip ${selectedCategory === category.value ? "is-active" : ""}`}
              onClick={() => navigate(`/categorias/${category.value}`)}
            >
              {category.label}<span aria-hidden="true">{category.count}</span>
            </button>
          ))}
        </nav>
      ) : null}

      {showSearch ? (
        <div className="l4-products-search">
          <Search aria-hidden="true" size={18} />
          <input type="search" placeholder="Buscar por produto ou categoria..." value={searchTerm} onChange={(event) => setSearchTerm(event.target.value)} aria-label="Buscar produtos" />
          {searchTerm ? <button type="button" onClick={() => setSearchTerm("")} aria-label="Limpar busca"><X aria-hidden="true" size={17} /></button> : null}
        </div>
      ) : null}

      {productsQuery.isLoading ? <p className="l4-products-status">Carregando produtos...</p> : null}
      {productsQuery.isError ? <p className="l4-products-status">Não foi possível carregar os produtos agora.</p> : null}

      {!productsQuery.isLoading && produtos.length > 0 ? (
        <section className="l4-products-results" aria-label="Produtos disponíveis">
          <p className="l4-products-results__count">{resultLabel}</p>
          <div className="l4-products-grid">
            {produtos.map((produto, idx) => (
              <div key={produto.id} className="l4-products-grid__item" style={{ animationDelay: `${idx * 50}ms` }}>
                <ProductCard product={produto} />
              </div>
            ))}
          </div>
        </section>
      ) : !productsQuery.isLoading && !hasCatalog ? (
        <EmptyState icon={PackageOpen} title="NOVAS PEÇAS EM PREPARAÇÃO" text="O catálogo da L4CKOS está sendo preparado. Acompanhe os canais oficiais para conhecer os próximos lançamentos." action={{ label: "ENTRAR NA LISTA", to: "/em-breve" }} />
      ) : !productsQuery.isLoading ? (
        <EmptyState icon={SearchX} title="NENHUM PRODUTO ENCONTRADO" text="Não encontramos peças correspondentes à sua busca." action={{ label: "LIMPAR FILTROS", onClick: () => setSearchTerm("") }} secondaryAction={{ label: "VER TODOS OS PRODUTOS", to: "/produtos" }} />
      ) : null}
    </main>
  );
}
