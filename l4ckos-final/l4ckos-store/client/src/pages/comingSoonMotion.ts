/*
 * Animações da Coming Soon (Drop 01), portadas do protótipo aprovado.
 * Este módulo só é carregado sob demanda: o GSAP fica num chunk próprio e a
 * página já é completa e estática sem ele. Tudo roda dentro de gsap.context()
 * e é desfeito no cleanup (ScrollTriggers, pins, estilos inline e listeners).
 */
import { gsap } from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";

type MotionOptions = {
  /** Chamado quando a abertura termina (ou é abortada) para remover o loader. */
  onIntroDone: () => void;
};

export function startComingSoonMotion(root: HTMLElement, { onIntroDone }: MotionOptions): () => void {
  gsap.registerPlugin(ScrollTrigger);
  ScrollTrigger.config({ ignoreMobileResize: true });

  const html = document.documentElement;
  const previousScrollBehavior = html.style.scrollBehavior;
  const previousBodyOverflow = document.body.style.overflow;
  // O scroll-behavior: smooth global atrapalha os pins do ScrollTrigger.
  html.style.scrollBehavior = "auto";
  document.body.style.overflow = "hidden";

  let introFinished = false;
  const listeners: Array<() => void> = [];
  const finishIntro = () => {
    if (introFinished) return;
    introFinished = true;
    document.body.style.overflow = previousBodyOverflow;
    onIntroDone();
    ScrollTrigger.refresh();
  };

  root.classList.add("is-motion");
  const q = gsap.utils.selector(root);

  const ctx = gsap.context(() => {
    const loader = root.querySelector<HTMLElement>(".l4cs-loader");
    const loaderLogo = root.querySelector<HTMLElement>(".l4cs-loader-logo");
    const brand = root.querySelector<HTMLElement>(".l4cs-brand");
    const brandImg = root.querySelector<HTMLElement>(".l4cs-brand img");

    /* Linhas topográficas: preparar para "desenhar" */
    const topoEls = q<SVGGeometryElement>(".l4cs-topo path, .l4cs-topo ellipse");
    topoEls.forEach((el) => {
      const len = typeof el.getTotalLength === "function" ? el.getTotalLength() : 2000;
      gsap.set(el, { strokeDasharray: len, strokeDashoffset: len });
    });

    /* Abertura */
    gsap.set(q(".l4cs-hw"), { yPercent: 105 });
    gsap.set(q(".l4cs-hero-foot > *"), { y: 24, opacity: 0 });

    const intro = gsap.timeline({ onComplete: finishIntro });

    if (loader && loaderLogo && brand && brandImg) {
      gsap.set(brand, { opacity: 0 });
      // Etapas 1–4 (montagem do logo) rodam em CSS desde o primeiro paint; aqui
      // só sincronizamos o voo com o tempo já decorrido dessa animação.
      const cssIntro = q<HTMLElement>(".lg-4")[0]?.getAnimations?.()[0];
      const elapsed = typeof cssIntro?.currentTime === "number" ? cssIntro.currentTime / 1000 : 0;
      const flyAt = Math.max(0, 2.25 - elapsed);
      intro
        /* 5. o logo voa até o cabeçalho */
        .add(() => {
          const from = loaderLogo.getBoundingClientRect();
          const to = brandImg.getBoundingClientRect();
          const k = from.width > 0 ? to.width / from.width : 1;
          gsap
            .timeline()
            .to(loaderLogo, {
              x: to.left + to.width / 2 - (from.left + from.width / 2),
              y: to.top + to.height / 2 - (from.top + from.height / 2),
              scale: k,
              duration: 0.95,
              ease: "expo.inOut",
            })
            .to(loader, { backgroundColor: "rgba(0,0,0,0)", duration: 0.6, ease: "power2.out" }, 0.35)
            .set(brand, { opacity: 1 })
            .set(loader, { display: "none" });
        }, flyAt)
        .to(q(".l4cs-hw"), { yPercent: 0, stagger: 0.12, duration: 1.1, ease: "expo.out" }, flyAt + 0.65);
    } else {
      intro.to(q(".l4cs-hw"), { yPercent: 0, stagger: 0.12, duration: 1.1, ease: "expo.out" });
    }

    intro
      .to(topoEls, { strokeDashoffset: 0, duration: 2.6, stagger: 0.08, ease: "power2.out" }, "-=0.9")
      .to(q(".l4cs-hero-foot > *"), { y: 0, opacity: 1, stagger: 0.1, duration: 0.7, ease: "power3.out" }, "-=2.2");

    /* Hero: as linhas se separam e somem ao rolar (sem prender a página) */
    const heroOut = () => ({ trigger: q(".l4cs-hero")[0], start: "top top", end: "bottom top", scrub: 0.5 });
    gsap.fromTo(q(".l4cs-hl1"), { xPercent: 0 }, { xPercent: -10, ease: "none", scrollTrigger: heroOut() });
    gsap.fromTo(q(".l4cs-hl2"), { xPercent: 0 }, { xPercent: 12, ease: "none", scrollTrigger: heroOut() });
    gsap.fromTo(q(".l4cs-hl3"), { xPercent: 0 }, { xPercent: -16, ease: "none", scrollTrigger: heroOut() });
    gsap.fromTo(q(".l4cs-hero-main"), { opacity: 1, y: 0 }, { opacity: 0.1, y: -80, ease: "none", scrollTrigger: heroOut() });
    gsap.fromTo(q(".l4cs-topo"), { yPercent: 0 }, { yPercent: 18, ease: "none", scrollTrigger: heroOut() });

    /* Manifesto: o bloco vermelho se abre como cortina */
    const manifesto = q(".l4cs-manifesto")[0];
    gsap.fromTo(
      manifesto,
      { clipPath: "inset(14% 8% 0% 8% round 28px)" },
      {
        clipPath: "inset(0% 0% 0% 0% round 0px)",
        ease: "none",
        scrollTrigger: { trigger: manifesto, start: "top bottom", end: "top top", scrub: true },
      },
    );

    /* Manifesto: palavras acendem com o scroll */
    gsap.set(q(".l4cs-w"), { opacity: 0.22 });
    gsap
      .timeline({ scrollTrigger: { trigger: manifesto, start: "top top", end: "+=110%", pin: true, scrub: 0.5 } })
      .to(q(".l4cs-w"), { opacity: 1, stagger: 0.05, duration: 0.3, ease: "none" });

    /* Título do Drop */
    const dropIntro = q(".l4cs-drop-intro")[0];
    gsap.from(q(".l4cs-drop-title"), { yPercent: 30, opacity: 0, duration: 1.1, ease: "expo.out", scrollTrigger: { trigger: dropIntro, start: "top 75%" } });
    gsap.from(q(".l4cs-drop-lead"), { y: 24, opacity: 0, duration: 0.8, ease: "power3.out", scrollTrigger: { trigger: dropIntro, start: "top 65%" } });

    /* Leque: as três camisetas se abrem antes da rolagem horizontal */
    const isNarrow = () => window.innerWidth < 761;
    gsap.set(q(".l4cs-fan img"), { transform: "none" });
    gsap.set(q(".l4cs-fan img"), { xPercent: -50, x: 0, rotate: 0 });
    gsap.set(q(".l4cs-fan .f1, .l4cs-fan .f3"), { y: 24, scale: 0.94 });
    gsap
      .timeline({ scrollTrigger: { trigger: q(".l4cs-fan")[0], start: "top 85%", end: "bottom 55%", scrub: 0.6, invalidateOnRefresh: true } })
      .to(q(".l4cs-fan .f1"), { xPercent: () => (isNarrow() ? -112 : -140), rotate: -9, y: 0, scale: 1, ease: "power2.out" }, 0)
      .to(q(".l4cs-fan .f3"), { xPercent: () => (isNarrow() ? 12 : 40), rotate: 9, y: 0, scale: 1, ease: "power2.out" }, 0)
      .fromTo(q(".l4cs-fan .f2"), { y: 60 }, { y: -10, ease: "power2.out" }, 0);

    /* Drop 01: rolagem horizontal pelos três territórios */
    const track = q(".l4cs-track")[0];
    const panelsEl = q(".l4cs-panels")[0];
    const bar = q(".l4cs-progress-bar")[0];
    const dist = () => panelsEl.scrollWidth - window.innerWidth;

    const hTween = gsap.to(panelsEl, {
      x: () => -dist(),
      ease: "none",
      scrollTrigger: {
        trigger: track,
        start: "top top",
        end: () => `+=${dist()}`,
        pin: true,
        scrub: 0.8,
        invalidateOnRefresh: true,
        onUpdate: (self) => gsap.set(bar, { scaleX: self.progress }),
      },
    });

    const panels = q<HTMLElement>(".l4cs-panel");
    panels.forEach((panel, index) => {
      // Teclado: ao focar algo num painel fora da tela, rola até ele.
      const onFocusIn = () => {
        track.scrollLeft = 0;
        panel.scrollLeft = 0;
        const st = hTween.scrollTrigger;
        if (!st || panels.length < 2) return;
        const target = st.start + ((st.end - st.start) * index) / (panels.length - 1);
        if (Math.abs(window.scrollY - target) > 4) window.scrollTo(0, target);
      };
      panel.addEventListener("focusin", onFocusIn);
      listeners.push(() => panel.removeEventListener("focusin", onFocusIn));
    });

    panels.forEach((panel) => {
      const ps = gsap.utils.selector(panel);
      const ca = () => ({ trigger: panel, containerAnimation: hTween, start: "left right", end: "right left", scrub: true });
      gsap.fromTo(ps(".l4cs-panel-bg"), { xPercent: 8 }, { xPercent: -22, ease: "none", scrollTrigger: ca() });
      gsap.fromTo(ps(".l4cs-flip"), { rotate: -7, y: 40, scale: 0.9 }, { rotate: 5, y: -24, scale: 1, ease: "none", scrollTrigger: ca() });
      gsap.fromTo(ps(".l4cs-detail"), { y: 90 }, { y: -60, ease: "none", scrollTrigger: ca() });

      const topo = ps<SVGGeometryElement>(".l4cs-panel-topo path, .l4cs-panel-topo ellipse");
      if (topo.length) {
        topo.forEach((el) => {
          const len = el.getTotalLength();
          gsap.set(el, { strokeDasharray: len, strokeDashoffset: len });
        });
        gsap.to(topo, {
          strokeDashoffset: 0,
          ease: "none",
          stagger: 0.05,
          scrollTrigger: { trigger: panel, containerAnimation: hTween, start: "left right", end: "left left", scrub: true },
        });
      }

      gsap.from(ps(".reveal"), {
        y: 50,
        opacity: 0,
        stagger: 0.07,
        duration: 0.8,
        ease: "expo.out",
        scrollTrigger: { trigger: panel, containerAnimation: hTween, start: "left 55%", toggleActions: "play none none reverse" },
      });
      gsap.from(ps(".l4cs-detail"), {
        scale: 0.6,
        opacity: 0,
        duration: 0.9,
        ease: "back.out(1.6)",
        delay: 0.25,
        scrollTrigger: { trigger: panel, containerAnimation: hTween, start: "left 55%", toggleActions: "play none none reverse" },
      });
    });

    /* Faixa: acelera e inverte com a velocidade do scroll */
    const band = gsap.to(q(".l4cs-band-inner"), { xPercent: -50, duration: 26, ease: "none", repeat: -1 });
    ScrollTrigger.create({
      start: 0,
      end: "max",
      onUpdate: (self) => {
        const v = self.getVelocity();
        const dir = self.direction;
        band.timeScale(dir * (1 + Math.min(Math.abs(v) / 250, 6)));
        gsap.to(band, { timeScale: dir, duration: 0.8, ease: "power2.out", overwrite: true });
      },
    });

    /* Acesso antecipado */
    const lista = q(".l4cs-lista")[0];
    gsap.from(q(".l4cs-cta-title .line > span"), { yPercent: 110, duration: 1.1, stagger: 0.12, ease: "expo.out", scrollTrigger: { trigger: lista, start: "top 70%" } });
    gsap.from(q(".l4cs-lista-copy .l4cs-cta-text, .l4cs-early"), { y: 24, opacity: 0, duration: 0.8, stagger: 0.12, ease: "power3.out", scrollTrigger: { trigger: lista, start: "top 60%" } });
    gsap.from(q(".l4cs-lista-card"), { y: 60, opacity: 0, rotate: 1.5, duration: 1, ease: "expo.out", scrollTrigger: { trigger: lista, start: "top 60%" } });
    gsap.fromTo(q(".l4cs-early-big"), { scale: 0.85 }, { scale: 1, ease: "none", scrollTrigger: { trigger: q(".l4cs-early")[0], start: "top bottom", end: "top 50%", scrub: true } });

    /* Botões magnéticos (só com mouse) */
    if (window.matchMedia("(pointer: fine)").matches) {
      q<HTMLElement>(".magnetic").forEach((button) => {
        const onMove = (event: PointerEvent) => {
          const r = button.getBoundingClientRect();
          gsap.to(button, { x: (event.clientX - r.left - r.width / 2) * 0.3, y: (event.clientY - r.top - r.height / 2) * 0.4, duration: 0.4, ease: "power3.out" });
        };
        const onLeave = () => gsap.to(button, { x: 0, y: 0, duration: 0.7, ease: "elastic.out(1, 0.4)" });
        button.addEventListener("pointermove", onMove);
        button.addEventListener("pointerleave", onLeave);
        listeners.push(() => {
          button.removeEventListener("pointermove", onMove);
          button.removeEventListener("pointerleave", onLeave);
        });
      });
    }
  }, root);

  // O refresh do ScrollTrigger reembrulha os elementos fixados (pin-spacer) e o
  // navegador tira o foco do que estava dentro deles: devolvemos o foco depois.
  let focusedBeforeRefresh: HTMLElement | null = null;
  const onRefreshInit = () => {
    const active = document.activeElement;
    focusedBeforeRefresh = active instanceof HTMLElement && root.contains(active) ? active : null;
  };
  const onRefresh = () => {
    const el = focusedBeforeRefresh;
    focusedBeforeRefresh = null;
    if (el && el.isConnected && document.activeElement !== el) el.focus({ preventScroll: true });
  };
  ScrollTrigger.addEventListener("refreshInit", onRefreshInit);
  ScrollTrigger.addEventListener("refresh", onRefresh);
  listeners.push(() => {
    ScrollTrigger.removeEventListener("refreshInit", onRefreshInit);
    ScrollTrigger.removeEventListener("refresh", onRefresh);
  });

  let disposed = false;
  if (document.fonts?.ready) {
    void document.fonts.ready.then(() => {
      if (!disposed) ScrollTrigger.refresh();
    });
  }

  // Âncoras internas: rolagem suave manual, já que o smooth global foi desligado.
  const onAnchorClick = (event: MouseEvent) => {
    const anchor = (event.target as Element | null)?.closest?.('a[href^="#"]');
    if (!anchor || !root.contains(anchor)) return;
    const id = anchor.getAttribute("href")?.slice(1);
    const target = id ? root.querySelector<HTMLElement>(`#${CSS.escape(id)}`) : null;
    if (!target) return;
    event.preventDefault();
    window.scrollTo({ top: target.getBoundingClientRect().top + window.scrollY, behavior: "smooth" });
    target.focus({ preventScroll: true });
  };
  root.addEventListener("click", onAnchorClick);

  return () => {
    disposed = true;
    root.removeEventListener("click", onAnchorClick);
    listeners.forEach((off) => off());
    ctx.revert();
    root.classList.remove("is-motion");
    html.style.scrollBehavior = previousScrollBehavior;
    document.body.style.overflow = previousBodyOverflow;
  };
}
