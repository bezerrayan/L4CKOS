import { Link } from "react-router-dom";
import { Instagram, Mail, MessageCircle } from "lucide-react";
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
            Seleção de peças e equipamentos para trilha, campo e rotina urbana, com comunicação direta e foco no que realmente importa para o cliente.
          </p>
          <div className="l4-footer-socials" aria-label="Redes sociais">
            <a href="https://instagram.com/l4ckos" target="_blank" rel="noreferrer" aria-label="Instagram L4CKOS">
              <Instagram size={14} />
              <span>Instagram</span>
            </a>
            <a href="https://wa.me/5561998030913" target="_blank" rel="noreferrer" aria-label="WhatsApp L4CKOS">
              <MessageCircle size={14} />
              <span>WhatsApp</span>
            </a>
            <a href="mailto:contato@l4ckos.com.br" aria-label="E-mail L4CKOS">
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
            <li><Link to="/carrinho">Carrinho</Link></li>
            <li><Link to="/meus-pedidos">Meus pedidos</Link></li>
          </ul>
        </div>

        <div>
          <h4>Suporte</h4>
          <ul>
            <li><Link to="/acompanhar-pedido">Acompanhar pedido</Link></li>
            <li><Link to="/trocas-e-devolucoes">Trocas e devoluções</Link></li>
            <li><Link to="/faqs">FAQ</Link></li>
            <li><Link to="/contato">Contato</Link></li>
          </ul>
        </div>

        <div>
          <h4>Legal</h4>
          <ul>
            <li><Link to="/sobre">Sobre</Link></li>
            <li><Link to="/termos">Termos</Link></li>
            <li><Link to="/privacidade">Privacidade</Link></li>
          </ul>
        </div>
      </div>

      <div className="l4-footer-bottom">
        <span>© {year} L4CKOS. Todos os direitos reservados.</span>
        <span>PIX • Cartão • Checkout com cálculo de frete</span>
      </div>
    </footer>
  );
}
