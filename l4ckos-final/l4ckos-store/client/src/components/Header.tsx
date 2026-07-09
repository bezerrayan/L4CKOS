import { Link, useLocation } from "react-router-dom";
import { useEffect, useRef, useState } from "react";
import { Heart, Menu, ShoppingBag, UserRound, X } from "lucide-react";
import { useCart } from "../contexts/CartContext";
import { useFavorites } from "../contexts/FavoritesContext";
import { useUser } from "../contexts/UserContext";
import { useIsMobile } from "../hooks/useIsMobile";
import logoMainDark from "../images/l4ckos-main-dark-transparent.png";
import "./Header.css";

function firstName(name?: string, email?: string) {
  const trimmed = name?.trim();
  if (trimmed) return trimmed.split(/\s+/)[0];
  const local = email?.split("@")[0]?.trim();
  if (!local) return "Conta";
  return local.split(/[._-]+/)[0] || local;
}

export default function Header() {
  const location = useLocation();
  const { cart } = useCart();
  const { favorites } = useFavorites();
  const { user, logout } = useUser();
  const isMobile = useIsMobile(980);
  const accountRef = useRef<HTMLDivElement | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [accountOpen, setAccountOpen] = useState(false);
  const isAuthenticated = Boolean(user?.isAuthenticated);
  const displayName = firstName(user?.name, user?.email);
  const favoriteCount = favorites.length;
  const bagCount = cart.itemCount;

  useEffect(() => {
    setMenuOpen(false);
    setAccountOpen(false);
  }, [location.pathname]);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setMenuOpen(false);
        setAccountOpen(false);
      }
    }

    function onPointerDown(event: PointerEvent) {
      if (accountRef.current && !accountRef.current.contains(event.target as Node)) {
        setAccountOpen(false);
      }
    }

    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("pointerdown", onPointerDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("pointerdown", onPointerDown);
    };
  }, []);

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
    { to: "/sobre", label: "Sobre", active: location.pathname === "/sobre" },
    { to: "/contato", label: "Contato", active: location.pathname === "/contato" },
    { to: "/acompanhar-pedido", label: "Acompanhar pedido", active: location.pathname === "/acompanhar-pedido" },
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
          {menuOpen ? <X size={19} aria-hidden="true" /> : <Menu size={19} aria-hidden="true" />}
        </button>

        <Link to="/" className="l4-header-brand" onClick={() => setMenuOpen(false)}>
          <img src={logoMainDark} alt="L4CKOS" />
          <span>Built for Adventure</span>
        </Link>

        <nav id="l4-header-nav" className={`l4-header-nav ${isMobile ? "mobile" : ""} ${menuOpen ? "open" : ""}`} aria-label="Navegação principal">
          {navItems.map(item => (
            <Link key={item.to} to={item.to} className={`l4-header-link ${item.active ? "active" : ""}`} onClick={() => setMenuOpen(false)}>
              {item.label}
            </Link>
          ))}
        </nav>

        <div className="l4-header-actions">
          <Link
            to="/favoritos"
            className={`l4-header-icon-btn ${location.pathname === "/favoritos" ? "active" : ""}`}
            aria-label={favoriteCount > 0 ? `Favoritos, ${favoriteCount} peça${favoriteCount > 1 ? "s" : ""} salva${favoriteCount > 1 ? "s" : ""}` : "Favoritos"}
          >
            <Heart size={18} aria-hidden="true" />
            {favoriteCount > 0 ? <span className="l4-header-count">{favoriteCount}</span> : null}
          </Link>

          <Link
            to="/carrinho"
            className={`l4-header-icon-btn ${location.pathname === "/carrinho" ? "active" : ""}`}
            aria-label={bagCount > 0 ? `Sacola, ${bagCount} item${bagCount > 1 ? "s" : ""}` : "Sacola vazia"}
          >
            <ShoppingBag size={18} aria-hidden="true" />
            {bagCount > 0 ? <span className="l4-header-count">{bagCount}</span> : null}
          </Link>

          <div className="l4-header-account" ref={accountRef}>
            <button
              className={`l4-header-icon-btn ${location.pathname === "/perfil" || location.pathname === "/entrar" ? "active" : ""}`}
              type="button"
              onClick={() => setAccountOpen(v => !v)}
              aria-label={isAuthenticated ? `Abrir menu da conta de ${displayName}` : "Abrir opções de conta"}
              aria-haspopup="menu"
              aria-expanded={accountOpen}
            >
              <UserRound size={18} aria-hidden="true" />
            </button>
            {accountOpen ? (
              <div className="l4-header-account-menu" role="menu">
                {isAuthenticated ? (
                  <>
                    <div className="l4-header-account-name">Olá, {displayName}</div>
                    <Link role="menuitem" to="/perfil">Minha conta</Link>
                    <Link role="menuitem" to="/meus-pedidos">Meus pedidos</Link>
                    <Link role="menuitem" to="/acompanhar-pedido">Acompanhar pedido</Link>
                    {user?.role === "admin" ? <Link role="menuitem" to="/gestao">Administração</Link> : null}
                    <button
                      role="menuitem"
                      type="button"
                      onClick={() => {
                        setAccountOpen(false);
                        logout();
                      }}
                    >
                      Sair
                    </button>
                  </>
                ) : (
                  <>
                    <Link role="menuitem" to="/entrar">Entrar</Link>
                    <Link role="menuitem" to="/cadastro">Criar conta</Link>
                  </>
                )}
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </header>
  );
}
