import { Link, useNavigate } from "react-router-dom";
import { FormEvent, useEffect, useMemo, useState } from "react";
import { trpc } from "../lib/trpc";
import { getCategoryLabel } from "../lib/productCategories";
import { resolveCatalogImageUrl, retryImageWithVersion } from "../lib/images";
import { apiUrl } from "../const";
import { csrfFetch } from "../lib/csrf";
import PromoCarousel from "../components/PromoCarousel";
import "./Home.css";
import camisaFallback from "../images/camisa.png";

type ProductItem = {
  id: number;
  name: string;
  priceCents: number;
  imageUrl: string;
  imageThumbnailUrl?: string;
  category?: string | null;
};

type TrustHighlight = {
  number: string;
  title: string;
  text: string;
  linkTo?: string;
  linkLabel?: string;
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

const trustHighlights: TrustHighlight[] = [
  {
    number: "01",
    title: "Compra sem surpresa",
    text: "Preço, prazo e frete apresentados com clareza antes da finalização.",
  },
  {
    number: "02",
    title: "Produtos com intenção",
    text: "Cada peça é desenvolvida considerando identidade, conforto, materiais e uso real.",
  },
  {
    number: "03",
    title: "Atendimento oficial",
    text: "Dúvidas e acompanhamento por canais identificados da L4CKOS.",
    linkTo: "/acompanhar-pedido",
    linkLabel: "ACOMPANHAR PEDIDO",
  },
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
  const [email, setEmail] = useState("");
  const [newsletterStatus, setNewsletterStatus] = useState<"idle" | "loading" | "success" | "error">("idle");
  const [newsletterMessage, setNewsletterMessage] = useState("");

  const products = useMemo<ProductItem[]>(
    () =>
      (productsQuery.data ?? []).slice(0, 3).map(item => ({
        id: item.id,
        name: item.name,
        priceCents: Number(item.price ?? 0),
        imageUrl: resolveProductImageUrl((item as any).imageThumbnailUrl || item.imageUrl),
        imageThumbnailUrl: resolveProductImageUrl((item as any).imageThumbnailUrl || item.imageUrl),
        category: item.category,
      })),
    [productsQuery.data],
  );

  useEffect(() => {
    document.title = "L4CKOS — Loja oficial";
    const description = "Conheça a L4CKOS: marca brasileira independente que une identidade urbana, movimento e espírito de aventura.";
    let meta = document.querySelector<HTMLMetaElement>('meta[name="description"]');
    if (!meta) {
      meta = document.createElement("meta");
      meta.name = "description";
      document.head.appendChild(meta);
    }
    meta.content = description;
  }, []);

  async function handleNewsletterSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const normalizedEmail = email.trim().toLowerCase();
    setNewsletterMessage("");

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(normalizedEmail)) {
      setNewsletterStatus("error");
      setNewsletterMessage("Informe um e-mail válido para entrar na lista.");
      return;
    }

    setNewsletterStatus("loading");
    try {
      const response = await csrfFetch(apiUrl("/api/waitlist"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: normalizedEmail }),
      });
      const data = (await response.json().catch(() => null)) as { message?: string } | null;
      if (!response.ok) {
        throw new Error(data?.message || "Não foi possível cadastrar seu e-mail agora.");
      }
      setNewsletterStatus("success");
      setNewsletterMessage(data?.message || "Cadastro realizado. Você receberá novidades da L4CKOS.");
      setEmail("");
    } catch (error) {
      setNewsletterStatus("error");
      setNewsletterMessage(error instanceof Error ? error.message : "Não foi possível cadastrar seu e-mail agora.");
    }
  }

  return (
    <div className="l4-home">
      <div className="l4-home-announce">
        <span className="l4-home-announce-track">
          LOJA OFICIAL — BUILT FOR ADVENTURE — IDENTIDADE EM MOVIMENTO — L4CKOS — BUILT FOR ADVENTURE — IDENTIDADE EM MOVIMENTO
        </span>
      </div>

      <section className="l4-home-hero">
        <div className="l4-home-hero-grid" />
        <div className="l4-home-hero-bg" />
        <div className="l4-home-hero-inner">
          <div className="l4-home-hero-content">
            <div className="l4-home-tag">L4CKOS — LOJA OFICIAL</div>
            <h1 className="l4-home-title">
              <span>BUILT FOR</span>
              <br />
              <span className="accent">ADVENTURE</span>
            </h1>
            <p className="l4-home-subtitle">
              Peças criadas para quem carrega identidade no cotidiano e espírito de aventura por onde passa.
            </p>
            <div className="l4-home-hero-cta">
              <Link to="/produtos" className="l4-btn-primary">
                EXPLORAR PRODUTOS
              </Link>
              <Link to="/sobre" className="l4-btn-outline">
                CONHECER A L4CKOS
              </Link>
            </div>
          </div>
          <PromoCarousel />
        </div>
      </section>

      <div className="l4-home-marquee">
        <div className="l4-home-marquee-track">
          <span>OUTDOOR</span>
          <span>L4CKOS</span>
          <span>L4CKOS</span>
          <span>IDENTIDADE URBANA</span>
          <span>BUILT FOR ADVENTURE</span>
          <span>OUTDOOR</span>
          <span>L4CKOS</span>
          <span>L4CKOS</span>
          <span>IDENTIDADE URBANA</span>
          <span>BUILT FOR ADVENTURE</span>
        </div>
      </div>

      <section id="l4-products" className="l4-home-section l4-home-products-wrap">
        <div className="l4-home-section-header">
          <div>
            <div className="l4-home-section-tag">COLEÇÃO ATUAL</div>
            <h2 className="l4-home-section-title">EXPLORE OS PRODUTOS</h2>
            <p className="l4-home-section-copy">
              Peças da L4CKOS construídas para unir identidade urbana, movimento e espírito de aventura.
            </p>
          </div>
          <Link className="l4-home-view-all" to="/produtos">
            VER COLEÇÃO COMPLETA
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
                    src={product.imageThumbnailUrl || product.imageUrl}
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
        {products.length === 0 && !productsQuery.isLoading ? (
          <p className="l4-home-empty">Nenhum produto disponível no momento.</p>
        ) : null}
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
              <div className="l4-home-testimonial-quote">{item.number}</div>
              <strong className="l4-home-trust-title">{item.title}</strong>
              <p>{item.text}</p>
              {item.linkTo && item.linkLabel ? (
                <Link className="l4-home-trust-link" to={item.linkTo}>
                  {item.linkLabel}
                </Link>
              ) : null}
            </article>
          ))}
        </div>
      </section>

      <section className="l4-home-newsletter">
        <div>
          <h3>FIQUE POR DENTRO</h3>
          <p>Receba novidades, reposições e comunicações oficiais da loja em primeira mão.</p>
        </div>
        <form className="l4-home-newsletter-form" onSubmit={handleNewsletterSubmit}>
          <label htmlFor="home-newsletter-email">Seu melhor e-mail</label>
          <div className="l4-home-newsletter-row">
            <input
              id="home-newsletter-email"
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              disabled={newsletterStatus === "loading"}
              autoComplete="email"
            />
            <button type="submit" className="l4-btn-primary" disabled={newsletterStatus === "loading"}>
              {newsletterStatus === "loading" ? "ENVIANDO..." : "ENTRAR NA LISTA"}
            </button>
          </div>
          <p className={`l4-home-newsletter-feedback ${newsletterStatus}`} aria-live="polite">
            {newsletterMessage}
          </p>
        </form>
      </section>
    </div>
  );
}
