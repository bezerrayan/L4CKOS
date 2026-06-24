import { Link, useNavigate } from "react-router-dom";
import { useMemo } from "react";
import { trpc } from "../lib/trpc";
import { getCategoryLabel } from "../lib/productCategories";
import { resolveCatalogImageUrl, retryImageWithVersion } from "../lib/images";
import "./Home.css";
import camisaFallback from "../images/camisa.png";
import PromoCarousel from "../components/PromoCarousel";

type ProductItem = {
  id: number;
  name: string;
  priceCents: number;
  imageUrl: string;
  category?: string | null;
};

const productBgClasses = [
  "l4-home-prod-img-1",
  "l4-home-prod-img-2",
  "l4-home-prod-img-3",
  "l4-home-prod-img-4",
  "l4-home-prod-img-5",
  "l4-home-prod-img-6",
  "l4-home-prod-img-7",
  "l4-home-prod-img-8",
];

const trustHighlights = [
  {
    title: "Compra com mais clareza",
    text: "Preço, frete e prazo aparecem no fluxo de compra, sem promessa solta e sem surpresa desnecessária.",
  },
  {
    title: "Curadoria focada",
    text: "A vitrine prioriza itens com perfil urbano, outdoor e de uso real para quem quer comprar com propósito.",
  },
  {
    title: "Atendimento direto",
    text: "Quando precisar de suporte, o cliente encontra canais claros para contato e acompanhamento do pedido.",
  },
];

const homeCategories = [
  { value: "camping", label: "CAMPING", className: "l4-home-cat l4-home-cat-large l4-home-cat-1" },
  { value: "uniformes", label: "UNIFORMES", className: "l4-home-cat l4-home-cat-2" },
  { value: "trilha", label: "TRILHA", className: "l4-home-cat l4-home-cat-3" },
  { value: "acessorios", label: "ACESSÓRIOS", className: "l4-home-cat l4-home-cat-4" },
  { value: "mochilas", label: "MOCHILAS", className: "l4-home-cat l4-home-cat-5" },
];

function formatCurrency(cents: number) {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format((cents || 0) / 100);
}

function resolveProductImageUrl(raw: string | null | undefined) {
  const value = (raw || "").trim();
  if (!value) return "";
  return resolveCatalogImageUrl(value);
}

export default function Home() {
  const navigate = useNavigate();
  const productsQuery = trpc.products.list.useQuery({ limit: 12 });

  const products = useMemo<ProductItem[]>(
    () =>
      (productsQuery.data ?? []).slice(0, 8).map(item => ({
        id: item.id,
        name: item.name,
        priceCents: Number(item.price ?? 0),
        imageUrl: resolveProductImageUrl(item.imageUrl),
        category: item.category,
      })),
    [productsQuery.data],
  );

  return (
    <div className="l4-home">
      <div className="l4-home-announce">
        <span className="l4-home-announce-track">
          PAGAMENTO SEGURO - CONSULTE FRETE E PRAZO NO CHECKOUT - NOVOS ITENS EM DESTAQUE - ATENDIMENTO PELOS CANAIS OFICIAIS
          - PAGAMENTO SEGURO - CONSULTE FRETE E PRAZO NO CHECKOUT - NOVOS ITENS EM DESTAQUE - ATENDIMENTO PELOS CANAIS OFICIAIS
        </span>
      </div>

      <section className="l4-home-hero">
        <div className="l4-home-hero-grid" />
        <div className="l4-home-hero-bg" />
        <div className="l4-home-hero-content">
          <div className="l4-home-tag">Drop 01 - Disponível agora</div>
          <h1 className="l4-home-title">
            <span>BEM-VINDO</span>
            <br />
            <span className="outline">A NOSSA</span>
            <br />
            <span className="accent">LOJA</span>
          </h1>
          <p className="l4-home-subtitle">
            Peças e equipamentos selecionados para quem vive trilha, campo, rotina urbana e movimento outdoor com identidade.
          </p>
          <div className="l4-home-hero-cta">
            <Link to="/produtos" className="l4-btn-primary">
              Explorar catálogo
            </Link>
            <a href="#l4-products" className="l4-btn-outline">
              Ver destaques
            </a>
          </div>
        </div>
        <PromoCarousel />
      </section>

      <div className="l4-home-marquee">
        <div className="l4-home-marquee-track">
          <span>OUTDOOR</span>
          <span>L4CKOS</span>
          <span>NOVAS PEÇAS</span>
          <span>EQUIPAMENTOS</span>
          <span>ESCOTISMO</span>
          <span>OUTDOOR</span>
          <span>L4CKOS</span>
          <span>NOVAS PEÇAS</span>
          <span>EQUIPAMENTOS</span>
          <span>ESCOTISMO</span>
        </div>
      </div>

      <section className="l4-home-section">
        <div className="l4-home-section-header">
          <div>
            <div className="l4-home-section-tag">// Explorar</div>
            <h2 className="l4-home-section-title">CATEGORIAS</h2>
          </div>
          <Link className="l4-home-view-all" to="/produtos">
            Ver todas
          </Link>
        </div>
        <div className="l4-home-categories-grid">
          {homeCategories.map(category => (
            <Link key={category.value} className={category.className} to={`/categorias/${category.value}`}>
              <span className="l4-home-cat-name">{category.label}</span>
            </Link>
          ))}
        </div>
      </section>

      <section id="l4-products" className="l4-home-section l4-home-products-wrap">
        <div className="l4-home-section-header">
          <div>
            <div className="l4-home-section-tag">// Destaque</div>
            <h2 className="l4-home-section-title">MAIS VISTOS</h2>
          </div>
          <Link className="l4-home-view-all" to="/produtos">
            Ver todos
          </Link>
        </div>
        <div className="l4-home-products-grid">
          {products.map((product, idx) => (
            <article
              key={product.id}
              className="l4-home-product-card"
              role="button"
              tabIndex={0}
              onClick={() => navigate(`/produto/${product.id}`)}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  navigate(`/produto/${product.id}`);
                }
              }}
            >
              <div className={`l4-home-product-img ${productBgClasses[idx % productBgClasses.length]}`}>
                {product.imageUrl ? (
                  <img
                    src={product.imageUrl}
                    alt={product.name}
                    loading={idx < 4 ? "eager" : "lazy"}
                    decoding="async"
                    onError={(event) => {
                      retryImageWithVersion(event, product.imageUrl, camisaFallback, product.id);
                    }}
                  />
                ) : (
                  <img src={camisaFallback} alt={product.name} loading="lazy" />
                )}
              </div>
              <div className="l4-home-product-info">
                <h3 className="l4-home-product-name">{product.name}</h3>
                <p className="l4-home-product-category">{getCategoryLabel(product.category)}</p>
                <div className="l4-home-product-meta">
                  <span>{formatCurrency(product.priceCents)}</span>
                  <span className="l4-home-product-link">ver detalhes</span>
                </div>
              </div>
            </article>
          ))}
        </div>
      </section>

      <section className="l4-home-section">
        <div className="l4-home-section-header">
          <div>
            <div className="l4-home-section-tag">// Confiança</div>
            <h2 className="l4-home-section-title">POR QUE COMPRAR</h2>
          </div>
        </div>
        <div className="l4-home-testimonials-grid">
          {trustHighlights.map(item => (
            <article key={item.title} className="l4-home-testimonial">
              <div className="l4-home-testimonial-quote">+</div>
              <strong className="l4-home-trust-title">{item.title}</strong>
              <p>{item.text}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="l4-home-newsletter">
        <div>
          <h3>FIQUE POR DENTRO</h3>
          <p>Receba novidades, reposições e comunicações oficiais da loja em primeira mão.</p>
        </div>
        <Link to="/contato" className="l4-btn-primary">
          Tirar dúvidas
        </Link>
      </section>
    </div>
  );
}
