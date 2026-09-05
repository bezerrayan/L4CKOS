import { Link } from "react-router-dom";
import { Instagram, Mail } from "lucide-react";
import { openCookiePreferences } from "./CookiePreferences";
import logoMainDark from "../images/l4ckos-main-dark-transparent.png";
import "./Footer.css";

export default function Footer() {
  const year = new Date().getFullYear();

  return (
    <footer className="l4-footer">
      <div className="l4-footer-grid">
        <div>
          <img src={logoMainDark} alt="L4CKOS" className="l4-footer-logo" />
          <p className="l4-footer-text">
            Marca brasileira independente que une identidade urbana, movimento e espírito de aventura.
          </p>
          <div className="l4-footer-socials" aria-label="Redes sociais">
            <a href="https://www.instagram.com/l4ckosstore/" target="_blank" rel="noreferrer" aria-label="Instagram L4ckos">
              <Instagram size={14} />
              <span>Instagram</span>
            </a>
            <a href="mailto:contato@l4ckos.com.br" aria-label="E-mail L4ckos">
              <Mail size={14} />
              <span>E-mail</span>
            </a>
          </div>
        </div>

        <div>
          <h4>Loja</h4>
          <ul>
            <li><Link to="/">Início</Link></li>
            <li><Link to="/produtos">Produtos</Link></li>
            <li><Link to="/favoritos">Favoritos</Link></li>
            <li><Link to="/carrinho">Sacola</Link></li>
          </ul>
        </div>

        <div>
          <h4>Suporte</h4>
          <ul>
            <li><Link to="/meus-pedidos">Meus pedidos</Link></li>
            <li><Link to="/acompanhar-pedido">Rastrear pedido</Link></li>
            <li><Link to="/trocas-e-devolucoes">Trocas e devoluções</Link></li>
            <li><Link to="/contato">Contato</Link></li>
          </ul>
        </div>

        <div>
          <h4>Marca</h4>
          <ul>
            <li><Link to="/sobre">Sobre a L4CKOS</Link></li>
            <li><a href="https://www.instagram.com/l4ckosstore/" target="_blank" rel="noreferrer">Instagram</a></li>
          </ul>
        </div>

        <div>
          <h4>Legal</h4>
          <ul>
            <li><Link to="/termos">Termos</Link></li>
            <li><Link to="/privacidade">Privacidade</Link></li>
            <li><button className="l4-footer-link-button" type="button" onClick={openCookiePreferences}>Preferências de cookies</button></li>
          </ul>
        </div>
      </div>

      <div className="l4-footer-bottom">
        <span>© {year} L4ckos. Todos os direitos reservados.</span>
        <span>Built for Adventure</span>
      </div>
    </footer>
  );
}
