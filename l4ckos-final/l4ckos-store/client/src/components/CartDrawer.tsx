import { useEffect, useRef } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Minus, Plus, ShoppingBag, Trash2, X } from "lucide-react";
import { useCart } from "../contexts/CartContext";
import { formatPrice } from "../lib/utils";
import camisaFallback from "../images/camisa.png";
import "./CartDrawer.css";

function formatSelectedOptions(options?: Record<string, string>) {
  if (!options) return "";
  const labels: Record<string, string> = { cor: "Cor", tamanho: "Tamanho", color: "Cor", size: "Tamanho" };
  return Object.entries(options).map(([key, value]) => `${labels[key] || key}: ${value}`).join(" · ");
}

export default function CartDrawer() {
  const navigate = useNavigate();
  const { cart, updateQuantity, removeFromCart, isCartDrawerOpen, closeCartDrawer } = useCart();
  const closeButtonRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    if (!isCartDrawerOpen) return;
    closeButtonRef.current?.focus();
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") closeCartDrawer();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [closeCartDrawer, isCartDrawerOpen]);

  const goTo = (path: "/produtos" | "/carrinho" | "/checkout") => {
    closeCartDrawer();
    navigate(path);
  };

  return (
    <div className={`l4-cart-drawer-layer ${isCartDrawerOpen ? "is-open" : ""}`} aria-hidden={!isCartDrawerOpen}>
      <button type="button" className="l4-cart-drawer-backdrop" onClick={closeCartDrawer} tabIndex={-1} aria-label="Fechar sacola" />
      <aside className="l4-cart-drawer" role="dialog" aria-modal="true" aria-label="Sacola de compras">
        <header className="l4-cart-drawer-header">
          <div>
            <span className="l4-cart-drawer-eyebrow">Sua seleção</span>
            <h2>Sacola <span>{cart.itemCount}</span></h2>
          </div>
          <button ref={closeButtonRef} type="button" className="l4-cart-drawer-close" onClick={closeCartDrawer} aria-label="Fechar sacola">
            <X size={21} aria-hidden="true" />
          </button>
        </header>

        {cart.items.length === 0 ? (
          <div className="l4-cart-drawer-empty">
            <ShoppingBag size={30} aria-hidden="true" />
            <strong>Sua sacola está vazia</strong>
            <p>Escolha uma peça para continuar.</p>
            <button type="button" onClick={() => goTo("/produtos")}>Ver produtos</button>
          </div>
        ) : (
          <>
            <div className="l4-cart-drawer-items">
              {cart.items.map(item => (
                <article key={`${item.product.id}-${JSON.stringify(item.selectedOptions || {})}`} className="l4-cart-drawer-item">
                  <img
                    src={item.product.imageThumbnail || item.product.image}
                    alt={item.product.name}
                    onError={event => { event.currentTarget.src = camisaFallback; }}
                  />
                  <div className="l4-cart-drawer-item-info">
                    <div className="l4-cart-drawer-item-topline">
                      <h3>{item.product.name}</h3>
                      <strong>{formatPrice(item.product.price * item.quantity)}</strong>
                    </div>
                    {formatSelectedOptions(item.selectedOptions) ? <p>{formatSelectedOptions(item.selectedOptions)}</p> : null}
                    <span>{formatPrice(item.product.price)} cada</span>
                    <div className="l4-cart-drawer-item-actions">
                      <div className="l4-cart-drawer-quantity" aria-label={`Quantidade de ${item.product.name}`}>
                        <button type="button" onClick={() => updateQuantity(item.product.id, item.quantity - 1, item.selectedOptions)} aria-label="Diminuir quantidade"><Minus size={14} /></button>
                        <span>{item.quantity}</span>
                        <button type="button" onClick={() => updateQuantity(item.product.id, item.quantity + 1, item.selectedOptions)} aria-label="Aumentar quantidade"><Plus size={14} /></button>
                      </div>
                      <button type="button" className="l4-cart-drawer-remove" onClick={() => removeFromCart(item.product.id, item.selectedOptions)} aria-label={`Remover ${item.product.name}`}>
                        <Trash2 size={16} />
                      </button>
                    </div>
                  </div>
                </article>
              ))}
            </div>

            <footer className="l4-cart-drawer-footer">
              <div className="l4-cart-drawer-subtotal"><span>Subtotal</span><strong>{formatPrice(cart.total)}</strong></div>
              <p>Frete e prazo calculados no checkout.</p>
              <button type="button" className="l4-cart-drawer-checkout" onClick={() => goTo("/checkout")}>Finalizar compra</button>
              <Link to="/carrinho" onClick={closeCartDrawer}>Ver sacola completa</Link>
            </footer>
          </>
        )}
      </aside>
    </div>
  );
}
