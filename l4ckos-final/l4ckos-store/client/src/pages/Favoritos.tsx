import { Link } from "react-router-dom";
import type { CSSProperties } from "react";
import { Heart } from "lucide-react";
import EmptyState from "../components/EmptyState";
import ProductCard from "../components/ProductCard";
import { useFavorites } from "../contexts/FavoritesContext";
import { useIsMobile } from "../hooks/useIsMobile";

export default function Favoritos() {
  const isMobile = useIsMobile();
  const { favorites, clearFavorites } = useFavorites();

  return (
    <div>
      <div style={{ ...styles.pageHeader, marginBottom: isMobile ? 28 : styles.pageHeader.marginBottom } as CSSProperties}>
        <h1 style={{ ...styles.pageTitle, fontSize: isMobile ? 30 : styles.pageTitle.fontSize } as CSSProperties}>
          Meus Favoritos
        </h1>
        <p style={{ ...styles.pageSubtitle, fontSize: isMobile ? 15 : styles.pageSubtitle.fontSize } as CSSProperties}>
          {favorites.length === 0
            ? "Guarde peças para encontrar depois."
            : `Você tem ${favorites.length} peça${favorites.length !== 1 ? "s" : ""} salva${favorites.length !== 1 ? "s" : ""}`}
        </p>
      </div>

      {favorites.length === 0 ? (
        <EmptyState
          icon={Heart}
          title="NENHUMA PEÇA SALVA"
          text="Use o coração nos produtos para guardar suas peças favoritas e encontrá-las rapidamente depois."
          action={{ label: "EXPLORAR PRODUTOS", to: "/produtos" }}
          style={{ padding: isMobile ? 36 : undefined }}
        />
      ) : (
        <>
          <div
            style={{
              ...styles.productsGrid,
              gridTemplateColumns: isMobile ? "1fr" : styles.productsGrid.gridTemplateColumns,
              gap: isMobile ? 16 : styles.productsGrid.gap,
            } as CSSProperties}
          >
            {favorites.map((produto, idx) => (
              <div
                key={produto.id}
                style={{
                  animation: `fadeInUp 0.5s ease-out ${idx * 100}ms backwards`,
                }}
              >
                <ProductCard product={produto} />
              </div>
            ))}
          </div>

          <div style={styles.actionSection as CSSProperties}>
            <Link to="/produtos" style={styles.continueShopping as CSSProperties}>
              Continuar Comprando
            </Link>
            <button
              onClick={() => {
                if (window.confirm("Tem certeza que deseja limpar todos os favoritos?")) {
                  clearFavorites();
                }
              }}
              style={styles.clearButton as CSSProperties}
              onMouseEnter={(e) => {
                const btn = e.currentTarget as HTMLElement;
                btn.style.background = "#991b1b";
              }}
              onMouseLeave={(e) => {
                const btn = e.currentTarget as HTMLElement;
                btn.style.background = "#dc2626";
              }}
            >
              Limpar Favoritos
            </button>
          </div>
        </>
      )}
    </div>
  );
}

const styles: Record<string, CSSProperties> = {
  pageHeader: {
    marginBottom: 48,
  },
  pageTitle: {
    fontSize: 40,
    fontWeight: 900,
    color: "#f0ede8",
    margin: 0,
    marginBottom: 12,
  },
  pageSubtitle: {
    fontSize: 18,
    color: "#9ca3af",
    margin: 0,
  },
  emptyState: {
    textAlign: "center",
    padding: 80,
    background: "#111111",
    borderRadius: 16,
    border: "1px dashed #3a3a3a",
  },
  emptyIcon: {
    fontSize: 66,
    marginBottom: 20,
    color: "#d4d4d8",
    fontWeight: 700,
    letterSpacing: "0.08em",
  },
  emptyTitle: {
    fontSize: 28,
    fontWeight: 900,
    color: "#f0ede8",
    marginBottom: 16,
  },
  emptyText: {
    fontSize: 16,
    color: "#9ca3af",
    marginBottom: 32,
    maxWidth: 460,
    margin: "0 auto 32px",
  },
  emptyButton: {
    display: "inline-block",
    padding: "14px 40px",
    background: "linear-gradient(135deg, #1a1a1a 0%, #3a3a3a 100%)",
    color: "white",
    borderRadius: 8,
    fontWeight: 700,
    fontSize: 16,
    transition: "all 0.3s ease",
  },
  productsGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))",
    gap: 32,
    marginBottom: 48,
  },
  actionSection: {
    display: "flex",
    gap: 16,
    justifyContent: "center",
    flexWrap: "wrap",
    paddingTop: 32,
    borderTop: "1px solid #262626",
  },
  continueShopping: {
    display: "inline-block",
    padding: "12px 32px",
    background: "#0f0f0f",
    color: "#f0ede8",
    border: "1px solid #2f2f2f",
    borderRadius: 8,
    fontWeight: 700,
    fontSize: 14,
    transition: "all 0.3s ease",
    cursor: "pointer",
  },
  clearButton: {
    padding: "12px 32px",
    background: "#dc2626",
    color: "white",
    border: "none",
    borderRadius: 8,
    fontWeight: 700,
    fontSize: 14,
    cursor: "pointer",
    transition: "all 0.3s ease",
  },
};


