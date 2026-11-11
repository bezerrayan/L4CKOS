import { useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Minus, Plus, ShoppingBag, Trash2, X } from "lucide-react";
import { useCart } from "../contexts/CartContext";
import { formatPrice } from "../lib/utils";
import camisaFallback from "../images/camisa.png";
import { inertOutside } from "../lib/inertBackground";
import { COOKIE_BANNER_ATTR, COOKIE_BANNER_EVENT } from "./CookiePreferences";
import { cartBlockingIssues, evaluateCartLine } from "../stock/availability";
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
  const drawerRef = useRef<HTMLElement | null>(null);
  const layerRef = useRef<HTMLDivElement | null>(null);
  // A pending cookie banner lives outside this dialog. aria-modal would hide it from assistive tech while
  // keyboard focus can still reach it, so the dialog is only declared modal when no banner is pending.
  const [bannerPending, setBannerPending] = useState(() => typeof document !== "undefined" && document.documentElement.hasAttribute(COOKIE_BANNER_ATTR));
  useEffect(() => {
    const sync = () => setBannerPending(document.documentElement.hasAttribute(COOKIE_BANNER_ATTR));
    sync();
    window.addEventListener(COOKIE_BANNER_EVENT, sync);
    return () => window.removeEventListener(COOKIE_BANNER_EVENT, sync);
  }, []);

  // The page behind the drawer is inert (not just visually covered); the drawer and a pending banner stay usable.
  useEffect(() => {
    if (!isCartDrawerOpen) return;
    return inertOutside([layerRef.current, document.querySelector("[data-l4-cookie-banner]")]);
  }, [isCartDrawerOpen, bannerPending]);

  useEffect(() => {
    if (!isCartDrawerOpen) return;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    closeButtonRef.current?.focus();
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") closeCartDrawer();
      if (event.key !== "Tab") return;
      // Keep Tab/Shift+Tab inside the open dialog.
      // A visible cookie banner stays reachable by keyboard: it is part of the trap, after the drawer.
      const selector = "a[href], button:not([disabled]):not([tabindex='-1'])";
      const focusable = [
        ...Array.from(drawerRef.current?.querySelectorAll<HTMLElement>(selector) ?? []),
        ...Array.from(document.querySelectorAll<HTMLElement>("[data-l4-cookie-banner] a[href], [data-l4-cookie-banner] button:not([disabled])")),
      ];
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      // Focus was lost (e.g. the banner was dismissed while focused): bring it back into the dialog.
      if (!(document.activeElement instanceof HTMLElement) || !focusable.includes(document.activeElement)) {
        event.preventDefault();
        (event.shiftKey ? last : first).focus();
        return;
      }
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", onKeyDown);
      opener?.focus();
    };
  }, [closeCartDrawer, isCartDrawerOpen]);

  const goTo = (path: "/produtos" | "/carrinho" | "/checkout") => {
    closeCartDrawer();
    navigate(path);
  };

  return (
    <div ref={layerRef} className={`l4-cart-drawer-layer ${isCartDrawerOpen ? "is-open" : ""}`} aria-hidden={!isCartDrawerOpen}>
      <button type="button" className="l4-cart-drawer-backdrop" onClick={closeCartDrawer} tabIndex={-1} aria-label="Fechar sacola" />
      <aside ref={drawerRef} className="l4-cart-drawer" role="dialog" aria-modal={bannerPending ? undefined : true} aria-label="Sacola de compras">
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
              {cart.items.map(item => {
                const line = evaluateCartLine(item);
                return (
                <article key={`${item.product.id}-${item.variantId ?? "legacy"}-${JSON.stringify(item.selectedOptions || {})}`} className="l4-cart-drawer-item">
                  <img
                    className="l4-product-media-surface l4-product-media-surface--thumb l4-product-media-image"
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
                        <button type="button" onClick={() => updateQuantity(item.product.id, item.quantity - 1, item.selectedOptions)} aria-label={`Diminuir quantidade de ${item.product.name}`}><Minus size={14} aria-hidden="true" /></button>
                        <span aria-live="polite">{item.quantity}</span>
                        <button type="button" onClick={() => updateQuantity(item.product.id, item.quantity + 1, item.selectedOptions)} disabled={item.quantity >= line.maxQuantity} aria-label={`Aumentar quantidade de ${item.product.name}`}><Plus size={14} aria-hidden="true" /></button>
                      </div>
                      <button type="button" className="l4-cart-drawer-remove" onClick={() => removeFromCart(item.product.id, item.selectedOptions)} aria-label={`Remover ${item.product.name}`}>
                        <Trash2 size={16} />
                      </button>
                    </div>
                    {line.state !== "ok" ? <p className="l4-cart-drawer-stock-note" role="alert">{line.message}</p> : null}
                  </div>
                </article>
                );
              })}
            </div>

            <footer className="l4-cart-drawer-footer">
              <div className="l4-cart-drawer-subtotal"><span>Subtotal</span><strong>{formatPrice(cart.total)}</strong></div>
              <p>Frete e prazo calculados no checkout.</p>
              <button type="button" className="l4-cart-drawer-checkout" onClick={() => goTo("/checkout")} disabled={cartBlockingIssues(cart.items).length > 0} aria-describedby={cartBlockingIssues(cart.items).length > 0 ? "cart-drawer-blocked" : undefined}>Finalizar compra</button>
              {cartBlockingIssues(cart.items).length > 0 ? <p id="cart-drawer-blocked" className="l4-cart-drawer-stock-note">Ajuste os itens sinalizados para continuar.</p> : null}
              <Link to="/carrinho" onClick={closeCartDrawer}>Ver sacola completa</Link>
            </footer>
          </>
        )}
      </aside>
    </div>
  );
}
