import { PreorderInfo, MixedShippingNotice } from "./PreorderInfo";
import { DropQuotaNotice } from "./DropQuotaNotice";
import { useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Minus, Plus, ShoppingBag, Trash2, X } from "lucide-react";
import { useCart } from "../contexts/CartContext";
import { formatPrice } from "../lib/utils";
import camisaFallback from "../images/camisa.png";
import { inertOutside } from "../lib/inertBackground";
import { COOKIE_BANNER_ATTR, COOKIE_BANNER_EVENT } from "./CookiePreferences";
import "./CartDrawer.css";

function formatSelectedOptions(options?: Record<string, string>) {
  if (!options) return "";
  const labels: Record<string, string> = { cor: "Cor", tamanho: "Tamanho", color: "Cor", size: "Tamanho" };
  return Object.entries(options).map(([key, value]) => `${labels[key] || key}: ${value}`).join(" · ");
}

export default function CartDrawer() {
  const navigate = useNavigate();
  const {
    cart,
    updateQuantity,
    removeFromCart,
    isCartDrawerOpen,
    closeCartDrawer,
    hasUnavailableItems,
    isCatalogReady,
    dropQuotaBlocked,
    canIncreaseQuantity,
  } = useCart();
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
      // Keep Tab/Shift+Tab inside the open dialog. A visible cookie banner stays reachable: it is part of the trap, after the drawer.
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
              <MixedShippingNotice items={cart.items} />
              <DropQuotaNotice />
            {hasUnavailableItems ? (
                <p className="l4-preorder" role="alert">
                  Não foi possível confirmar a combinação ou disponibilidade de um item. Remova-o e selecione novamente na página do produto.
                </p>
              ) : null}
            {cart.items.map(item => (
                <article key={item.variant ? `${item.product.id}-variant-${item.variant.variantId}` : `${item.product.id}-${JSON.stringify(item.selectedOptions || {})}`} className="l4-cart-drawer-item">
                  <img
                    className="l4-product-media-surface l4-product-media-surface--thumb l4-product-media-image"
                    src={item.product.imageThumbnail || item.product.image}
                    alt={item.product.name}
                    onError={event => { event.currentTarget.src = camisaFallback; }}
                  />
                  <div className="l4-cart-drawer-item-info">
                    <div className="l4-cart-drawer-item-topline">
                      <h3>{item.product.name}</h3>
                      <PreorderInfo product={item.product} compact />
                      <strong>{formatPrice(item.product.price * item.quantity)}</strong>
                    </div>
                    {formatSelectedOptions(item.selectedOptions) ? <p>{formatSelectedOptions(item.selectedOptions)}</p> : null}
                    <span>{formatPrice(item.product.price)} cada</span>
                    <div className="l4-cart-drawer-item-actions">
                      <div className="l4-cart-drawer-quantity" aria-label={`Quantidade de ${item.product.name}`}>
                        <button type="button" onClick={() => updateQuantity(item.product.id, item.quantity - 1, item.selectedOptions, item.variant?.variantId)} aria-label="Diminuir quantidade"><Minus size={14} /></button>
                        <span>{item.quantity}</span>
                        <button type="button" onClick={() => updateQuantity(item.product.id, item.quantity + 1, item.selectedOptions, item.variant?.variantId)} aria-label="Aumentar quantidade" disabled={!canIncreaseQuantity(item.product.id)} title={canIncreaseQuantity(item.product.id) ? undefined : "Limite do drop atingido"}><Plus size={14} /></button>
                      </div>
                      <button type="button" className="l4-cart-drawer-remove" onClick={() => removeFromCart(item.product.id, item.selectedOptions, item.variant?.variantId)} aria-label={`Remover ${item.product.name}`}>
                        <Trash2 size={16} />
                      </button>
                    </div>
                  </div>
                </article>
              ))}
            </div>

            <footer className="l4-cart-drawer-footer">
              <div className="l4-cart-drawer-subtotal"><span>Subtotal</span><strong>{formatPrice(cart.total)}</strong></div>
              <p>Frete e prazo de transporte consultados no checkout. Fabricação e preparação não estão incluídas nesse prazo.</p>
              <button type="button" className="l4-cart-drawer-checkout" onClick={() => goTo("/checkout")}
                disabled={hasUnavailableItems || dropQuotaBlocked || !isCatalogReady}
              >{!hasUnavailableItems && dropQuotaBlocked ? "Revise o limite do drop" : "Finalizar compra"}</button>
              <Link to="/carrinho" onClick={closeCartDrawer}>Ver sacola completa</Link>
            </footer>
          </>
        )}
      </aside>
    </div>
  );
}
