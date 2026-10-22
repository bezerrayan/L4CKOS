import { useEffect, useRef } from "react";
import { Link } from "react-router-dom";
import "./Sobre.css";

const story = [
  {
    number: "01",
    title: "O começo",
    text: "O nome L4CKOS surgiu em um perfil criado entre amigos, que compartilhava momentos e experiências ligados à aventura.",
  },
  {
    number: "02",
    title: "A ideia",
    text: "A vontade de transformar essa identidade em uma marca de roupas fez o projeto ganhar uma nova forma.",
  },
  {
    number: "03",
    title: "Além do óbvio",
    text: "A inspiração inicial tem conexão com o escotismo e a vida ao ar livre, mas a L4CKOS não se limita a esse universo.",
  },
  {
    number: "04",
    title: "L4CKOS hoje",
    text: "Uma marca que une identidade urbana, movimento, experiências e aventura — dentro e fora da cidade.",
  },
];

const principles = [
  {
    number: "01",
    title: "Identidade",
    text: "Peças com personalidade e elementos reconhecíveis, sem depender de excessos para chamar atenção.",
  },
  {
    number: "02",
    title: "Qualidade com intenção",
    text: "Cada escolha de material, modelagem, acabamento e apresentação deve contribuir para a estética, o conforto e a durabilidade.",
  },
  {
    number: "03",
    title: "Movimento",
    text: "Aventura também acontece nas viagens, nos encontros, nas descobertas e no cotidiano urbano.",
  },
];

export default function Sobre() {
  const pageRef = useRef<HTMLElement>(null);

  useEffect(() => {
    window.scrollTo(0, 0);

    const page = pageRef.current;
    if (!page || !("IntersectionObserver" in window)) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    const targets = page.querySelectorAll<HTMLElement>("[data-reveal]");
    let observer: IntersectionObserver;

    try {
      observer = new IntersectionObserver(
        entries => {
          entries.forEach(entry => {
            if (!entry.isIntersecting) return;
            entry.target.classList.add("is-visible");
            observer.unobserve(entry.target);
          });
        },
        { threshold: 0.12, rootMargin: "0px 0px -48px 0px" },
      );

      targets.forEach(target => observer.observe(target));
      page.classList.add("is-reveal-ready");
    } catch {
      page.classList.remove("is-reveal-ready");
      return;
    }

    return () => observer.disconnect();
  }, []);

  return (
    <main className="l4-about" ref={pageRef}>
      <section className="l4-about-hero" aria-labelledby="about-title">
        <div className="l4-about-hero-backdrop" aria-hidden="true" />
        <div className="l4-about-gutter l4-about-hero-inner">
          <div className="l4-about-kicker" data-reveal>
            <span className="l4-about-kicker-mark" /> L4CKOS / NOSSA HISTÓRIA
          </div>
          <div className="l4-about-hero-grid">
            <div className="l4-about-hero-copy" data-reveal>
              <h1 id="about-title">
                <span className="l4-about-title-line">NÃO É SÓ SOBRE VESTIR.</span>
                <span className="l4-about-title-line">É SOBRE <em>CARREGAR IDENTIDADE.</em></span>
              </h1>
              <p>
                A L4CKOS é uma marca brasileira independente que une identidade urbana,
                movimento e aventura.
              </p>
            </div>
            <div className="l4-about-hero-mark" data-reveal aria-label="L4CKOS">
              <span className="l4-about-mark-index">IDENTIDADE EM MOVIMENTO</span>
              <span className="l4-about-mark-word">L<span>4</span>CKOS</span>
              <span className="l4-about-mark-rule" />
              <span className="l4-about-mark-foot">CIDADE <i>×</i> EXPLORAÇÃO</span>
            </div>
          </div>
          <a className="l4-about-scroll" href="#historia">
            <span>CONHEÇA A NOSSA HISTÓRIA</span><span aria-hidden="true">↓</span>
          </a>
        </div>
      </section>

      <section className="l4-about-story l4-about-gutter" id="historia" aria-labelledby="story-title">
        <div className="l4-about-section-heading" data-reveal>
          <span className="l4-about-overline">DE UMA IDEIA ENTRE AMIGOS</span>
          <h2 id="story-title">Uma história em movimento<span>.</span></h2>
        </div>
        <div className="l4-about-story-list">
          {story.map((item, index) => (
            <article className={`l4-about-story-item l4-about-story-item-${index + 1}`} key={item.number} data-reveal>
              <span className="l4-about-story-number">{item.number}</span>
              <h3>
                {item.title === "L4CKOS hoje" ? (
                  <>L<span className="l4-about-brand-four">4</span>CKOS hoje</>
                ) : item.title}
              </h3>
              <p>{item.text}</p>
              <span className="l4-about-story-accent" aria-hidden="true" />
            </article>
          ))}
        </div>
      </section>

      <section className="l4-about-statement" aria-labelledby="statement-title">
        <div className="l4-about-gutter l4-about-statement-inner" data-reveal>
          <span className="l4-about-overline">MAIS QUE UM LUGAR</span>
          <h2 id="statement-title">A aventura também é <span>construir o próprio caminho.</span></h2>
          <p>
            A inspiração ao ar livre segue presente, mas a identidade L4CKOS também vive
            na cidade, nas experiências e em tudo que nos coloca em movimento.
          </p>
        </div>
      </section>

      <section className="l4-about-principles l4-about-gutter" aria-labelledby="principles-title">
        <div className="l4-about-principles-heading" data-reveal>
          <span className="l4-about-overline">O QUE NOS ORIENTA</span>
          <h2 id="principles-title">Essência, em cada escolha.</h2>
        </div>
        <div className="l4-about-principles-list">
          {principles.map(item => (
            <article className="l4-about-principle" key={item.number} data-reveal>
              <span>{item.number}</span>
              <h3>{item.title}</h3>
              <p>{item.text}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="l4-about-founders l4-about-gutter" aria-labelledby="founders-title">
        <div className="l4-about-founders-intro" data-reveal>
          <span className="l4-about-overline">AS PESSOAS POR TRÁS DA L4CKOS</span>
          <h2 id="founders-title">Dois fundadores.<br /><span>Uma visão.</span></h2>
          <p>A L4CKOS é uma marca brasileira independente construída por Yan e Davi.</p>
          <p className="l4-about-founders-note">Dois fundadores. Uma marca em movimento.</p>
        </div>
        <div className="l4-about-founders-names" data-reveal aria-label="Fundadores: Yan e Davi">
          <span>YAN</span>
          <i aria-hidden="true">+</i>
          <span>DAVI</span>
        </div>
      </section>

      <section className="l4-about-closing" aria-labelledby="closing-title">
        <div className="l4-about-gutter l4-about-closing-inner" data-reveal>
          <span className="l4-about-overline">O PRIMEIRO PASSO DE MUITOS</span>
          <h2 id="closing-title">O caminho está<br /><span>só começando.</span></h2>
          <p>A primeira coleção representa o início de uma construção maior.</p>
          <p>Cada lançamento será uma nova parte desse caminho, explorando ideias, experiências e maneiras de expressar a identidade L4CKOS.</p>
          <Link className="l4-about-cta" to="/produtos">CONHECER OS PRODUTOS <span aria-hidden="true">→</span></Link>
        </div>
      </section>
    </main>
  );
}
