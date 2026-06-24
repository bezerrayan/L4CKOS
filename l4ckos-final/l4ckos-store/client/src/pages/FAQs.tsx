import { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import type { CSSProperties } from "react";
import { useIsMobile } from "../hooks/useIsMobile";
import { contactChannels, getWhatsAppUrl } from "../config/site";

interface FAQ {
  id: number;
  pergunta: string;
  resposta: string;
  categoria: string;
}

const FAQS: FAQ[] = [
  { id: 1, categoria: "Pedidos", pergunta: "Como faço um pedido?", resposta: "Navegue pela loja, adicione os produtos à sacola e conclua a compra no checkout." },
  { id: 2, categoria: "Pedidos", pergunta: "Qual é o prazo de entrega?", resposta: "O prazo varia conforme o CEP, a transportadora e a modalidade escolhida no fechamento do pedido." },
  { id: 3, categoria: "Pedidos", pergunta: "Existe valor mínimo para compra?", resposta: "Não há valor mínimo para comprar no site." },
  { id: 4, categoria: "Pagamento", pergunta: "Quais formas de pagamento são aceitas?", resposta: "Aceitamos PIX, boleto e cartão, conforme as opções exibidas no checkout." },
  { id: 5, categoria: "Pagamento", pergunta: "Posso parcelar o pedido?", resposta: "Sim. O parcelamento disponível aparece no checkout, de acordo com as condições do meio de pagamento." },
  { id: 6, categoria: "Devolução", pergunta: "Qual é a política de devolução?", resposta: "Você pode solicitar devolução dentro do prazo legal e conforme as condições informadas na página de trocas e devoluções." },
  { id: 7, categoria: "Devolução", pergunta: "E se o produto chegar com defeito?", resposta: "Entre em contato com o número do pedido e, se possível, envie fotos para análise e orientação do atendimento." },
  { id: 8, categoria: "Conta", pergunta: "Como criar uma conta?", resposta: "Use a tela de cadastro e preencha os dados obrigatórios para finalizar o registro." },
  { id: 9, categoria: "Conta", pergunta: "Esqueci minha senha. O que faço?", resposta: "Use a opção de redefinição de senha na tela de login." },
  { id: 10, categoria: "Produtos", pergunta: "Os produtos têm garantia?", resposta: "Sim. A garantia legal e as regras aplicáveis variam conforme o tipo de produto e a legislação." },
];

const CATEGORIAS = ["Todos", "Pedidos", "Pagamento", "Devolução", "Conta", "Produtos"];

export default function FAQs() {
  const isMobile = useIsMobile();
  const [categoriaSelecionada, setCategoriaSelecionada] = useState("Todos");
  const [faqAberta, setFaqAberta] = useState<number | null>(null);
  const whatsappUrl = getWhatsAppUrl();

  useEffect(() => {
    window.scrollTo(0, 0);
  }, []);

  const faqsFiltradas =
    categoriaSelecionada === "Todos"
      ? FAQS
      : FAQS.filter((faq) => faq.categoria === categoriaSelecionada);

  return (
    <div style={styles.container as CSSProperties}>
      <div style={{ ...styles.hero, padding: isMobile ? "42px 14px" : styles.hero.padding, marginBottom: isMobile ? 30 : styles.hero.marginBottom } as CSSProperties}>
        <h1 style={{ ...styles.title, fontSize: isMobile ? 34 : styles.title.fontSize }}>Perguntas Frequentes</h1>
        <p style={{ ...styles.subtitle, fontSize: isMobile ? 16 : styles.subtitle.fontSize }}>
          Encontre respostas para as dúvidas mais comuns
        </p>
      </div>

      <div style={{ ...styles.filtersSection, padding: isMobile ? "0 14px" : styles.filtersSection.padding, margin: isMobile ? "0 auto 24px" : styles.filtersSection.margin } as CSSProperties}>
        <h2 style={styles.filterTitle as CSSProperties}>Filtrar por categoria</h2>
        <div style={styles.filterButtons as CSSProperties}>
          {CATEGORIAS.map((categoria) => (
            <button
              key={categoria}
              onClick={() => setCategoriaSelecionada(categoria)}
              style={{
                ...styles.filterButton,
                background: categoriaSelecionada === categoria ? "#1a1a1a" : "#151515",
                color: categoriaSelecionada === categoria ? "#ffffff" : "#d8d8d8",
              } as CSSProperties}
            >
              {categoria}
            </button>
          ))}
        </div>
      </div>

      <div
        style={{
          ...styles.faqsContainer,
          gridTemplateColumns: isMobile ? "1fr" : styles.faqsContainer.gridTemplateColumns,
          gap: isMobile ? 20 : styles.faqsContainer.gap,
          padding: isMobile ? "0 14px" : styles.faqsContainer.padding,
        } as CSSProperties}
      >
        <div style={styles.faqsList as CSSProperties}>
          {faqsFiltradas.map((faq) => (
            <div key={faq.id} style={styles.faqItem as CSSProperties} onClick={() => setFaqAberta(faqAberta === faq.id ? null : faq.id)}>
              <div style={styles.faqHeader as CSSProperties}>
                <div style={styles.faqQuestion as CSSProperties}>
                  <span style={styles.faqIcon as CSSProperties}>{faqAberta === faq.id ? "v" : ">"}</span>
                  <h3 style={styles.pergunta as CSSProperties}>{faq.pergunta}</h3>
                </div>
                <span style={styles.faqCategory as CSSProperties}>{faq.categoria}</span>
              </div>
              {faqAberta === faq.id && <div style={styles.resposta as CSSProperties}>{faq.resposta}</div>}
            </div>
          ))}
        </div>

        <div style={styles.sidebar as CSSProperties}>
          <div style={styles.sidebarCard as CSSProperties}>
            <h3 style={styles.sidebarTitle as CSSProperties}>Não encontrou o que procura?</h3>
            <p style={styles.sidebarText as CSSProperties}>Entre em contato pelo formulário da loja e fale com nosso atendimento.</p>
            <Link to="/contato" style={styles.sidebarButton as CSSProperties}>Ir para contato</Link>
          </div>

          {whatsappUrl ? (
            <div style={styles.sidebarCard as CSSProperties}>
              <h3 style={styles.sidebarTitle as CSSProperties}>WhatsApp</h3>
              <p style={styles.sidebarText as CSSProperties}>Atendimento em dias úteis para dúvidas e pós-venda.</p>
              <a href={whatsappUrl} target="_blank" rel="noreferrer" style={styles.sidebarButton as CSSProperties}>Abrir WhatsApp</a>
            </div>
          ) : null}

          <div style={styles.sidebarCard as CSSProperties}>
            <h3 style={styles.sidebarTitle as CSSProperties}>E-mail de atendimento</h3>
            <p style={styles.sidebarText as CSSProperties}>{contactChannels.email}</p>
            <p style={styles.sidebarSubtext as CSSProperties}>{contactChannels.responseTime}</p>
          </div>
        </div>
      </div>
    </div>
  );
}

const styles: Record<string, CSSProperties> = {
  container: { minHeight: "100vh", paddingBottom: 80 },
  hero: {
    background: "linear-gradient(135deg, #1a1a1a 0%, #2d2d2d 100%)",
    color: "white",
    padding: "60px 40px",
    textAlign: "center",
    marginBottom: 60,
  },
  title: { fontSize: 48, fontWeight: 900, color: "#ffffff", margin: 0, marginBottom: 16 },
  subtitle: { fontSize: 18, color: "rgba(255, 255, 255, 0.8)", margin: 0 },
  filtersSection: { maxWidth: 1400, margin: "0 auto 40px", padding: "0 40px" },
  filterTitle: { fontSize: 20, fontWeight: 700, color: "#f0ede8", margin: "0 0 20px 0" },
  filterButtons: { display: "flex", gap: 12, flexWrap: "wrap" },
  filterButton: {
    padding: "10px 20px",
    border: "1px solid #2f2f2f",
    borderRadius: 8,
    fontSize: 14,
    fontWeight: 600,
    cursor: "pointer",
    transition: "all 0.3s ease",
  },
  faqsContainer: {
    display: "grid",
    gridTemplateColumns: "1fr 300px",
    gap: 40,
    maxWidth: 1400,
    margin: "0 auto",
    padding: "0 40px",
  },
  faqsList: { display: "flex", flexDirection: "column", gap: 12 },
  faqItem: { border: "1px solid #2a2a2a", borderRadius: 8, overflow: "hidden", transition: "all 0.3s ease", cursor: "pointer" },
  faqHeader: {
    padding: "20px",
    background: "#121212",
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 16,
  },
  faqQuestion: { display: "flex", gap: 12, alignItems: "center", flex: 1 },
  faqIcon: { display: "inline-flex", alignItems: "center", justifyContent: "center", width: 16, minWidth: 16, fontSize: 11, color: "#bfbfbf", fontWeight: 700 },
  pergunta: { fontSize: 16, fontWeight: 600, color: "#f0ede8", margin: 0 },
  faqCategory: { fontSize: 12, color: "#c3c3c3", background: "#1c1c1c", padding: "4px 12px", border: "1px solid #343434", borderRadius: 20, whiteSpace: "nowrap" },
  resposta: { padding: "20px", background: "#0f0f0f", borderTop: "1px solid #2a2a2a", fontSize: 14, color: "#b4b4b4", lineHeight: "1.7" },
  sidebar: { display: "flex", flexDirection: "column", gap: 20 },
  sidebarCard: { padding: 24, background: "#151515", borderRadius: 12, border: "1px solid #2a2a2a" },
  sidebarTitle: { fontSize: 16, fontWeight: 700, color: "#f0ede8", margin: "0 0 12px 0" },
  sidebarText: { fontSize: 14, color: "#a6a6a6", margin: "0 0 16px 0", lineHeight: "1.6" },
  sidebarSubtext: { fontSize: 12, color: "#8b8b8b", margin: 0 },
  sidebarButton: {
    display: "block",
    width: "100%",
    padding: "12px 16px",
    background: "#1a1a1a",
    color: "white",
    border: "1px solid #2f2f2f",
    borderRadius: 6,
    fontSize: 14,
    fontWeight: 700,
    textAlign: "center",
    textDecoration: "none",
  },
};
