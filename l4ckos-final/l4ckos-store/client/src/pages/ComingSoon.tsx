import { useEffect, useMemo, useState } from "react";
import { Instagram, Mail, MessageCircle } from "lucide-react";
import { apiUrl } from "../const";
import { csrfFetch } from "../lib/csrf";
import logoMarkDark from "../images/l4k-mark-dark-transparent.png";

type Countdown = { days: string; hours: string; minutes: string; seconds: string };
const STORE_OPENING_TARGET = new Date("2026-06-11T00:00:00-03:00").getTime();
const COUNTDOWN_REVEAL_DAYS = 21;

function pad(value: number) {
  return String(Math.max(0, value)).padStart(2, "0");
}

function isValidEmail(email: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function getCountdown(targetDate: number, now = Date.now()): Countdown {
  const diff = Math.max(0, targetDate - now);
  return {
    days: pad(Math.floor(diff / 86_400_000)),
    hours: pad(Math.floor((diff % 86_400_000) / 3_600_000)),
    minutes: pad(Math.floor((diff % 3_600_000) / 60_000)),
    seconds: pad(Math.floor((diff % 60_000) / 1_000)),
  };
}

export default function ComingSoon() {
  const targetDate = useMemo(() => STORE_OPENING_TARGET, []);
  const [countdown, setCountdown] = useState<Countdown>(() => getCountdown(targetDate));
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);
  const [successMessage, setSuccessMessage] = useState("");
  const [reservationCode, setReservationCode] = useState("");
  const [secondsFlash, setSecondsFlash] = useState(false);
  const [splashOut, setSplashOut] = useState(false);
  const [introDone, setIntroDone] = useState(false);

  useEffect(() => {
    const startOut = window.setTimeout(() => setSplashOut(true), 2200);
    const finish = window.setTimeout(() => setIntroDone(true), 2750);
    return () => {
      window.clearTimeout(startOut);
      window.clearTimeout(finish);
    };
  }, []);

  useEffect(() => {
    const id = window.setInterval(() => {
      setCountdown(getCountdown(targetDate));
      setSecondsFlash(true);
      window.setTimeout(() => setSecondsFlash(false), 120);
    }, 1000);
    return () => window.clearInterval(id);
  }, [targetDate]);

  function generateReservationCode() {
    const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    let out = "#L4K-";
    for (let i = 0; i < 4; i += 1) out += chars[Math.floor(Math.random() * chars.length)];
    return out;
  }

  const daysRemaining = useMemo(() => {
    const diff = Math.max(0, targetDate - Date.now());
    return Math.ceil(diff / 86_400_000);
  }, [targetDate, countdown.days, countdown.hours, countdown.minutes, countdown.seconds]);

  const shouldShowCountdown = daysRemaining <= COUNTDOWN_REVEAL_DAYS;

  async function handleSubmit() {
    const normalizedEmail = email.trim().toLowerCase();
    setError("");
    setSuccessMessage("");
    if (!isValidEmail(normalizedEmail)) {
      setError("Insira um e-mail valido.");
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
        throw new Error(data?.message || "Algo deu errado. Tente novamente.");
      }
      setSuccess(true);
      setReservationCode(generateReservationCode());
      setSuccessMessage(data?.message || "Você está na lista. Avisaremos quando a loja abrir.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Algo deu errado. Tente novamente.");
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
            Drop 01
          </div>
        </header>

        <section className="l4-coming-v2-hero">
          <div className="l4-coming-v2-drop-tag">// Lancamento oficial</div>
          <h1 className="l4-coming-v2-title">
            <span className="t1" data-t="ALGO">
              ALGO
            </span>
            <span className="t2">GRANDE</span>
            <span className="t3">VEM AI.</span>
          </h1>

          <div className="l4-coming-v2-divider" />
          <p className="l4-coming-v2-form-note" style={{ marginBottom: 12 }}>
            <strong>Abertura oficial:</strong> Em breve.
          </p>
          <p className="l4-coming-v2-desc">
            O primeiro drop da L4CKOS esta quase pronto.
            <br />
            Entre na lista e garanta <strong>acesso 24h antes</strong> de todo mundo.
          </p>
          {shouldShowCountdown ? (
            <div className="l4-coming-v2-countdown-wrap">
              <div className="l4-coming-v2-countdown-label">Contagem oficial iniciada</div>
              <div className="l4-coming-v2-countdown">
                <div className="cu">
                  <div className="cn">{countdown.days}</div>
                  <div className="cl">Dias</div>
                </div>
                <div className="csep">:</div>
                <div className="cu">
                  <div className="cn">{countdown.hours}</div>
                  <div className="cl">Hr</div>
                </div>
                <div className="csep">:</div>
                <div className="cu">
                  <div className="cn">{countdown.minutes}</div>
                  <div className="cl">Min</div>
                </div>
                <div className="csep">:</div>
                <div className="cu">
                  <div className={`cn ${secondsFlash ? "is-flash" : ""}`}>{countdown.seconds}</div>
                  <div className="cl">Seg</div>
                </div>
              </div>
            </div>
          ) : (
            <div className="l4-coming-v2-soon-panel">
              <div className="l4-coming-v2-soon-badge">EM BREVE</div>
              <p>
                Estamos preparando a abertura com calma para entregar um lançamento forte, confiável e com benefícios  reais
                para quem entrou primeiro.
              </p>
              <span>O contador aparece automaticamente quando estivermos na reta final.</span>
            </div>
          )}
        </section>

        {!success ? (
          <section className="l4-coming-v2-form-section">
            <div className="l4-coming-v2-form-heading">Reservar minha vaga</div>
            <div className="l4-coming-v2-input-wrap">
              <input
                className={`l4-coming-v2-email-in ${error ? "has-error" : ""}`}
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    void handleSubmit();
                  }
                }}
                placeholder="seu@email.com"
                autoComplete="email"
              />
              <button className="l4-coming-v2-cta-btn" type="button" onClick={() => void handleSubmit()} disabled={loading}>
                {loading ? "ENVIANDO..." : "GARANTIR ACESSO →"}
              </button>
            </div>
            {error ? <div className="l4-coming-v2-form-error">{error}</div> : null}

            <div className="l4-coming-v2-perks">
              <div className="perk">
                <div className="pk">24H</div>
                <div className="pd">Antes de todos</div>
              </div>
              <div className="perk">
                <div className="pk">15%</div>
                <div className="pd">Desconto exclusivo</div>
              </div>
              <div className="perk">
                <div className="pk">FRETE</div>
                <div className="pd">Grátis no 1° pedido</div>
              </div>
            </div>
            <div className="l4-coming-v2-form-note">Sem spam. Só avisamos quando abrir.</div>
          </section>
        ) : (
          <section className="l4-coming-v2-ok on">
            <div className="ok-box">
              <div className="ok-icon">OK</div>
              <div className="ok-txt">Vaga reservada - você está na lista</div>
            </div>
            <div className="ok-num">{reservationCode}</div>
            <div className="ok-sub">{successMessage || "Você será avisado primeiro quando abrir."}</div>
          </section>
        )}

        <footer className="l4-coming-v2-footer">
          <div className="f-copy">
            (c) 2026 <em>L4CKOS</em>
          </div>
          <div className="socials">
            <a href="https://instagram.com/l4ckos" target="_blank" rel="noreferrer" aria-label="Instagram L4CKOS">
              <Instagram size={14} />
              <span>Instagram</span>
            </a>
            <a href="https://wa.me/5561998030913" target="_blank" rel="noreferrer" aria-label="WhatsApp L4CKOS">
              <MessageCircle size={14} />
              <span>WhatsApp</span>
            </a>
            <a href="mailto:contato@l4ckos.com.br" aria-label="Email L4CKOS">
              <Mail size={14} />
              <span>E-mail</span>
            </a>
          </div>
        </footer>
      </div>
    </div>
  );
}
