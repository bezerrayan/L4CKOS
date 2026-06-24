import { Link, useLocation } from "react-router-dom";
import { useEffect, useState } from "react";
import { ShoppingCart } from "lucide-react";
import { useFavorites } from "../contexts/FavoritesContext";
import { useUser } from "../contexts/UserContext";
import { useIsMobile } from "../hooks/useIsMobile";
import { PRODUCT_CATEGORIES } from "../lib/productCategories";
import logoMainDark from "../images/l4ckos-main-dark-transparent.png";
import "./Header.css";

function firstName(name?: string, email?: string) {
  const trimmed = name?.trim();
  if (trimmed) return trimmed.split(/\s+/)[0];
  const local = email?.split("@")[0]?.trim();
  if (!local) return "Usuário";
  return local.split(/[._-]+/)[0] || local;
}

export default function Header() {
  const location = useLocation();
  const { favorites } = useFavorites();
  const { user, logout } = useUser();
  const isMobile = useIsMobile(980);
  const [menuOpen, setMenuOpen] = useState(false);
  const isAuthenticated = Boolean(user?.isAuthenticated);
  const displayName = firstName(user?.name, user?.email);
  const mobileCategoryLinks = PRODUCT_CATEGORIES.slice(0, 6);

  useEffect(() => {
    setMenuOpen(false);
  }, [location.pathname]);

  const navItems = [
    { to: "/", label: "Início", active: location.pathname === "/" },
    {
      to: "/produtos",
      label: "Produtos",
      active:
        location.pathname === "/produtos" ||
        location.pathname.startsWith("/produto/") ||
        location.pathname.startsWith("/categorias/"),
    },
    { to: "/meus-pedidos", label: "Pedidos", active: location.pathname === "/meus-pedidos" },
    { to: "/acompanhar-pedido", label: "Acompanhar", active: location.pathname === "/acompanhar-pedido" },
    { to: "/contato", label: "Contato", active: location.pathname === "/contato" },
  ];

  return (
    <header className="l4-header">
      <div className="l4-header-inner">
        <button
          className="l4-header-menu-btn"
          onClick={() => setMenuOpen(v => !v)}
          aria-label={menuOpen ? "Fechar menu" : "Abrir menu"}
          aria-expanded={menuOpen}
          aria-controls="l4-header-nav"
        >
          {menuOpen ? "×" : "☰"}
        </button>

        <Link to="/" className="l4-header-brand" onClick={() => setMenuOpen(false)}>
          <img src={logoMainDark} alt="L4CKOS" />
          <span>L4CKOS</span>
        </Link>

        <Link
          to="/carrinho"
          className={`l4-header-cart-btn ${location.pathname === "/carrinho" ? "active" : ""}`}
          onClick={() => setMenuOpen(false)}
          aria-label="Carrinho"
          title="Carrinho"
        >
          <ShoppingCart size={16} strokeWidth={2} />
        </Link>

        <nav id="l4-header-nav" className={`l4-header-nav ${isMobile ? "mobile" : ""} ${menuOpen ? "open" : ""}`}>
          {navItems.map(item => (
            <Link key={item.to} to={item.to} className={`l4-header-link ${item.active ? "active" : ""}`} onClick={() => setMenuOpen(false)}>
              {item.label}
            </Link>
          ))}

          {isMobile ? (
            <div className="l4-header-mobile-categories">
              <span className="l4-header-mobile-title">Categorias</span>
              <div className="l4-header-mobile-grid">
                {mobileCategoryLinks.map(category => (
                  <Link
                    key={category.value}
                    to={`/categorias/${category.value}`}
                    className="l4-header-mobile-chip"
                    onClick={() => setMenuOpen(false)}
                  >
                    {category.label}
                  </Link>
                ))}
              </div>
            </div>
          ) : null}

          <Link to="/favoritos" className={`l4-header-link ${location.pathname === "/favoritos" ? "active" : ""}`} onClick={() => setMenuOpen(false)}>
            Favoritos{favorites.length > 0 ? ` (${favorites.length})` : ""}
          </Link>

          {!isMobile ? (
            <Link to="/carrinho" className={`l4-header-link ${location.pathname === "/carrinho" ? "active" : ""}`} onClick={() => setMenuOpen(false)}>
              Carrinho
            </Link>
          ) : null}

          {isAuthenticated ? (
            <div className="l4-header-user">
              <Link to="/perfil" className="l4-header-chip" onClick={() => setMenuOpen(false)}>
                Olá, {displayName}
              </Link>
              {user?.role === "admin" ? (
                <Link to="/gestao" className="l4-header-chip admin" onClick={() => setMenuOpen(false)}>
                  Admin
                </Link>
              ) : null}
              <button
                className="l4-header-chip danger"
                onClick={() => {
                  setMenuOpen(false);
                  logout();
                }}
              >
                Sair
              </button>
            </div>
          ) : (
            <div className="l4-header-auth">
              <Link to="/entrar" className="l4-header-chip" onClick={() => setMenuOpen(false)}>
                Entrar
              </Link>
              <Link to="/cadastro" className="l4-header-chip white" onClick={() => setMenuOpen(false)}>
                Criar Conta
              </Link>
            </div>
          )}
        </nav>
      </div>
    </header>
  );
}
