import { FormEvent, useEffect, useState } from "react";
import { Instagram, Mail, MessageCircle } from "lucide-react";
import { apiUrl } from "../const";
import { contactChannels, getWhatsAppUrl } from "../config/site";
import { csrfFetch } from "../lib/csrf";
import logoMarkDark from "../images/l4k-mark-dark-transparent.png";

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

export default function ComingSoon() {
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [successMessage, setSuccessMessage] = useState("");
  const [splashOut, setSplashOut] = useState(false);
  const [introDone, setIntroDone] = useState(false);
  const currentYear = new Date().getFullYear();
  const whatsappUrl = getWhatsAppUrl();

  useEffect(() => {
    const startOut = window.setTimeout(() => setSplashOut(true), 900);
    const finish = window.setTimeout(() => setIntroDone(true), 1250);
    return () => {
      window.clearTimeout(startOut);
      window.clearTimeout(finish);
    };
  }, []);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const normalizedEmail = email.trim().toLowerCase();
    setError("");
    setSuccessMessage("");

    if (!isValidEmail(normalizedEmail)) {
      setError("Digite um e-mail válido.");
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
      setSuccessMessage("Cadastro realizado. Você está na lista.");
      setEmail("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível concluir o cadastro agora. Tente novamente.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="l4-coming-v2-root">
      <div className="l4-coming-v2-glow-top" />
      <div className="l4-coming-v2-glow-bot" />
      <div className="l4-coming-v2-grid-bg" />

      {!introDone && (
        <div className={`l4-coming-v2-splash ${splashOut ? "is-out" : ""}`}>
          <div className="l4-coming-v2-splash-stage">
            <img className="l4-coming-v2-splash-word-l4" src={logoMarkDark} alt="L4K" />
          </div>
        </div>
      )}

      <div className={`l4-coming-v2-shell ${introDone ? "is-ready" : ""}`}>
        <header className="l4-coming-v2-header">
          <a className="l4-coming-v2-logo-text" href="/">
            <img src={logoMarkDark} alt="L4K" />
          </a>
          <div className="l4-coming-v2-live-pill">
            <span className="dot" />
            DROP 01 — EM BREVE
          </div>
        </header>

        <main className="l4-coming-v2-main">
          <section className="l4-coming-v2-hero" aria-labelledby="coming-soon-title">
            <div className="l4-coming-v2-drop-tag">// LANÇAMENTO OFICIAL</div>
            <h1 id="coming-soon-title" className="l4-coming-v2-title">
              <span className="t1">ALGO</span>
              <span className="t2">GRANDE</span>
              <span className="t3">VEM AÍ.</span>
            </h1>

            <div className="l4-coming-v2-divider" />
            <p className="l4-coming-v2-desc">
              O primeiro drop da L4CKOS está sendo preparado.
              <br />
              Entre na lista para receber acesso antecipado ao lançamento.
            </p>
          </section>

          <aside className="l4-coming-v2-panel" aria-labelledby="coming-soon-form-title">
            <div className="l4-coming-v2-panel-line" aria-hidden="true" />
            <h2 className="l4-coming-v2-form-heading" id="coming-soon-form-title">
              ACESSO ANTECIPADO
            </h2>
            <p className="l4-coming-v2-panel-copy">Cadastre seu e-mail e seja avisado antes da abertura oficial.</p>

            <form className="l4-coming-v2-form" onSubmit={handleSubmit}>
              <label className="l4-coming-v2-label" htmlFor="coming-email">
                Seu melhor e-mail
              </label>
              <div className="l4-coming-v2-input-wrap">
                <input
                  id="coming-email"
                  className={`l4-coming-v2-email-in ${error ? "has-error" : ""}`}
                  type="email"
                  value={email}
                  onChange={(event) => {
                    setEmail(event.target.value);
                    if (error) setError("");
                    if (successMessage) setSuccessMessage("");
                  }}
                  autoComplete="email"
                  inputMode="email"
                  placeholder="voce@email.com"
                  aria-invalid={Boolean(error)}
                  aria-describedby="coming-form-feedback"
                  disabled={loading}
                />
                <button className="l4-coming-v2-cta-btn" type="submit" disabled={loading || !isValidEmail(email.trim())}>
                  {loading ? "ENVIANDO..." : "ENTRAR NA LISTA"}
                </button>
              </div>
              <p
                id="coming-form-feedback"
                className={`l4-coming-v2-form-feedback ${error ? "is-error" : ""} ${successMessage ? "is-success" : ""}`}
                aria-live="polite"
              >
                {error || successMessage || "Sem spam. Apenas novidades importantes sobre o lançamento."}
              </p>
            </form>

            <div className="l4-coming-v2-perks">
              <div className="perk">
                <div className="pk">24H ANTES</div>
                <div className="pd">ACESSO ANTECIPADO</div>
              </div>
            </div>
            <p className="l4-coming-v2-perk-note">
              Quem estiver na lista receberá acesso ao Drop 01 antes da abertura pública.
            </p>

            <div className="l4-coming-v2-socials" aria-label="Contatos L4CKOS">
              <a href={contactChannels.instagramUrl} target="_blank" rel="noreferrer" aria-label="Instagram L4CKOS">
                <Instagram size={15} aria-hidden="true" />
                <span>Instagram</span>
              </a>
              {whatsappUrl ? (
                <a href={whatsappUrl} target="_blank" rel="noreferrer" aria-label="WhatsApp L4CKOS">
                  <MessageCircle size={15} aria-hidden="true" />
                  <span>WhatsApp</span>
                </a>
              ) : null}
              <a href={`mailto:${contactChannels.email}`} aria-label="Email L4CKOS">
                <Mail size={15} aria-hidden="true" />
                <span>E-mail</span>
              </a>
            </div>
          </aside>
        </main>

        <footer className="l4-coming-v2-footer">
          <div className="f-copy">
            © {currentYear} <em>L4CKOS</em>
          </div>
          <span>DROP 01 — BUILT FOR ADVENTURE</span>
        </footer>
      </div>
    </div>
  );
}
