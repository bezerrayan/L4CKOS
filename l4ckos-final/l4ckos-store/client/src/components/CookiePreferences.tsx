import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import "./CookiePreferences.css";

const CONSENT_KEY = "l4ckos:cookie-preferences";

export function openCookiePreferences() {
  window.dispatchEvent(new Event("l4ckos:open-cookie-preferences"));
}

export default function CookiePreferences() {
  const [visible, setVisible] = useState(false);
  const [panelOpen, setPanelOpen] = useState(false);

  useEffect(() => {
    try { setVisible(!window.localStorage.getItem(CONSENT_KEY)); } catch { setVisible(false); }
    const open = () => { setVisible(true); setPanelOpen(true); };
    window.addEventListener("l4ckos:open-cookie-preferences", open);
    return () => window.removeEventListener("l4ckos:open-cookie-preferences", open);
  }, []);

  const persist = () => {
    try { window.localStorage.setItem(CONSENT_KEY, JSON.stringify({ decidedAt: new Date().toISOString(), essentialOnly: true })); } catch { /* preference storage is non-critical */ }
    setVisible(false);
    setPanelOpen(false);
  };

  return <>
    {visible && !panelOpen ? <section className="l4-cookie-banner" aria-labelledby="cookie-banner-title"><div><h2 id="cookie-banner-title">COOKIES ESSENCIAIS</h2><p>Usamos apenas cookies e armazenamento necessários para sessão, segurança e sacola de compras.</p></div><div className="l4-cookie-actions"><Link className="l4-cookie-text-link" to="/privacidade#cookies">SAIBA MAIS</Link><button type="button" onClick={persist}>ENTENDI</button></div></section> : null}
    {panelOpen ? <div className="l4-cookie-modal-backdrop"><section className="l4-cookie-modal" role="dialog" aria-modal="true" aria-labelledby="cookie-modal-title"><div className="l4-cookie-modal-head"><div><h2 id="cookie-modal-title">PREFERÊNCIAS DE COOKIES</h2><p>A L4CKOS utiliza somente recursos essenciais para autenticação, segurança e funcionamento da sacola.</p></div><button type="button" className="l4-cookie-close" onClick={() => setPanelOpen(false)} aria-label="Fechar preferências">×</button></div><div className="l4-cookie-category"><div><h3>Cookies necessários</h3><p>Essenciais para manter a sessão, prevenir ações indevidas e preservar os itens da sacola.</p></div><span>Sempre ativos</span></div><p className="l4-cookie-note">Não há cookies opcionais de marketing ou rastreamento comportamental ativados neste fluxo.</p><div className="l4-cookie-modal-actions"><button type="button" className="secondary" onClick={persist}>REJEITAR NÃO ESSENCIAIS</button><button type="button" onClick={persist}>SALVAR PREFERÊNCIAS</button></div></section></div> : null}
  </>;
}
