import { useEffect, useMemo, useState } from "react";
import { apiUrl } from "../const";
import { trpc } from "../lib/trpc";

interface Promo {
  id: number;
  badge: string;
  title: string;
  description: string;
  ctaLabel: string;
  imageUrl?: string;
  mobileImageUrl?: string;
  imageAlt?: string;
  linkUrl?: string;
  discount: string;
  discountLabel: string;
  color: string;
}

const PROMOS_FALLBACK: Promo[] = [
  {
    id: 1,
    badge: "PROMOCAO",
    title: "Desconto em peças de aventura",
    description: "Ate 30% OFF em modelos dry fit, regatas e oversized.",
    ctaLabel: "Aproveitar oferta",
    linkUrl: "/produtos",
    discount: "30%",
    discountLabel: "OFF",
    color: "linear-gradient(135deg, #151515 0%, #2a0a12 100%)",
  },
  {
    id: 2,
    badge: "PROMOCAO",
    title: "Promocao de roupas",
    description: "Compre 2 e ganhe desconto progressivo em camisetas e jaquetas.",
    ctaLabel: "Ver promocao",
    linkUrl: "/produtos",
    discount: "50%",
    discountLabel: "OFF",
    color: "linear-gradient(135deg, #1a1a1a 0%, #32111a 100%)",
  },
];

function resolvePromoImageUrl(raw?: string | null) {
  const value = (raw || "").trim();
  if (!value) return "";
  if (/^https?:\/\//i.test(value) || value.startsWith("data:")) return value;
  if (value.startsWith("/")) return apiUrl(value);
  return apiUrl(`/${value}`);
}

export default function PromoCarousel() {
  const [current, setCurrent] = useState(0);
  const [paused, setPaused] = useState(false);
  const [isMobileViewport, setIsMobileViewport] = useState(false);
  const promotionsQuery = trpc.products.promotions.useQuery();

  const promos = useMemo<Promo[]>(() => {
    const fromApi = (promotionsQuery.data ?? []).map((item: any) => ({
      id: Number(item.id),
      badge: String(item.badge ?? "").trim() || "PROMOCAO",
      title: String(item.title ?? "").trim() || "Oferta especial",
      description: String(item.description ?? "").trim() || "Confira condicoes exclusivas por tempo limitado.",
      ctaLabel: String(item.ctaLabel ?? "").trim() || "Aproveitar oferta",
      imageUrl: resolvePromoImageUrl(item.imageUrl),
      mobileImageUrl: resolvePromoImageUrl(item.mobileImageUrl),
      imageAlt: String(item.imageAlt ?? "").trim() || String(item.title ?? "").trim() || "Banner promocional",
      linkUrl: String(item.linkUrl ?? "").trim() || "/produtos",
      discount: String(item.discountText ?? "").trim(),
      discountLabel: String(item.discountLabel ?? "").trim() || "OFF",
      color: String(item.bgStyle ?? "").trim() || "linear-gradient(135deg, #151515 0%, #2a0a12 100%)",
    }));

    return fromApi.length > 0 ? fromApi : PROMOS_FALLBACK;
  }, [promotionsQuery.data]);

  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return;
    const media = window.matchMedia("(max-width: 768px)");
    const sync = () => setIsMobileViewport(media.matches);
    sync();
    if (typeof media.addEventListener === "function") {
      media.addEventListener("change", sync);
      return () => media.removeEventListener("change", sync);
    }
    media.addListener(sync);
    return () => media.removeListener(sync);
  }, []);

  useEffect(() => {
    if (paused || promos.length <= 1) return;
    const timer = window.setInterval(() => {
      setCurrent((prev) => (prev + 1) % promos.length);
    }, 4000);
    return () => window.clearInterval(timer);
  }, [paused, promos.length]);

  useEffect(() => {
    if (current > promos.length - 1) {
      setCurrent(0);
    }
  }, [current, promos.length]);

  const promo = promos[current] ?? promos[0];
  if (!promo) return null;
  const promoImage = isMobileViewport && promo.mobileImageUrl ? promo.mobileImageUrl : promo.imageUrl;

  return (
    <section
      className="l4-home-hero-carousel"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
    >
      <div
        className="l4-home-hero-carousel-card"
        style={{
          backgroundImage: `${promo.color}, linear-gradient(180deg, rgba(8,8,8,0.05) 0%, rgba(8,8,8,0.78) 100%)`,
        }}
      >
        <div className="l4-home-hero-carousel-frame">
          {promoImage ? (
            <img
              src={promoImage}
              alt={promo.imageAlt || promo.title}
              className="l4-home-hero-carousel-image"
              loading="lazy"
            />
          ) : (
            <div className="l4-home-hero-carousel-fallback">
              <span>L4CKOS</span>
            </div>
          )}
          <div className="l4-home-hero-carousel-overlay" />
          <div className="l4-home-hero-carousel-top">
            <span className="l4-home-hero-carousel-badge">{promo.badge}</span>
            <span className="l4-home-hero-carousel-count">
              {String(current + 1).padStart(2, "0")} / {String(promos.length).padStart(2, "0")}
            </span>
          </div>
          <div className="l4-home-hero-carousel-bottom">
            <div className="l4-home-hero-carousel-copy-wrap">
              <div className="l4-home-hero-carousel-copy">
                <h3>{promo.title}</h3>
                <p>{promo.description}</p>
              </div>
              <a
                href={(promo.linkUrl || "/produtos").trim() || "/produtos"}
                className="l4-home-hero-carousel-link"
                aria-label={promo.ctaLabel}
              >
                {promo.ctaLabel}
              </a>
            </div>
            {promo.discount ? (
              <div className="l4-home-hero-carousel-discount">
                <strong>{promo.discount}</strong>
                <span>{promo.discountLabel}</span>
              </div>
            ) : null}
          </div>
        </div>
      </div>
      <div className="l4-home-hero-carousel-controls">
        <button
          type="button"
          className="l4-home-hero-carousel-nav"
          onClick={() => setCurrent((prev) => (prev - 1 + promos.length) % promos.length)}
          aria-label="Banner anterior"
        >
          {"<"}
        </button>
        <div className="l4-home-hero-carousel-dots">
          {promos.map((_, idx) => (
            <button
              type="button"
              key={idx}
              className={`l4-home-hero-carousel-dot${idx === current ? " is-active" : ""}`}
              onClick={() => setCurrent(idx)}
              aria-label={`Ir para banner ${idx + 1}`}
            />
          ))}
        </div>
        <button
          type="button"
          className="l4-home-hero-carousel-nav"
          onClick={() => setCurrent((prev) => (prev + 1) % promos.length)}
          aria-label="Proximo banner"
        >
          {">"}
        </button>
      </div>
    </section>
  );
}
