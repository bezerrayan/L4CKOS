import { FormEvent, useEffect, useRef, useState } from "react";
import { apiUrl } from "../const";
import { contactChannels } from "../config/site";
import { csrfFetch } from "../lib/csrf";
import "./ComingSoon.css";
import type { ComingSoonMotion } from "./comingSoonMotion";

import logoHeader from "../images/coming-soon/l4k-mark-header.webp";
import logoLayerL from "../images/coming-soon/l4k-layer-L.webp";
import logoLayer4 from "../images/coming-soon/l4k-layer-4.webp";
import logoLayerK from "../images/coming-soon/l4k-layer-K.webp";
import clanFront600 from "../images/coming-soon/cla-14-bis-frente-600.webp";
import clanFront1000 from "../images/coming-soon/cla-14-bis-frente-1000.webp";
import clanBack600 from "../images/coming-soon/cla-14-bis-costas-borrada-600.webp";
import clanBack1000 from "../images/coming-soon/cla-14-bis-costas-borrada-1000.webp";
import clanDetail from "../images/coming-soon/cla-14-bis-detalhe-peito-640.webp";
import cityFront600 from "../images/coming-soon/city-noise-frente-600.webp";
import cityFront1000 from "../images/coming-soon/city-noise-frente-1000.webp";
import cityBack600 from "../images/coming-soon/city-noise-costas-borrada-600.webp";
import cityBack1000 from "../images/coming-soon/city-noise-costas-borrada-1000.webp";
import cityDetail from "../images/coming-soon/city-noise-detalhe-peito-640.webp";
import unknownFront600 from "../images/coming-soon/unknown-territory-frente-600.webp";
import unknownFront1000 from "../images/coming-soon/unknown-territory-frente-1000.webp";
import unknownBack600 from "../images/coming-soon/unknown-territory-costas-borrada-600.webp";
import unknownBack1000 from "../images/coming-soon/unknown-territory-costas-borrada-1000.webp";
import unknownDetail from "../images/coming-soon/unknown-territory-detalhe-peito-640.webp";

/*
 * Conteúdo pendente: fica oculto até haver dados reais.
 * - Trecho dos fundadores, TikTok e WhatsApp: não renderizados.
 * - Política de privacidade: /privacidade é bloqueada pela própria Coming Soon,
 *   então a linha de consentimento aparece sem link por enquanto.
 *
 * Sigilo das estampas: o repositório é público. As costas usam SOMENTE os
 * arquivos "costas-borrada", já borrados na origem. Nunca colocar a arte nítida
 * aqui antes do lançamento.
 */

const MOTION_LOAD_TIMEOUT_MS = 4000;
// Trava de segurança: se a abertura não terminar neste tempo (GSAP lento,
// requestAnimationFrame parado em janela coberta etc.), a página é liberada.
// Usa setTimeout de propósito: não depende de requestAnimationFrame.
const INTRO_FAILSAFE_MS = 6000;

// Começa a baixar o módulo de animação (e o GSAP) assim que este chunk é avaliado,
// em paralelo com o primeiro render, em vez de esperar o efeito pós-montagem.
let motionModule: Promise<typeof import("./comingSoonMotion")> | null = null;
function loadMotion() {
  motionModule ??= import("./comingSoonMotion");
  return motionModule;
}
if (!prefersReducedMotion()) {
  void loadMotion().catch(() => {
    motionModule = null;
  });
}

const MANIFESTO =
  "A L4CKOS nasceu em 2026 pra quem vive entre o asfalto e a trilha. Streetwear, aventura e cultura urbana na mesma peça. Sem promoção eterna, sem roupa genérica. Drops pequenos, feitos com calma e testados de verdade.";

/** Imagem responsiva: versões 600w e ~1000w do mesmo recorte. */
type ShirtImage = {
  src600: string;
  src1000: string;
  /** Dimensões reais da versão grande (largura, altura). */
  size: [number, number];
};

/**
 * Costas da camiseta. Para a revelação no lançamento, basta trocar este campo:
 * `{ status: "revelada", image: <costas nítidas> }`. O layout não muda; o selo
 * "Em breve" some e o texto alternativo passa a descrever a estampa.
 */
type ShirtBack =
  | {
      status: "em-breve";
      image: ShirtImage;
      /** Centro da área da estampa, em % da imagem das costas (x, y), onde fica o selo. */
      badgeAt: [number, number];
    }
  | { status: "revelada"; image: ShirtImage; alt: string };

type Territory = {
  key: string;
  className: string;
  count: string;
  chip: string;
  chipHot?: boolean;
  name: string;
  desc: string;
  meta: string;
  front: ShirtImage;
  frontAlt: string;
  back: ShirtBack;
  detail: string;
  detailAlt: string;
  detailSize: [number, number];
  topo?: boolean;
};

const TERRITORIES: Territory[] = [
  {
    key: "clan-14-bis",
    className: "p1",
    count: "1 de 3",
    chip: "Colab",
    chipHot: true,
    name: "Clã 14 Bis",
    desc: "L4CKOS × Clã Pioneiro XIV Bis. Uma peça feita junto com quem vive a aventura de verdade.",
    meta: "Base navy. Na frente, a assinatura com o 14 Bis.",
    front: { src600: clanFront600, src1000: clanFront1000, size: [983, 1331] },
    frontAlt: "Camiseta Clã 14 Bis, navy, com L4CKOS e o avião 14 Bis no peito",
    back: {
      status: "em-breve",
      image: { src600: clanBack600, src1000: clanBack1000, size: [897, 1327] },
      badgeAt: [48, 32],
    },
    detail: clanDetail,
    detailAlt: "Detalhe ampliado da estampa do peito da Clã 14 Bis",
    detailSize: [640, 278],
  },
  {
    key: "city-noise",
    className: "p2",
    count: "2 de 3",
    chip: "Urbana",
    name: "City Noise",
    desc: "O barulho, o concreto, o movimento. A camiseta pra quem vive a cidade em volume alto.",
    meta: "Base preta. Na frente, a tag L4CKOS em vermelho.",
    front: { src600: cityFront600, src1000: cityFront1000, size: [984, 1287] },
    frontAlt: "Camiseta City Noise, preta, com a tag L4CKOS em vermelho no peito",
    back: {
      status: "em-breve",
      image: { src600: cityBack600, src1000: cityBack1000, size: [992, 1295] },
      badgeAt: [44, 31],
    },
    detail: cityDetail,
    detailAlt: "Detalhe ampliado da estampa do peito da City Noise",
    detailSize: [640, 633],
  },
  {
    key: "unknown-territory",
    className: "p3",
    count: "3 de 3",
    chip: "Exploração",
    name: "Unknown Territory",
    desc: "Mapas, rotas e lugares que ainda não estão no GPS. Pra quem prefere o caminho que ninguém marcou.",
    meta: "Base off-white. Na frente, o recorte de mapa com L4K.",
    front: { src600: unknownFront600, src1000: unknownFront1000, size: [836, 1262] },
    frontAlt: "Camiseta Unknown Territory, off-white, com um recorte de mapa e L4K no peito",
    back: {
      status: "em-breve",
      image: { src600: unknownBack600, src1000: unknownBack1000, size: [782, 1219] },
      badgeAt: [63, 34],
    },
    detail: unknownDetail,
    detailAlt: "Detalhe ampliado da estampa do peito da Unknown Territory",
    detailSize: [640, 403],
    topo: true,
  },
];

/** Palco da camiseta: até 500px no desktop, ~68vw no celular. */
const STAGE_SIZES = "(max-width: 760px) 68vw, 500px";
/** Leque: cada camiseta ocupa no máximo ~46vw (50vw no celular). */
const FAN_SIZES = "(max-width: 760px) 50vw, min(46vw, 480px)";

function srcSet(image: ShirtImage) {
  return `${image.src600} 600w, ${image.src1000} ${image.size[0]}w`;
}

function backAlt(item: Territory) {
  return item.back.status === "revelada"
    ? item.back.alt
    : `Costas da camiseta ${item.name}, com a estampa borrada até o lançamento`;
}

const BAND_TEXT = ["Algo grande vem aí", "Built for Adventure", "Drop 01", "Clã 14 Bis", "City Noise", "Unknown Territory"];

function isValidEmail(email: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email);
}

function getWaitlistMessage(responseMessage?: string) {
  const normalized = String(responseMessage || "").toLowerCase();
  if (normalized.includes("cadastrado") || normalized.includes("existe") || normalized.includes("lista")) {
    return "Este e-mail já está na lista.";
  }
  return "Não foi possível concluir o cadastro agora. Tente novamente.";
}

function prefersReducedMotion() {
  return typeof window !== "undefined"
    && typeof window.matchMedia === "function"
    && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function TurnIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M3 12a9 9 0 0 1 15.3-6.4L21 8" />
      <path d="M21 3v5h-5" />
      <path d="M21 12a9 9 0 0 1-15.3 6.4L3 16" />
      <path d="M3 21v-5h5" />
    </svg>
  );
}

const DEFAULT_HINT = "Sem spam. Apenas novidades importantes sobre o lançamento.";

export default function ComingSoon() {
  const rootRef = useRef<HTMLDivElement>(null);
  const doneRef = useRef<HTMLDivElement>(null);
  const emailRef = useRef<HTMLInputElement>(null);
  const [introActive, setIntroActive] = useState(() => !prefersReducedMotion());
  const [backs, setBacks] = useState<Record<string, boolean>>({});
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const currentYear = new Date().getFullYear();

  useEffect(() => {
    const root = rootRef.current;
    if (!root || prefersReducedMotion()) {
      setIntroActive(false);
      return;
    }

    let cancelled = false;
    let motion: ComingSoonMotion | undefined;
    // Se o GSAP não chegar a tempo (rede lenta/bloqueio), a página fica estática.
    const loadTimeout = window.setTimeout(() => {
      cancelled = true;
      setIntroActive(false);
    }, MOTION_LOAD_TIMEOUT_MS);
    // Trava: a abertura tem até INTRO_FAILSAFE_MS para terminar; depois disso o
    // loader sai, o scroll volta e o conteúdo da abertura aparece completo.
    const failsafe = window.setTimeout(() => {
      root.dataset.introFailsafe = "true";
      if (motion) {
        motion.finishIntroNow();
      } else {
        cancelled = true;
        setIntroActive(false);
      }
    }, INTRO_FAILSAFE_MS);

    loadMotion()
      .then(({ startComingSoonMotion }) => {
        if (cancelled) return;
        window.clearTimeout(loadTimeout);
        motion = startComingSoonMotion(root, {
          onIntroDone: () => {
            window.clearTimeout(failsafe);
            setIntroActive(false);
          },
        });
      })
      .catch(() => {
        window.clearTimeout(loadTimeout);
        window.clearTimeout(failsafe);
        if (!cancelled) setIntroActive(false);
      });

    return () => {
      cancelled = true;
      window.clearTimeout(loadTimeout);
      window.clearTimeout(failsafe);
      motion?.stop();
    };
  }, []);

  useEffect(() => {
    if (submitted) doneRef.current?.focus();
  }, [submitted]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const normalizedEmail = email.trim().toLowerCase();
    setError("");

    if (!isValidEmail(normalizedEmail)) {
      setError("Digite um e-mail válido.");
      emailRef.current?.focus();
      return;
    }

    setLoading(true);
    try {
      const response = await csrfFetch(apiUrl("/api/waitlist"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: normalizedEmail }),
      });
      const data = (await response.json().catch(() => null)) as { message?: string } | null;
      if (!response.ok) {
        throw new Error(getWaitlistMessage(data?.message));
      }
      setEmail("");
      setSubmitted(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível concluir o cadastro agora. Tente novamente.");
    } finally {
      setLoading(false);
    }
  }

  function toggleBack(key: string) {
    setBacks((current) => ({ ...current, [key]: !current[key] }));
  }

  return (
    <div className="l4cs" ref={rootRef}>
      {introActive ? (
        <div className="l4cs-loader" aria-hidden="true">
          <div className="l4cs-loader-logo">
            <img className="l4cs-lg lg-L" src={logoLayerL} alt="" width={739} height={382} decoding="async" />
            <img className="l4cs-lg lg-4" src={logoLayer4} alt="" width={739} height={382} decoding="async" />
            <img className="l4cs-lg lg-K" src={logoLayerK} alt="" width={739} height={382} decoding="async" />
            <span className="l4cs-slash" />
          </div>
        </div>
      ) : null}

      <header className="l4cs-top">
        <a className="l4cs-brand" href="#hero" aria-label="L4CKOS, voltar ao início">
          <img src={logoHeader} alt="L4K" width={288} height={149} />
        </a>
        <div className="l4cs-top-right">
          <span className="l4cs-pill l4cs-status-pill">
            <span className="l4cs-dot" aria-hidden="true" />
            Drop 01 em breve
          </span>
          <a className="l4cs-pill l4cs-pill-red" href="#lista">
            Entrar na lista
          </a>
        </div>
      </header>

      <main>
        <section id="hero" className="l4cs-hero" aria-label="Abertura" tabIndex={-1}>
          <svg className="l4cs-topo" viewBox="0 0 1200 800" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
            <path d="M-50 320 C 130 230, 280 420, 500 330 S 840 200, 980 310 S 1180 420, 1300 340" />
            <path d="M-50 370 C 140 280, 290 470, 510 380 S 850 250, 990 360 S 1190 470, 1300 390" />
            <path d="M-50 420 C 150 330, 300 520, 520 430 S 860 300, 1000 410 S 1200 520, 1300 440" />
            <path d="M-50 470 C 160 380, 310 570, 530 480 S 870 350, 1010 460 S 1210 570, 1300 490" />
            <path d="M-50 520 C 170 430, 320 620, 540 530 S 880 400, 1020 510 S 1220 620, 1300 540" />
            <path d="M-50 570 C 180 480, 330 670, 550 580 S 890 450, 1030 560 S 1230 670, 1300 590" />
            <ellipse cx="900" cy="170" rx="130" ry="70" />
            <ellipse cx="900" cy="170" rx="85" ry="44" />
            <ellipse cx="900" cy="170" rx="40" ry="20" />
            <ellipse cx="220" cy="690" rx="160" ry="62" />
            <ellipse cx="220" cy="690" rx="100" ry="36" />
          </svg>

          <div className="l4cs-hero-main">
            <h1 className="l4cs-hero-title display">
              <span className="l4cs-sr-only">Algo grande vem aí.</span>
              <span className="l4cs-hl l4cs-hl1" aria-hidden="true">
                <span className="l4cs-hw">Algo</span>
              </span>
              <span className="l4cs-hl l4cs-hl2" aria-hidden="true">
                <span className="l4cs-hw">grande</span>
              </span>
              <span className="l4cs-hl l4cs-hl3" aria-hidden="true">
                <span className="l4cs-hw">vem aí.</span>
              </span>
            </h1>
          </div>

          <div className="l4cs-hero-foot">
            <div className="l4cs-hero-msg">
              <p className="l4cs-status">
                O primeiro drop da L4CKOS está sendo preparado. Entre na lista para receber acesso antecipado ao lançamento.
              </p>
              <a className="l4cs-btn primary l4cs-btn-sm magnetic" href="#lista">
                Quero acesso antecipado
              </a>
            </div>
            <div className="l4cs-cue" aria-hidden="true">
              <span className="l4cs-cue-line" />
              Role pra explorar
            </div>
          </div>
        </section>

        <section className="l4cs-manifesto" aria-label="Nossa história">
          <p className="l4cs-manifesto-text">
            <span className="l4cs-sr-only">{MANIFESTO}</span>
            {MANIFESTO.split(/\s+/).map((word, index, words) => (
              <span className="l4cs-w" aria-hidden="true" key={`${word}-${index}`}>
                {word}
                {index < words.length - 1 ? " " : ""}
              </span>
            ))}
          </p>
        </section>

        <section className="l4cs-drop" aria-label="Prévia do Drop 01">
          <div className="l4cs-drop-intro">
            <h2 className="l4cs-drop-title display">Drop 01</h2>
            <p className="l4cs-drop-lead">
              Três camisetas, três territórios. A frente é minimalista; a estampa principal fica nas costas e vai ser revelada aos poucos no Instagram.
            </p>
          </div>

          <div className="l4cs-fan" aria-hidden="true">
            {TERRITORIES.map((item, index) => (
              <img
                key={item.key}
                className={`f${index + 1}`}
                src={item.front.src600}
                srcSet={srcSet(item.front)}
                sizes={FAN_SIZES}
                alt=""
                width={item.front.size[0]}
                height={item.front.size[1]}
                loading="lazy"
                decoding="async"
              />
            ))}
          </div>

          <div className="l4cs-track">
            <div className="l4cs-panels">
              {TERRITORIES.map((item) => {
                const isBack = Boolean(backs[item.key]);
                return (
                  <article className={`l4cs-panel ${item.className}`} key={item.key} aria-labelledby={`l4cs-${item.key}`}>
                    {item.topo ? (
                      <svg className="l4cs-panel-topo" viewBox="0 0 1200 800" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
                        <path d="M-50 300 C 140 210, 300 400, 520 310 S 860 180, 1000 290 S 1200 400, 1300 320" />
                        <path d="M-50 360 C 150 270, 310 460, 530 370 S 870 240, 1010 350 S 1210 460, 1300 380" />
                        <path d="M-50 420 C 160 330, 320 520, 540 430 S 880 300, 1020 410 S 1220 520, 1300 440" />
                        <path d="M-50 480 C 170 390, 330 580, 550 490 S 890 360, 1030 470 S 1230 580, 1300 500" />
                        <path d="M-50 540 C 180 450, 340 640, 560 550 S 900 420, 1040 530 S 1240 640, 1300 560" />
                        <ellipse cx="960" cy="150" rx="140" ry="70" />
                        <ellipse cx="960" cy="150" rx="90" ry="42" />
                        <ellipse cx="960" cy="150" rx="42" ry="18" />
                      </svg>
                    ) : null}
                    <div className="l4cs-panel-bg display" aria-hidden="true">
                      {item.name} — {item.name}
                    </div>
                    <div className="l4cs-panel-inner">
                      <div className={`l4cs-stage${isBack ? " is-back" : ""}`}>
                        <div className="l4cs-flip">
                          <div className="l4cs-flip-inner">
                            <div className="l4cs-face front" aria-hidden={isBack}>
                              <img
                                src={item.front.src600}
                                srcSet={srcSet(item.front)}
                                sizes={STAGE_SIZES}
                                alt={item.frontAlt}
                                width={item.front.size[0]}
                                height={item.front.size[1]}
                                loading="lazy"
                                decoding="async"
                              />
                            </div>
                            <div className="l4cs-face back" aria-hidden={!isBack}>
                              <div
                                className="l4cs-back-art"
                                style={{ aspectRatio: `${item.back.image.size[0]} / ${item.back.image.size[1]}` }}
                              >
                                <img
                                  src={item.back.image.src600}
                                  srcSet={srcSet(item.back.image)}
                                  sizes={STAGE_SIZES}
                                  alt={backAlt(item)}
                                  width={item.back.image.size[0]}
                                  height={item.back.image.size[1]}
                                  loading="lazy"
                                  decoding="async"
                                />
                                {item.back.status === "em-breve" ? (
                                  <span
                                    className="l4cs-soon"
                                    aria-hidden="true"
                                    style={{ left: `${item.back.badgeAt[0]}%`, top: `${item.back.badgeAt[1]}%` }}
                                  >
                                    Em breve
                                  </span>
                                ) : null}
                              </div>
                            </div>
                          </div>
                        </div>
                        <figure className="l4cs-detail">
                          <img
                            src={item.detail}
                            alt={item.detailAlt}
                            width={item.detailSize[0]}
                            height={item.detailSize[1]}
                            loading="lazy"
                            decoding="async"
                          />
                          <figcaption>Detalhe do peito</figcaption>
                        </figure>
                      </div>
                      <div className="l4cs-panel-copy">
                        <span className="l4cs-count reveal">{item.count}</span>
                        <span className={`l4cs-chip reveal${item.chipHot ? " hot" : ""}`}>{item.chip}</span>
                        <h3 className="l4cs-panel-name display reveal" id={`l4cs-${item.key}`}>
                          {item.name}
                        </h3>
                        <p className="l4cs-panel-desc reveal">{item.desc}</p>
                        <p className="l4cs-panel-meta reveal">{item.meta}</p>
                        <button
                          className="l4cs-turn reveal"
                          type="button"
                          aria-pressed={isBack}
                          onClick={() => toggleBack(item.key)}
                        >
                          <TurnIcon />
                          <span>{isBack ? "Ver frente" : "Ver costas"}</span>
                        </button>
                      </div>
                    </div>
                  </article>
                );
              })}
            </div>
            <div className="l4cs-progress" aria-hidden="true">
              <div className="l4cs-progress-bar" />
            </div>
          </div>
        </section>

        <div className="l4cs-band" aria-hidden="true">
          <div className="l4cs-band-inner">
            {[0, 1].map((copy) => (
              <span key={copy}>
                {BAND_TEXT.map((text) => (
                  <span key={text}>
                    {text}
                    <b className="x">✕</b>
                  </span>
                ))}
              </span>
            ))}
          </div>
        </div>

        <section id="lista" className="l4cs-lista" aria-labelledby="l4cs-lista-title" tabIndex={-1}>
          <div className="l4cs-lista-grid">
            <div className="l4cs-lista-copy">
              <h2 className="l4cs-cta-title display" id="l4cs-lista-title">
                <span className="line">
                  <span>Acesso</span>
                </span>
                <span className="line">
                  <span>antecipado.</span>
                </span>
              </h2>
              <p className="l4cs-cta-text">
                Cadastre seu e-mail e seja avisado antes da abertura oficial. Quem estiver na lista recebe acesso ao Drop 01 antes da abertura pública.
              </p>
              <div className="l4cs-early">
                <span className="l4cs-early-big display">24h antes</span>
                <span className="l4cs-early-small">de todo mundo</span>
              </div>
            </div>

            <div className="l4cs-lista-card">
              {submitted ? (
                <div className="l4cs-done" ref={doneRef} tabIndex={-1} role="status">
                  <span className="l4cs-done-check" aria-hidden="true">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M5 12.5l4.5 4.5L19 7" />
                    </svg>
                  </span>
                  <p className="l4cs-done-title display">Você está na lista.</p>
                  <p className="l4cs-done-text">A gente avisa no seu e-mail 24h antes da abertura pública do Drop 01.</p>
                </div>
              ) : (
                <form onSubmit={handleSubmit} noValidate>
                  <label htmlFor="l4cs-email" className="l4cs-field-label">
                    Seu melhor e-mail
                  </label>
                  <div className="l4cs-field">
                    <input
                      ref={emailRef}
                      id="l4cs-email"
                      name="email"
                      type="email"
                      inputMode="email"
                      autoComplete="email"
                      placeholder="voce@email.com"
                      required
                      value={email}
                      onChange={(event) => {
                        setEmail(event.target.value);
                        if (error) setError("");
                      }}
                      aria-invalid={error ? true : undefined}
                      aria-describedby="l4cs-email-hint l4cs-consent"
                      disabled={loading}
                    />
                    <button type="submit" className="l4cs-submit" disabled={loading}>
                      {loading ? "Enviando..." : "Entrar na lista"}
                    </button>
                  </div>
                  <p id="l4cs-email-hint" className={`l4cs-hint${error ? " error" : ""}`} aria-live="polite">
                    {error || DEFAULT_HINT}
                  </p>
                  <p id="l4cs-consent" className="l4cs-consent">
                    Ao entrar na lista, você aceita receber e-mails da L4CKOS sobre o Drop 01. Dá pra sair quando quiser.
                  </p>
                </form>
              )}
              <div className="l4cs-socials">
                <a className="l4cs-btn l4cs-btn-sm magnetic" href={contactChannels.instagramUrl} target="_blank" rel="noreferrer">
                  Instagram
                </a>
                <a className="l4cs-btn l4cs-btn-sm magnetic" href={`mailto:${contactChannels.email}`}>
                  E-mail
                </a>
              </div>
            </div>
          </div>
        </section>
      </main>

      <footer className="l4cs-footer">
        <span>
          © {currentYear} L<span className="red">4</span>CKOS
        </span>
        <span>Drop 01. Built for Adventure.</span>
      </footer>
    </div>
  );
}
