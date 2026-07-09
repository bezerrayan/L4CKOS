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
    badge: "LANÇAMENTO L4CKOS x CLÃ 14 BIS",
    title: "CONFIRA A CAMISETA EXCLUSIVA DA PARCERIA",
    description: "Edição especial com identidade escoteira e estética urbana da L4CKOS.",
    ctaLabel: "Aproveitar oferta",
    linkUrl: "/produtos",
    discount: "",
    discountLabel: "",
    color: "linear-gradient(135deg, #070707 0%, #111111 52%, #210711 100%)",
  },
];

function toLaunchPromo(base?: Partial<Promo> | null): Promo {
  return {
    id: Number(base?.id ?? 1),
    badge: "LANÇAMENTO L4CKOS x CLÃ 14 BIS",
    title: "CONFIRA A CAMISETA EXCLUSIVA DA PARCERIA",
    description: "Edição especial com identidade escoteira e estética urbana da L4CKOS.",
    ctaLabel: "Aproveitar oferta",
    imageUrl: base?.imageUrl,
    mobileImageUrl: base?.mobileImageUrl,
    imageAlt: base?.imageAlt || "Camiseta L4CKOS x Clã 14 Bis com estampa das costas",
    linkUrl: base?.linkUrl || "/produtos",
    discount: "",
    discountLabel: "",
    color: "linear-gradient(135deg, #070707 0%, #111111 52%, #210711 100%)",
  };
}

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

    return [toLaunchPromo(fromApi[0] || PROMOS_FALLBACK[0])];
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
          <div className="l4-home-hero-carousel-overlay" />
          <div className="l4-home-hero-carousel-copy-panel">
            <span className="l4-home-hero-carousel-badge">
              <span aria-hidden="true" />
              {promo.badge}
            </span>
            <div className="l4-home-hero-carousel-copy-wrap">
              <div className="l4-home-hero-carousel-copy">
                <h3>
                  <span>CONFIRA A</span>
                  <span>CAMISETA</span>
                  <span>EXCLUSIVA DA</span>
                  <span className="is-red">PARCERIA</span>
                </h3>
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
            <span className="l4-home-hero-carousel-count">
              {String(current + 1).padStart(2, "0")} / {String(promos.length).padStart(2, "0")}
            </span>
          </div>
          <div className="l4-home-hero-carousel-product" aria-label={promo.imageAlt || promo.title}>
            <div className="l4-home-hero-carousel-product-frame">
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
                  <small>x CLÃ 14 BIS</small>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
      {promos.length > 1 ? (
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
      ) : null}
    </section>
  );
}
