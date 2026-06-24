export default function Forbidden() {
  return (
    <main className="l4-page-shell" style={{ minHeight: "60vh", display: "grid", placeItems: "center", padding: 24 }}>
      <section style={{ maxWidth: 560, width: "100%", textAlign: "center" }}>
        <p style={{ color: "#e8271a", fontWeight: 700, letterSpacing: "0.16em", textTransform: "uppercase" }}>
          403
        </p>
        <h1 style={{ margin: "8px 0 12px", fontSize: 32 }}>Acesso restrito</h1>
        <p style={{ color: "#a8a8a8", lineHeight: 1.7 }}>
          Sua conta está autenticada, mas não tem permissão administrativa para acessar esta área.
        </p>
      </section>
    </main>
  );
}
