import { Link } from "react-router-dom";
import "./TrocasDevolucoes.css";

const sections = [
  {
    number: "01",
    title: "Arrependimento de compra online",
    paragraphs: [
      "Nas compras realizadas fora do estabelecimento comercial, inclusive pela internet, o consumidor pode exercer o direito de arrependimento no prazo legal de 7 dias, contado da assinatura ou do recebimento do produto, conforme o caso.",
      "O pedido pode ser feito pelos canais de atendimento da loja. O exercício desse direito não deve gerar ônus ao consumidor; os valores pagos durante o prazo de reflexão são restituídos conforme a legislação aplicável.",
    ],
  },
  {
    number: "02",
    title: "Defeito, avaria ou produto diferente",
    paragraphs: [
      "Se a peça chegar avariada, apresentar um vício ou não corresponder ao produto comprado, entre em contato para registrar o ocorrido e receber orientação. Fotos podem ajudar a compreender a situação, mas não substituem nem condicionam os direitos previstos em lei.",
      "A garantia legal e as alternativas disponíveis são preservadas nos termos do Código de Defesa do Consumidor. A solução aplicável depende das circunstâncias do caso e dos prazos legais.",
    ],
  },
  {
    number: "03",
    title: "Troca por tamanho, cor ou preferência",
    paragraphs: [
      "Uma troca comercial por preferência é diferente do arrependimento legal e da solução de vícios. Para consultar a possibilidade e as condições aplicáveis à sua compra, fale com a equipe antes de enviar o produto.",
      "Esta orientação não limita o direito de arrependimento nem a garantia legal do consumidor.",
    ],
  },
];

export default function TrocasDevolucoes() {
  return (
    <main className="l4-returns-page">
      <header className="l4-returns-header">
        <span className="l4-returns-eyebrow">PÓS-VENDA / ORIENTAÇÕES</span>
        <h1>TROCAS E DEVOLUÇÕES</h1>
        <p>Entenda a diferença entre arrependimento, garantia legal e troca comercial — e saiba como falar com a L4CKOS.</p>
      </header>

      <div className="l4-returns-sections">
        {sections.map(section => (
          <section className="l4-returns-section" key={section.number}>
            <span className="l4-returns-number" aria-hidden="true">{section.number}</span>
            <div>
              <h2>{section.title}</h2>
              {section.paragraphs.map(paragraph => <p key={paragraph}>{paragraph}</p>)}
            </div>
          </section>
        ))}
      </div>

      <aside className="l4-returns-contact" aria-labelledby="l4-returns-contact-title">
        <div>
          <span className="l4-returns-eyebrow">PRECISA DE AJUDA?</span>
          <h2 id="l4-returns-contact-title">Fale com a equipe da L4CKOS</h2>
          <p>Envie sua solicitação pela página de contato e, se possível, informe o número do pedido e explique o que aconteceu. A equipe orientará os próximos passos.</p>
        </div>
        <Link to="/contato?assunto=troca_devolucao" className="l4-returns-action">SOLICITAR ATENDIMENTO <span aria-hidden="true">→</span></Link>
      </aside>
    </main>
  );
}
