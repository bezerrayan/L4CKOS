import { Link } from "react-router-dom";
import type { CSSProperties } from "react";

const sections = [
  {
    number: "01",
    title: "Direito de arrependimento",
    text:
      "Nas compras realizadas pela internet, o consumidor pode solicitar o cancelamento em até 7 dias corridos contados do recebimento do produto, nos termos da legislação aplicável.",
  },
  {
    number: "02",
    title: "Troca por tamanho ou preferência",
    text:
      "A política operacional para trocas voluntárias por tamanho ou preferência ainda precisa ser definida pela L4CKOS antes do lançamento. Enquanto isso, não há promessa pública de prazo, gratuidade, coleta ou frete reverso fora das hipóteses legais aplicáveis.",
  },
  {
    number: "03",
    title: "Defeito, avaria ou produto incorreto",
    text:
      "Caso o produto apresente defeito, seja recebido com avaria ou seja diferente do item comprado, entre em contato para que a situação seja analisada e o procedimento adequado seja informado.",
  },
  {
    number: "04",
    title: "Como solicitar",
    text:
      "Acesse a página de contato, escolha o assunto de troca ou devolução, informe o número do pedido e o motivo da solicitação. Fotos do produto ou da embalagem podem ajudar na análise.",
  },
  {
    number: "05",
    title: "Reembolso",
    text:
      "Quando houver reembolso, ele será solicitado pelo mesmo meio de pagamento utilizado na compra, respeitando os procedimentos e prazos da instituição responsável.",
  },
];

export default function TrocasDevolucoes() {
  return (
    <section style={styles.wrapper}>
      <header style={styles.header}>
        <h1 style={styles.title}>TROCAS E DEVOLUÇÕES</h1>
        <p style={styles.subtitle}>
          Informações sobre arrependimento, troca, devolução, defeitos e atendimento pós-venda.
        </p>
      </header>

      <div style={styles.timeline}>
        {sections.map((section) => (
          <article key={section.title} style={styles.item}>
            <span style={styles.number}>{section.number}</span>
            <div>
              <h2 style={styles.cardTitle}>{section.title}</h2>
              <p style={styles.cardText}>{section.text}</p>
            </div>
          </article>
        ))}
      </div>

      <div style={styles.cta}>
        <p style={styles.cardText}>Para iniciar a solicitação, entre em contato pelos canais oficiais informando o número do pedido.</p>
        <Link to="/contato?assunto=troca_devolucao" style={styles.ctaButton}>SOLICITAR ATENDIMENTO</Link>
      </div>
    </section>
  );
}

const styles: Record<string, CSSProperties> = {
  wrapper: { maxWidth: 920, margin: "0 auto", display: "grid", gap: 24, color: "#f0ede8" },
  header: { borderBottom: "1px solid #2a2a2a", paddingBottom: 22 },
  title: { margin: 0, fontSize: 42, color: "#f0ede8", fontWeight: 800 },
  subtitle: { margin: "10px 0 0", color: "#c8c1ba", fontSize: 16, lineHeight: 1.7, maxWidth: 720 },
  timeline: { display: "grid", gap: 14 },
  item: {
    display: "grid",
    gridTemplateColumns: "54px 1fr",
    gap: 16,
    border: "1px solid #2a2a2a",
    background: "#111",
    padding: 18,
  },
  number: {
    width: 44,
    height: 44,
    border: "1px solid #3a3a3a",
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    color: "#e8002a",
    fontFamily: '"Space Mono", monospace',
    fontSize: 12,
    fontWeight: 800,
  },
  cardTitle: { margin: 0, color: "#f0ede8", fontSize: 22 },
  cardText: { margin: "8px 0 0", color: "#c8c1ba", lineHeight: 1.75, fontSize: 15 },
  cta: { border: "1px solid #333", background: "#0f0f0f", padding: 20, display: "grid", gap: 14 },
  ctaButton: {
    justifySelf: "start",
    display: "inline-flex",
    minHeight: 44,
    alignItems: "center",
    padding: "11px 18px",
    background: "#e8002a",
    color: "#fff",
    textDecoration: "none",
    fontFamily: '"Space Mono", monospace',
    fontSize: 11,
    fontWeight: 800,
    letterSpacing: "0.1em",
  },
};
