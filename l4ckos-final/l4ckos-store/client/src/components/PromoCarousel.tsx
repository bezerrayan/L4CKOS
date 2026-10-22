import { useEffect, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { apiUrl } from "../const";
import { trpc } from "../lib/trpc";
import { hasHomeHighlightNavigation, homeHighlightRotationDelay, nextHomeHighlightIndex, shouldAutoAdvanceHomeHighlight } from "./homeHighlightRotation";
import "./PromoCarousel.css";

function resolveImageUrl(raw?: string | null) {
  const value = raw?.trim() ?? "";
  if (!value || value.startsWith("data:") || value.startsWith("//") || value.includes("\\")) return "";
  if (/^https?:\/\//i.test(value)) return value;
  return apiUrl(value.startsWith("/") ? value : `/${value}`);
}

function resolveDestination(raw?: string | null) {
  const value = raw?.trim() ?? "";
  if (value.startsWith("/") && !value.startsWith("//") && !value.includes("\\")) return value;
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:" ? url.toString() : "";
  } catch {
    return "";
  }
}

export default function PromoCarousel() {
  const highlightsQuery = trpc.products.homeHighlights.useQuery();
  const [currentIndex, setCurrentIndex] = useState(0);
  const [isPaused, setIsPaused] = useState(false);
  const [prefersReducedMotion, setPrefersReducedMotion] = useState(true);
  const [pageVisible, setPageVisible] = useState(false);
  const [imageFailed, setImageFailed] = useState(false);
  const campaigns = highlightsQuery.data?.campaigns ?? [];
  const displayMode = highlightsQuery.data?.displayMode ?? "single";
  const intervalSeconds = highlightsQuery.data?.rotationIntervalSeconds ?? 8;
  const canRotate = hasHomeHighlightNavigation(displayMode, campaigns.length);
  const normalizedIndex = canRotate && campaigns.length ? currentIndex % campaigns.length : 0;
  const promo = campaigns[normalizedIndex];
  const campaignOrder = campaigns.map(item => item.id).join(",");

  useEffect(() => {
    setCurrentIndex(0);
  }, [campaignOrder, displayMode]);

  useEffect(() => {
    if (typeof window.matchMedia !== "function") {
      setPrefersReducedMotion(false);
      return;
    }
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const sync = () => setPrefersReducedMotion(media.matches);
    sync();
    media.addEventListener?.("change", sync);
    return () => media.removeEventListener?.("change", sync);
  }, []);

  useEffect(() => {
    const sync = () => setPageVisible(document.visibilityState === "visible");
    sync();
    document.addEventListener("visibilitychange", sync);
    return () => document.removeEventListener("visibilitychange", sync);
  }, []);

  useEffect(() => {
    if (!shouldAutoAdvanceHomeHighlight({ displayMode, campaignCount: campaigns.length, paused: isPaused, reducedMotion: prefersReducedMotion, pageVisible })) return;
    const timeout = window.setTimeout(() => {
      setCurrentIndex(index => nextHomeHighlightIndex(index, 1, campaigns.length));
    }, homeHighlightRotationDelay(intervalSeconds as 5 | 8 | 10));
    return () => window.clearTimeout(timeout);
  }, [canRotate, campaigns.length, currentIndex, displayMode, intervalSeconds, isPaused, pageVisible, prefersReducedMotion]);

  useEffect(() => setImageFailed(false), [promo?.id, promo?.imageUrl]);

  const move = (direction: -1 | 1) => {
    setCurrentIndex(index => nextHomeHighlightIndex(index, direction, campaigns.length));
  };

  if (highlightsQuery.isLoading) {
    return <section className="l4-hero-editorial" aria-busy="true" aria-label="Carregando destaque da loja"><div className="l4-hero-editorial-frame"><div className="l4-hero-editorial-product"><div className="l4-hero-editorial-fallback" role="status">Carregando apresentação…</div></div></div></section>;
  }
  if (highlightsQuery.isError || !promo) {
    const message = highlightsQuery.isError ? "Apresentação temporariamente indisponível" : "Conheça a L4CKOS";
    return <section className="l4-hero-editorial" aria-label="Destaque da L4CKOS"><div className="l4-hero-editorial-frame"><div className="l4-hero-editorial-fallback" role="status">{message}</div></div></section>;
  }

  const desktopImage = resolveImageUrl(promo.imageUrl);
  const mobileImage = resolveImageUrl(promo.mobileImageUrl);
  const destination = resolveDestination(promo.linkUrl);
  const imageAlt = promo.imageAlt?.trim() || promo.title;

  return (
    <section
      className="l4-hero-editorial"
      role={canRotate ? "region" : undefined}
      aria-roledescription={canRotate ? "carrossel" : undefined}
      aria-label={canRotate ? "Destaques da loja" : promo.title}
      onPointerEnter={() => setIsPaused(true)}
      onPointerLeave={() => setIsPaused(false)}
      onFocusCapture={() => setIsPaused(true)}
      onBlurCapture={event => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setIsPaused(false);
      }}
    >
      <div className="l4-hero-editorial-frame" key={promo.id}>
        <div className="l4-hero-editorial-copy">
          {promo.badge?.trim() ? <span className="l4-hero-editorial-badge">{promo.badge}</span> : null}
          <h1>{promo.title}</h1>
          {promo.description?.trim() ? <p className="l4-hero-editorial-description">{promo.description}</p> : null}
          {promo.discountText?.trim() ? (
            <p className="l4-hero-editorial-offer">
              {promo.discountText}{promo.discountLabel?.trim() ? ` ${promo.discountLabel}` : ""}
            </p>
          ) : null}
          {destination ? (
            <a
              href={destination}
              className="l4-hero-editorial-link"
              aria-label={promo.ctaLabel}
              {...(/^https?:\/\//i.test(destination) ? { target: "_blank", rel: "noreferrer" } : {})}
            >
              {promo.ctaLabel}<span aria-hidden="true">→</span>
            </a>
          ) : (
            <span className="l4-hero-editorial-link is-unavailable" aria-disabled="true">
              {promo.ctaLabel}
            </span>
          )}
        </div>
        <div className="l4-hero-editorial-product">
          {desktopImage && !imageFailed ? (
            <picture>
              {mobileImage ? <source media="(max-width: 640px)" srcSet={mobileImage} /> : null}
              <img
                src={desktopImage}
                alt={imageAlt}
                className="l4-hero-editorial-image"
                loading="eager"
                fetchPriority={normalizedIndex === 0 ? "high" : "auto"}
                decoding="async"
                onError={() => setImageFailed(true)}
              />
            </picture>
          ) : (
            <div className="l4-hero-editorial-fallback" role="img" aria-label={imageAlt}>
              Imagem indisponível
            </div>
          )}
        </div>
      </div>
      {canRotate ? <nav className="l4-hero-editorial-controls" aria-label="Navegação dos destaques">
        <button type="button" aria-label="Exibir destaque anterior" onClick={() => move(-1)}><ChevronLeft size={18} /></button>
        <div className="l4-hero-editorial-indicators">
          {campaigns.map((campaign, index) => <button
            key={campaign.id}
            type="button"
            aria-label={`Exibir destaque ${index + 1}: ${campaign.title}`}
            aria-current={index === normalizedIndex ? "true" : undefined}
            onClick={() => setCurrentIndex(index)}
          />)}
        </div>
        <span aria-hidden="true">{normalizedIndex + 1} / {campaigns.length}</span>
        <button type="button" aria-label="Exibir próximo destaque" onClick={() => move(1)}><ChevronRight size={18} /></button>
      </nav> : null}
    </section>
  );
}
