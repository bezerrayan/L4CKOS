import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import "./CookiePreferences.css";

const CONSENT_KEY = "l4ckos:cookie-preferences";
const POLICY_VERSION = "2026-06-24";

type StoredCookiePreferences = {
  version: string;
  decidedAt: string;
  status: "essential-only";
  categories: {
    necessary: true;
  };
};

const cookies = [
  {
    name: "app_session_id",
    purpose: "Mantém o acesso à conta e protege áreas autenticadas.",
    duration: "Duração configurada pelo servidor.",
  },
  {
    name: "l4ckos_csrf",
    purpose: "Protege formulários e ações autenticadas contra CSRF.",
    duration: "Duração configurada pelo servidor.",
  },
  {
    name: "oauth_state",
    purpose: "Valida temporariamente o retorno do login com Google.",
    duration: "Temporário, durante o fluxo de autenticação.",
  },
  {
    name: "sidebar_state",
    purpose: "Guarda o estado aberto/fechado de uma barra lateral quando o componente é utilizado.",
    duration: "Até 7 dias.",
  },
];

const browserStorage = [
  {
    name: "loja-escoteira:cart",
    purpose: "Mantém os itens da sacola no navegador.",
    duration: "Até remoção pelo usuário ou limpeza do navegador.",
    type: "localStorage",
  },
  {
    name: "l4ckos:cookie-preferences",
    purpose: "Registra localmente que o aviso foi encerrado; não controla o carregamento de scripts de medição.",
    duration: "Permanece até limpeza do navegador; uma nova versão pode solicitar uma nova escolha sem remover o registro anterior.",
    type: "localStorage",
  },
  {
    name: "app-user-info",
    purpose: "Cache local de dados retornados pela consulta da conta autenticada.",
    duration: "Removido quando essa consulta não retorna usuário autenticado.",
    type: "localStorage",
  },
  {
    name: "theme / sidebar-width",
    purpose: "Preferências da interface em componentes administrativos que as utilizam.",
    duration: "Até alteração ou limpeza do navegador.",
    type: "localStorage",
  },
  {
    name: "l4ckos:checkout-attempt:[digest]",
    purpose: "Mantém UUID e hash derivados da solicitação para identificar tentativa de checkout em caso de repetição; o armazenamento não grava os campos brutos da solicitação.",
    duration: "sessionStorage; permanece na sessão do navegador.",
    type: "sessionStorage",
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

export default function CookiePreferences({ adminLayout = false }: { adminLayout?: boolean }) {
  const [visible, setVisible] = useState(false);
  const [panelOpen, setPanelOpen] = useState(false);
  const [savedMessage, setSavedMessage] = useState("");
  const panelRef = useRef<HTMLDivElement | null>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);

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
    setSavedMessage("Aviso encerrado e registro local atualizado.");
    setVisible(false);
    if (closePanel) {
      setPanelOpen(false);
      previousFocusRef.current?.focus();
    }
  }

  function closePanel() {
    setPanelOpen(false);
    previousFocusRef.current?.focus();
  }

  return (
    <>
      {visible && !panelOpen ? (
        <section className={`l4-cookie-banner${adminLayout ? " l4-cookie-banner--admin" : ""}`} aria-labelledby="cookie-banner-title">
          <div>
            <h2 id="cookie-banner-title">AVISO SOBRE COOKIES</h2>
            <p>
              O site usa cookies de sessão e segurança e armazenamento local para a sacola e preferências. O código local desta versão não carrega o Google Analytics; integrações injetadas fora do frontend não foram verificadas.
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
                <h2 id="cookie-modal-title">INFORMAÇÕES SOBRE COOKIES</h2>
                <p id="cookie-modal-description">
                  Esta interface não oferece seleção por categoria. O botão “Entendi” oculta o aviso e registra essa ação no navegador; não configura consentimento de medição. O frontend desta versão não carrega o Google Analytics.
                </p>
              </div>
              <button type="button" className="l4-cookie-close" onClick={closePanel} aria-label="Fechar informações sobre cookies">
                ×
              </button>
            </div>

            <section className="l4-cookie-category">
              <div>
                <h3>Cookies do site</h3>
                <p>Os cookies abaixo são definidos por recursos do site; sua finalidade e duração dependem da função descrita.</p>
              </div>
            </section>

            <ul className="l4-cookie-inventory">
              {cookies.map(cookie => <li key={cookie.name}><code>{cookie.name}</code><span>{cookie.purpose} {cookie.duration}</span></li>)}
            </ul>

            <section className="l4-cookie-category l4-cookie-category--storage">
              <div>
                <h3>Armazenamento do navegador — não são cookies</h3>
                <p>O navegador também guarda dados em localStorage ou sessionStorage para recursos próprios da loja.</p>
              </div>
            </section>

            <ul className="l4-cookie-inventory">
              {browserStorage.map(item => <li key={item.name}><code>{item.name} · {item.type}</code><span>{item.purpose} {item.duration}</span></li>)}
            </ul>

            <p className="l4-cookie-note">
              O Google Analytics identificado anteriormente está desativado neste código local: o frontend não carrega a tag nem encaminha eventos a um coletor. Este aviso não confirma o comportamento de outros ambientes ou de scripts injetados fora do frontend versionado. Consulte a Política de Privacidade para detalhes.
            </p>

            <div className="l4-cookie-modal-actions">
              <button type="button" className="secondary" onClick={closePanel}>
                FECHAR SEM SALVAR
              </button>
              <button type="button" onClick={() => persistChoice()}>
                ENTENDI E FECHAR
              </button>
            </div>
            <p className="l4-cookie-live" aria-live="polite">{savedMessage}</p>
          </div>
        </div>
      ) : null}
    </>
  );
}
