import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import "./CookiePreferences.css";

const CONSENT_KEY = "l4ckos:cookie-preferences";
/** CSS variable other fixed layers (CartDrawer) use to stay clear of the visible banner. */
export const COOKIE_BANNER_OFFSET_VAR = "--l4-cookie-banner-offset";
const POLICY_VERSION = "2026-06-24";

type StoredCookiePreferences = {
  version: string;
  decidedAt: string;
  status: "essential-only";
  categories: {
    necessary: true;
  };
};

const necessaryCookies = [
  {
    name: "app_session_id",
    provider: "L4CKOS",
    purpose: "Mantém o acesso à conta e protege áreas autenticadas.",
    duration: "Sessão configurada pelo servidor.",
    type: "Persistente durante a sessão configurada.",
  },
  {
    name: "l4ckos_csrf",
    provider: "L4CKOS",
    purpose: "Protege formulários e ações autenticadas contra CSRF.",
    duration: "Sessão configurada pelo servidor.",
    type: "Persistente durante a sessão configurada.",
  },
  {
    name: "oauth_state",
    provider: "L4CKOS / Google OAuth",
    purpose: "Valida temporariamente o retorno do login com Google.",
    duration: "Temporário, durante o fluxo de autenticação.",
    type: "Sessão/temporário.",
  },
  {
    name: "loja-escoteira:cart",
    provider: "L4CKOS",
    purpose: "Mantém os itens da sacola no navegador.",
    duration: "Até remoção pelo usuário ou limpeza do navegador.",
    type: "localStorage.",
  },
  {
    name: "l4ckos:cookie-preferences",
    provider: "L4CKOS",
    purpose: "Registra a preferência de cookies desta versão da política.",
    duration: "Até alteração da política ou limpeza do navegador.",
    type: "localStorage.",
  },
];

function readStoredPreferences() {
  if (typeof window === "undefined") return null;
  try {
    const parsed = JSON.parse(window.localStorage.getItem(CONSENT_KEY) || "null") as StoredCookiePreferences | null;
    return parsed?.version === POLICY_VERSION && parsed.status === "essential-only" ? parsed : null;
  } catch {
    return null;
  }
}

function saveEssentialPreferences() {
  const payload: StoredCookiePreferences = {
    version: POLICY_VERSION,
    decidedAt: new Date().toISOString(),
    status: "essential-only",
    categories: { necessary: true },
  };
  window.localStorage.setItem(CONSENT_KEY, JSON.stringify(payload));
  return payload;
}

export function openCookiePreferences() {
  window.dispatchEvent(new Event("l4ckos:open-cookie-preferences"));
}

export default function CookiePreferences() {
  const [visible, setVisible] = useState(false);
  const [panelOpen, setPanelOpen] = useState(false);
  const [savedMessage, setSavedMessage] = useState("");
  const panelRef = useRef<HTMLDivElement | null>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const bannerRef = useRef<HTMLElement | null>(null);
  const bannerShown = visible && !panelOpen;

  // Publish the banner's occupied height so fixed layers (the cart drawer) end above it
  // instead of being covered. Cleared as soon as the banner is gone. No consent is touched.
  useEffect(() => {
    const root = document.documentElement;
    const banner = bannerRef.current;
    if (!bannerShown || !banner) {
      root.style.removeProperty(COOKIE_BANNER_OFFSET_VAR);
      return;
    }
    const publish = () => {
      const top = banner.getBoundingClientRect().top;
      const occupied = Math.max(0, Math.ceil(window.innerHeight - top));
      root.style.setProperty(COOKIE_BANNER_OFFSET_VAR, `${occupied}px`);
    };
    publish();
    const observer = typeof ResizeObserver !== "undefined" ? new ResizeObserver(publish) : null;
    observer?.observe(banner);
    window.addEventListener("resize", publish);
    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", publish);
      root.style.removeProperty(COOKIE_BANNER_OFFSET_VAR);
    };
  }, [bannerShown]);

  useEffect(() => {
    setVisible(!readStoredPreferences());

    const open = () => {
      previousFocusRef.current = document.activeElement as HTMLElement | null;
      setVisible(true);
      setPanelOpen(true);
      setSavedMessage("");
    };

    window.addEventListener("l4ckos:open-cookie-preferences", open);
    return () => window.removeEventListener("l4ckos:open-cookie-preferences", open);
  }, []);

  useEffect(() => {
    if (!panelOpen) return;

    const focusableSelector = "a[href], button:not([disabled]), textarea, input, select, [tabindex]:not([tabindex='-1'])";
    const timer = window.setTimeout(() => {
      const first = panelRef.current?.querySelector<HTMLElement>(focusableSelector);
      first?.focus();
    }, 0);

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setPanelOpen(false);
        previousFocusRef.current?.focus();
        return;
      }

      if (event.key !== "Tab" || !panelRef.current) return;
      const focusable = Array.from(panelRef.current.querySelectorAll<HTMLElement>(focusableSelector));
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];

      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }

    document.addEventListener("keydown", onKeyDown);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [panelOpen]);

  function persistChoice(closePanel = true) {
    saveEssentialPreferences();
    setSavedMessage("Preferências salvas.");
    setVisible(false);
    if (closePanel) {
      setPanelOpen(false);
      previousFocusRef.current?.focus();
    }
  }

  return (
    <>
      {visible && !panelOpen ? (
        <section ref={bannerRef} className="l4-cookie-banner" data-l4-cookie-banner aria-labelledby="cookie-banner-title">
          <div>
            <h2 id="cookie-banner-title">COOKIES ESSENCIAIS</h2>
            <p>
              Utilizamos cookies necessários para manter sua sessão, sua sacola e os recursos de segurança da loja funcionando corretamente.
            </p>
          </div>
          <div className="l4-cookie-actions">
            <Link className="l4-cookie-text-link" to="/privacidade#cookies">SAIBA MAIS</Link>
            <button type="button" onClick={() => persistChoice()}>
              ENTENDI
            </button>
          </div>
        </section>
      ) : null}

      {panelOpen ? (
        <div className="l4-cookie-modal-backdrop" role="presentation">
          <div
            className="l4-cookie-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="cookie-modal-title"
            aria-describedby="cookie-modal-description"
            ref={panelRef}
          >
            <div className="l4-cookie-modal-head">
              <div>
                <h2 id="cookie-modal-title">PREFERÊNCIAS DE COOKIES</h2>
                <p id="cookie-modal-description">
                  Escolha quais categorias opcionais você autoriza. No momento, a L4CKOS utiliza apenas cookies e armazenamentos necessários.
                </p>
              </div>
              <button type="button" className="l4-cookie-close" onClick={() => setPanelOpen(false)} aria-label="Fechar preferências de cookies">
                ×
              </button>
            </div>

            <section className="l4-cookie-category">
              <div>
                <h3>Cookies necessários</h3>
                <p>
                  Permanecem ativos porque são indispensáveis ao funcionamento da loja, à segurança, à sacola e à autenticação.
                </p>
              </div>
              <span>Sempre ativos</span>
            </section>

            <div className="l4-cookie-table-wrap" aria-label="Cookies e armazenamentos necessários">
              <table className="l4-cookie-table">
                <thead>
                  <tr>
                    <th>Nome</th>
                    <th>Provedor</th>
                    <th>Finalidade</th>
                    <th>Duração</th>
                    <th>Tipo</th>
                  </tr>
                </thead>
                <tbody>
                  {necessaryCookies.map(cookie => (
                    <tr key={cookie.name}>
                      <td>{cookie.name}</td>
                      <td>{cookie.provider}</td>
                      <td>{cookie.purpose}</td>
                      <td>{cookie.duration}</td>
                      <td>{cookie.type}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <p className="l4-cookie-note">
              Não foram identificados cookies analíticos, marketing comportamental, pixels ou ferramentas de gravação de sessão carregados no site público.
            </p>

            <div className="l4-cookie-modal-actions">
              <button type="button" className="secondary" onClick={() => persistChoice()}>
                REJEITAR NÃO ESSENCIAIS
              </button>
              <button type="button" onClick={() => persistChoice()}>
                SALVAR PREFERÊNCIAS
              </button>
            </div>
            <p className="l4-cookie-live" aria-live="polite">{savedMessage}</p>
          </div>
        </div>
      ) : null}
    </>
  );
}
