import type { Product } from "../types/product";
﻿import { Link } from "react-router-dom";
import { FormEvent, useEffect, useMemo, useState } from "react";
import { trpc } from "../lib/trpc";
import { resolveCatalogImageUrl } from "../lib/images";
import { apiUrl } from "../const";
import { csrfFetch } from "../lib/csrf";
import PromoCarousel from "../components/PromoCarousel";
import ProductCard from "../components/ProductCard";
import { productPriceFromCents } from "../utils/money";
import "./Home.css";
import camisaFallback from "../images/camisa.png";

type TrustHighlight = {
  number: string;
  title: string;
  text: string;
  linkTo?: string;
  linkLabel?: string;
};

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

function resolveProductImageUrl(raw: string | null | undefined) {
  const value = (raw || "").trim();
  if (!value) return "";
  return resolveCatalogImageUrl(value);
}

export default function Home() {
  const productsQuery = trpc.products.list.useQuery({ limit: 12 }, { staleTime: 0, refetchOnMount: "always", refetchInterval: 15000 });
  const [email, setEmail] = useState("");
  const [newsletterStatus, setNewsletterStatus] = useState<"idle" | "loading" | "success" | "error">("idle");
  const [newsletterMessage, setNewsletterMessage] = useState("");

  const products = useMemo<Product[]>(
    () =>
      (productsQuery.data ?? []).slice(0, 3).map(item => ({
        id: item.id,
        name: item.name,
        salesMode: item.salesMode,
        productionBatch: item.productionBatch,
        price: productPriceFromCents(Number(item.price ?? 0)),
        stock: Number(item.stock ?? 0),
        image: resolveProductImageUrl(item.imageUrl) || camisaFallback,
        imageThumbnail: resolveProductImageUrl(item.imageThumbnailUrl || item.imageUrl) || camisaFallback,
        category: item.category ?? undefined,
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
      <div className="l4-home-announce" tabIndex={0} role="region" aria-label="Frases da marca — role horizontalmente para ler">
        <span className="l4-home-announce-track">
            <strong>L4CKOS</strong><span>LOJA OFICIAL</span><span>BUILT FOR ADVENTURE</span><span>IDENTIDADE EM MOVIMENTO</span><span>DROPS AUTORAIS</span>
        </span>
      </div>

      <section className="l4-home-hero" aria-label="Destaques da Home L4CKOS">
        <div className="l4-home-hero-grid" />
        <div className="l4-home-hero-bg" />
        <div className="l4-home-hero-inner">
          <PromoCarousel />
        </div>
      </section>

      <div className="l4-home-marquee">
        <div className="l4-home-marquee-track">
          <div className="l4-home-marquee-group">
            <span>OUTDOOR</span>
            <span>L4CKOS</span>
            <span>IDENTIDADE URBANA</span>
            <span>BUILT FOR ADVENTURE</span>
            <span>L4CKOS</span>
          </div>
          <div className="l4-home-marquee-group" aria-hidden="true">
            <span>OUTDOOR</span>
            <span>L4CKOS</span>
            <span>IDENTIDADE URBANA</span>
            <span>BUILT FOR ADVENTURE</span>
            <span>L4CKOS</span>
          </div>
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
        {productsQuery.isLoading ? <div role="status" className="l4-catalog-skeleton"><span className="l4-sr-only">Carregando coleção...</span>{[0, 1, 2].map(index => <div key={index} className="l4-skeleton-card" aria-hidden="true" />)}</div> : null}
        {productsQuery.isError ? <p className="l4-feedback" role="alert">A coleção está temporariamente indisponível. Tente novamente em instantes.</p> : null}
        <div className="l4-home-products-grid l4-minimal-products">
          {products.map((product, idx) => (
            <div key={product.id}>
              <ProductCard product={product} showFavorite={false} imageLoading={idx < 4 ? "eager" : "lazy"} />
            </div>
          ))}
        </div>
        {products.length === 0 && !productsQuery.isLoading && !productsQuery.isError ? (
          <p className="l4-home-empty">Nenhum produto disponível no momento.</p>
        ) : null}
      </section>

      <div className="l4-home-lower">
      <section className="l4-home-section l4-home-confidence">
        <div className="l4-home-section-header">
          <div>
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
    </div>
  );
}
