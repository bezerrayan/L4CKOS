import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import "./CookiePreferences.css";

const CONSENT_KEY = "l4ckos:cookie-preferences";
const POLICY_VERSION = "2026-09-05";

type StoredCookiePreferences = { version: string; decidedAt: string; status: "essential-only"; categories: { necessary: true } };

// SESSION_COOKIE_NAME is environment-configurable in the RC, so its inventory
// deliberately avoids a false, fixed cookie name.
const necessaryCookies = [
  { name: "Cookie de sessão configurado pelo ambiente", provider: "L4CKOS", purpose: "Mantém o acesso à conta e protege áreas autenticadas.", duration: "Conforme configuração segura do servidor.", type: "Cookie de sessão." },
  { name: "Cookie CSRF da L4CKOS", provider: "L4CKOS", purpose: "Protege ações autenticadas contra CSRF.", duration: "Conforme configuração segura do servidor.", type: "Cookie de segurança." },
  { name: "oauth_state", provider: "L4CKOS / Google OAuth", purpose: "Valida temporariamente o retorno do login com Google.", duration: "Temporário, durante o fluxo de autenticação.", type: "Sessão/temporário." },
  { name: "loja-escoteira:cart", provider: "L4CKOS", purpose: "Mantém os itens da sacola no navegador.", duration: "Até remoção pelo usuário ou limpeza do navegador.", type: "localStorage." },
  { name: CONSENT_KEY, provider: "L4CKOS", purpose: "Registra a preferência de cookies desta versão da política.", duration: "Até alteração da política ou limpeza do navegador.", type: "localStorage." },
];

function readStoredPreferences() {
  if (typeof window === "undefined") return null;
  try {
    const parsed = JSON.parse(window.localStorage.getItem(CONSENT_KEY) || "null") as StoredCookiePreferences | null;
    return parsed?.version === POLICY_VERSION && parsed.status === "essential-only" ? parsed : null;
  } catch { return null; }
}

function saveEssentialPreferences() {
  window.localStorage.setItem(CONSENT_KEY, JSON.stringify({ version: POLICY_VERSION, decidedAt: new Date().toISOString(), status: "essential-only", categories: { necessary: true } } satisfies StoredCookiePreferences));
}

export function openCookiePreferences() { window.dispatchEvent(new Event("l4ckos:open-cookie-preferences")); }

export default function CookiePreferences() {
  const [visible, setVisible] = useState(false);
  const [panelOpen, setPanelOpen] = useState(false);
  const [savedMessage, setSavedMessage] = useState("");
  const panelRef = useRef<HTMLDivElement | null>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    setVisible(!readStoredPreferences());
    const open = () => { previousFocusRef.current = document.activeElement as HTMLElement | null; setVisible(true); setPanelOpen(true); setSavedMessage(""); };
    window.addEventListener("l4ckos:open-cookie-preferences", open);
    return () => window.removeEventListener("l4ckos:open-cookie-preferences", open);
  }, []);

  useEffect(() => {
    if (!panelOpen) return;
    const selector = "a[href], button:not([disabled]), textarea, input, select, [tabindex]:not([tabindex='-1'])";
    const timer = window.setTimeout(() => panelRef.current?.querySelector<HTMLElement>(selector)?.focus(), 0);
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") { setPanelOpen(false); previousFocusRef.current?.focus(); return; }
      if (event.key !== "Tab" || !panelRef.current) return;
      const focusable = Array.from(panelRef.current.querySelectorAll<HTMLElement>(selector));
      if (!focusable.length) return;
      const first = focusable[0]; const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => { window.clearTimeout(timer); document.removeEventListener("keydown", onKeyDown); };
  }, [panelOpen]);

  function persistChoice() {
    try { saveEssentialPreferences(); } catch { /* optional local preference */ }
    setSavedMessage("Preferências salvas."); setVisible(false); setPanelOpen(false); previousFocusRef.current?.focus();
  }

  return <>
    {visible && !panelOpen ? <section className="l4-cookie-banner" aria-labelledby="cookie-banner-title"><div><h2 id="cookie-banner-title">COOKIES ESSENCIAIS</h2><p>Utilizamos cookies necessários para manter sua sessão, sua sacola e os recursos de segurança da loja funcionando corretamente.</p></div><div className="l4-cookie-actions"><Link className="l4-cookie-text-link" to="/privacidade#cookies">SAIBA MAIS</Link><button type="button" onClick={persistChoice}>ENTENDI</button></div></section> : null}
    {panelOpen ? <div className="l4-cookie-modal-backdrop" role="presentation"><div className="l4-cookie-modal" role="dialog" aria-modal="true" aria-labelledby="cookie-modal-title" aria-describedby="cookie-modal-description" ref={panelRef}><div className="l4-cookie-modal-head"><div><h2 id="cookie-modal-title">PREFERÊNCIAS DE COOKIES</h2><p id="cookie-modal-description">Escolha quais categorias opcionais você autoriza. No momento, a L4CKOS utiliza apenas cookies e armazenamentos necessários.</p></div><button type="button" className="l4-cookie-close" onClick={() => setPanelOpen(false)} aria-label="Fechar preferências de cookies">×</button></div><section className="l4-cookie-category"><div><h3>Cookies necessários</h3><p>Permanecem ativos porque são indispensáveis ao funcionamento da loja, à segurança, à sacola e à autenticação.</p></div><span>SEMPRE ATIVOS</span></section><div className="l4-cookie-table-wrap" aria-label="Cookies e armazenamentos necessários"><table className="l4-cookie-table"><thead><tr><th>Nome</th><th>Provedor</th><th>Finalidade</th><th>Duração</th><th>Tipo</th></tr></thead><tbody>{necessaryCookies.map(cookie => <tr key={cookie.name}><td>{cookie.name}</td><td>{cookie.provider}</td><td>{cookie.purpose}</td><td>{cookie.duration}</td><td>{cookie.type}</td></tr>)}</tbody></table></div><p className="l4-cookie-note">Não foram identificados cookies analíticos, marketing comportamental, pixels ou ferramentas de gravação de sessão carregados no site público.</p><div className="l4-cookie-modal-actions"><button type="button" className="secondary" onClick={persistChoice}>REJEITAR NÃO ESSENCIAIS</button><button type="button" onClick={persistChoice}>SALVAR PREFERÊNCIAS</button></div><p className="l4-cookie-live" aria-live="polite">{savedMessage}</p></div></div> : null}
  </>;
}
