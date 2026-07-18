import { Link } from "react-router-dom";
import { ShoppingBag } from "lucide-react";
import EmptyState from "../components/EmptyState";
import { useCart } from "../contexts/CartContext";
import { formatPrice } from "../lib/utils";
import type { CSSProperties } from "react";
import { useIsMobile } from "../hooks/useIsMobile";
import camisaFallback from "../images/camisa.png";

export default function Carrinho() {
  const isMobile = useIsMobile();
  const { cart, removeFromCart, updateQuantity } = useCart();

  const getItemKey = (productId: number, selectedOptions?: Record<string, string>) => {
    if (!selectedOptions) return `${productId}`;
    const optionString = Object.entries(selectedOptions)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${k}:${v}`)
      .join("|");
    return `${productId}-${optionString}`;
  };

  const formatSelectedOptions = (selectedOptions?: Record<string, string>) => {
    if (!selectedOptions) return "";
    const labelMap: Record<string, string> = {
      cor: "Cor",
      tamanho: "Tamanho",
      size: "Tamanho",
      color: "Cor",
    };

    return Object.entries(selectedOptions)
      .map(([key, value]) => `${labelMap[key] || key}: ${value}`)
      .join(" - ");
  };

  return (
    <div style={{ paddingBottom: isMobile ? 104 : 0 }}>
      <div style={styles.header}>
        <h1 style={{ ...styles.title, fontSize: isMobile ? 30 : styles.title.fontSize }}>Sua Sacola</h1>
        <p style={styles.subtitle}>
          {cart.items.length === 0
            ? "Sua sacola está vazia"
            : `${cart.itemCount} item${cart.itemCount > 1 ? "s" : ""} na sacola`}
        </p>
      </div>

      {cart.items.length === 0 ? (
        <EmptyState
          icon={ShoppingBag}
          title="SUA SACOLA ESTÁ VAZIA"
          text="Explore nossos produtos e encontre uma peça para acompanhar o seu caminho."
          action={{ label: "EXPLORAR PRODUTOS", to: "/produtos" }}
        />
      ) : (
        <div style={{ ...styles.layout, gridTemplateColumns: isMobile ? "1fr" : "1fr 340px" }}>
          <div style={styles.itemsList}>
            {cart.items.map((item) => (
              <div
                key={getItemKey(item.product.id, item.selectedOptions)}
                style={{
                  ...styles.itemCard,
                  gridTemplateColumns: isMobile ? "64px 1fr auto" : "80px 1fr auto auto",
                  gap: isMobile ? 10 : 12,
                }}
              >
                <img
                  src={item.product.image}
                  alt={item.product.name}
                  style={{
                    ...styles.itemImage,
                    width: isMobile ? 64 : 80,
                    height: isMobile ? 64 : 80,
                  }}
                  onError={(event) => {
                    event.currentTarget.src = camisaFallback;
                  }}
                />

                <div style={styles.itemInfo}>
                  <h3 style={styles.itemName}>{item.product.name}</h3>
                  {item.selectedOptions ? (
                    <p style={styles.itemMeta}>{formatSelectedOptions(item.selectedOptions)}</p>
                  ) : null}
                  <p style={styles.itemUnitPrice}>{formatPrice(item.product.price)} / unidade</p>
                </div>

                <div
                  style={{
                    ...styles.qtyColumn,
                    justifySelf: isMobile ? "end" : "unset",
                    gridColumn: isMobile ? "3" : "auto",
                    gridRow: isMobile ? "1 / span 2" : "auto",
                    marginTop: 0,
                  }}
                >
                  <p style={styles.itemSubtotal}>{formatPrice(item.product.price * item.quantity)}</p>
                  <div style={styles.qtyActionRow}>
                    <div style={styles.qtyWrap}>
                      <button
                        style={styles.qtyButton}
                        onClick={() => updateQuantity(item.product.id, Math.max(1, item.quantity - 1), item.selectedOptions)}
                      >
                        -
                      </button>
                      <span style={styles.qtyValue}>{item.quantity}</span>
                      <button
                        style={styles.qtyButton}
                        onClick={() => updateQuantity(item.product.id, item.quantity + 1, item.selectedOptions)}
                      >
                        +
                      </button>
                    </div>
                    <button
                      style={styles.removeIconButton}
                      onClick={() => removeFromCart(item.product.id, item.selectedOptions)}
                      title="Remover item"
                      aria-label="Remover item"
                    >
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                        <polyline points="3 6 5 6 21 6"></polyline>
                        <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"></path>
                        <line x1="10" y1="11" x2="10" y2="17"></line>
                        <line x1="14" y1="11" x2="14" y2="17"></line>
                      </svg>
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>

          {!isMobile ? (
            <aside style={styles.summaryDesktop}>
              <h2 style={styles.summaryTitle}>Resumo da compra</h2>
              <div style={styles.summaryRow}><span>Itens</span><strong>{cart.itemCount}</strong></div>
              <div style={styles.summaryRow}><span>Subtotal</span><strong>{formatPrice(cart.total)}</strong></div>
              <p style={styles.summaryHint}>Frete, cupom e pagamento na próxima etapa.</p>
              <Link to="/checkout" style={styles.checkoutButton}>Finalizar compra</Link>
              <Link to="/produtos" style={styles.continueLink}>Continuar comprando</Link>
            </aside>
          ) : null}
        </div>
      )}

      {isMobile && cart.items.length > 0 ? (
        <div style={styles.mobileCheckoutBar}>
          <div>
            <p style={styles.mobileCheckoutLabel}>Subtotal</p>
            <p style={styles.mobileCheckoutValue}>{formatPrice(cart.total)}</p>
          </div>
          <Link to="/checkout" style={styles.mobileCheckoutButton}>Finalizar compra</Link>
        </div>
      ) : null}
    </div>
  );
}

const styles: Record<string, CSSProperties> = {
  header: {
    marginBottom: 24,
    borderBottom: "1px solid #262626",
    paddingBottom: 16,
  },
  title: {
    fontSize: 38,
    fontWeight: 900,
    color: "#f0ede8",
    margin: 0,
  },
  subtitle: {
    margin: "6px 0 0 0",
    color: "#9ca3af",
    fontSize: 15,
  },
  layout: {
    display: "grid",
    gap: 20,
    alignItems: "start",
  },
  itemsList: {
    display: "flex",
    flexDirection: "column",
    gap: 12,
  },
  itemCard: {
    display: "grid",
    gridTemplateColumns: "80px 1fr auto auto",
    gap: 12,
    alignItems: "center",
    background: "#101010",
    border: "1px solid #2b2b2b",
    borderRadius: 10,
    padding: 12,
  },
  itemImage: {
    width: 80,
    height: 80,
    borderRadius: 8,
    objectFit: "contain",
    objectPosition: "center",
    background: "#080808",
  },
  itemInfo: {
    minWidth: 0,
  },
  itemName: {
    margin: 0,
    fontSize: 15,
    fontWeight: 800,
    color: "#f0ede8",
  },
  itemMeta: {
    margin: "2px 0 0 0",
    fontSize: 12,
    color: "#a1a1aa",
  },
  itemUnitPrice: {
    margin: "4px 0 0 0",
    fontSize: 12,
    color: "#a1a1aa",
  },
  qtyWrap: {
    display: "inline-flex",
    alignItems: "center",
    border: "1px solid #323232",
    borderRadius: 8,
    overflow: "hidden",
  },
  qtyColumn: {
    display: "flex",
    flexDirection: "column",
    alignItems: "flex-end",
    gap: 8,
  },
  qtyActionRow: {
    display: "flex",
    alignItems: "center",
    gap: 8,
  },
  qtyButton: {
    width: 30,
    height: 30,
    border: "none",
    background: "#181818",
    color: "#f0ede8",
    cursor: "pointer",
    fontWeight: 700,
  },
  qtyValue: {
    minWidth: 30,
    textAlign: "center",
    fontWeight: 700,
    fontSize: 14,
  },
  itemSubtotal: {
    margin: 0,
    fontWeight: 800,
    color: "#f0ede8",
    fontSize: 24,
    lineHeight: 1,
  },
  removeIconButton: {
    border: "none",
    background: "transparent",
    color: "#ef4444",
    cursor: "pointer",
    padding: 4,
    lineHeight: 0,
    borderRadius: 6,
  },
  removeButton: {
    marginTop: 6,
    border: "none",
    background: "transparent",
    color: "#b91c1c",
    cursor: "pointer",
    fontSize: 12,
    fontWeight: 700,
  },
  summaryDesktop: {
    position: "sticky",
    top: 96,
    background: "#101010",
    border: "1px solid #2b2b2b",
    borderRadius: 10,
    padding: 16,
  },
  summaryTitle: {
    margin: 0,
    fontSize: 20,
    fontWeight: 800,
    color: "#f0ede8",
  },
  summaryRow: {
    display: "flex",
    justifyContent: "space-between",
    marginTop: 12,
    color: "#d4d4d8",
    fontSize: 14,
  },
  summaryHint: {
    margin: "14px 0",
    fontSize: 12,
    color: "#a1a1aa",
  },
  checkoutButton: {
    display: "block",
    width: "100%",
    textAlign: "center",
    padding: "12px 14px",
    borderRadius: 8,
    fontWeight: 800,
    textDecoration: "none",
    color: "#fff",
    background: "linear-gradient(135deg, #1a1a1a 0%, #3a3a3a 100%)",
  },
  continueLink: {
    display: "block",
    textAlign: "center",
    marginTop: 12,
    color: "#a1a1aa",
    fontSize: 13,
    fontWeight: 600,
    textDecoration: "none",
  },
  mobileCheckoutBar: {
    position: "fixed",
    left: 0,
    right: 0,
    bottom: 0,
    borderTop: "1px solid #2f2f2f",
    background: "rgba(8,8,8,0.97)",
    backdropFilter: "blur(4px)",
    padding: "10px 14px",
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
    zIndex: 60,
  },
  mobileCheckoutLabel: {
    margin: 0,
    fontSize: 12,
    color: "#a1a1aa",
  },
  mobileCheckoutValue: {
    margin: "2px 0 0 0",
    fontWeight: 800,
    fontSize: 20,
    color: "#f0ede8",
  },
  mobileCheckoutButton: {
    minWidth: 160,
    textAlign: "center",
    padding: "12px 14px",
    borderRadius: 8,
    fontWeight: 800,
    textDecoration: "none",
    color: "#fff",
    background: "linear-gradient(135deg, #1a1a1a 0%, #3a3a3a 100%)",
  },
  emptyState: {
    border: "1px dashed #3a3a3a",
    borderRadius: 12,
    padding: 28,
    textAlign: "center",
    background: "#111111",
  },
  emptyTitle: {
    margin: 0,
    fontSize: 24,
    fontWeight: 900,
    color: "#f0ede8",
  },
  emptyText: {
    margin: "8px 0 16px 0",
    fontSize: 14,
    color: "#a1a1aa",
  },
  emptyButton: {
    display: "inline-block",
    padding: "10px 16px",
    borderRadius: 8,
    textDecoration: "none",
    fontWeight: 700,
    color: "#fff",
    background: "linear-gradient(135deg, #1a1a1a 0%, #3a3a3a 100%)",
  },
};

