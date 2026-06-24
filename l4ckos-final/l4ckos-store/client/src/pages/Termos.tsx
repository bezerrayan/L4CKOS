/**
 * Página Termos de Uso e Condições de Compra
 */

import { useEffect } from "react";
import type { CSSProperties } from "react";
import { contactChannels } from "../config/site";

export default function Termos() {
  useEffect(() => {
    window.scrollTo(0, 0);
  }, []);

  return (
    <div style={styles.container as CSSProperties}>
      <div style={styles.hero as CSSProperties}>
        <h1 style={styles.title}>Termos de Uso e Condições de Compra</h1>
        <p style={styles.subtitle}>
          Última atualização: {new Date().toLocaleDateString("pt-BR")}
        </p>
      </div>

      <div style={styles.content as CSSProperties}>
        <section style={styles.section as CSSProperties}>
          <h2 style={styles.sectionTitle as CSSProperties}>1. Objeto</h2>
          <p style={styles.text as CSSProperties}>
            Estes Termos regulam o acesso ao site da L4CKOS e as condições aplicáveis
            às compras realizadas pelos canais digitais da marca. Ao navegar, criar
            conta ou concluir um pedido, você declara que leu e compreendeu estas
            regras.
          </p>
        </section>

        <section style={styles.section as CSSProperties}>
          <h2 style={styles.sectionTitle as CSSProperties}>2. Cadastro e segurança da conta</h2>
          <p style={styles.text as CSSProperties}>
            Você é responsável por fornecer informações corretas, atualizadas e
            completas, bem como por manter a confidencialidade de sua senha e dos
            dados de acesso da conta.
          </p>
          <ul style={styles.list as CSSProperties}>
            <li>Não compartilhe sua senha com terceiros.</li>
            <li>Mantenha seu e-mail e telefone atualizados para contato sobre pedidos.</li>
            <li>Comunique imediatamente qualquer uso não autorizado de sua conta.</li>
          </ul>
        </section>

        <section style={styles.section as CSSProperties}>
          <h2 style={styles.sectionTitle as CSSProperties}>3. Produtos, preços e disponibilidade</h2>
          <p style={styles.text as CSSProperties}>
            As ofertas apresentadas no site contêm informações essenciais sobre os
            produtos, incluindo descrição, preço, formas de pagamento e condições de
            entrega. A disponibilidade está sujeita ao estoque no momento da
            confirmação do pedido.
          </p>
          <ul style={styles.list as CSSProperties}>
            <li>Os preços exibidos no site são informados em reais.</li>
            <li>O valor final da compra é apresentado antes da conclusão do pedido.</li>
            <li>
              Imagens, cores e medidas podem sofrer pequenas variações em razão de
              iluminação, monitor ou lote, sem prejuízo das características essenciais
              do produto.
            </li>
            <li>
              Em caso de erro material evidente de preço ou descrição, a L4CKOS poderá
              entrar em contato para corrigir a informação antes da conclusão da venda.
            </li>
          </ul>
        </section>

        <section style={styles.section as CSSProperties}>
          <h2 style={styles.sectionTitle as CSSProperties}>4. Pedido, pagamento e confirmação</h2>
          <p style={styles.text as CSSProperties}>
            O envio do pedido pelo cliente representa uma proposta de compra. A
            confirmação definitiva ocorre após a aprovação do pagamento e a validação
            dos dados da transação.
          </p>
          <ul style={styles.list as CSSProperties}>
            <li>Você receberá confirmação do pedido pelos canais informados no cadastro.</li>
            <li>Os meios de pagamento disponíveis são exibidos no checkout.</li>
            <li>
              Pedidos com indício consistente de fraude, inconsistência cadastral ou
              impossibilidade de processamento podem ser suspensos para verificação.
            </li>
          </ul>
        </section>

        <section style={styles.section as CSSProperties}>
          <h2 style={styles.sectionTitle as CSSProperties}>5. Entrega</h2>
          <p style={styles.text as CSSProperties}>
            O prazo e o custo de entrega são informados antes da finalização da compra.
            O acompanhamento do pedido pode ser feito pela área do cliente e pelos
            canais de atendimento disponibilizados no site.
          </p>
        </section>

        <section style={styles.section as CSSProperties}>
          <h2 style={styles.sectionTitle as CSSProperties}>
            6. Direito de arrependimento, trocas, devoluções e garantia legal
          </h2>
          <p style={styles.text as CSSProperties}>
            Para compras realizadas fora do estabelecimento físico, o consumidor pode
            exercer o direito de arrependimento em até 7 dias corridos a partir do
            recebimento do produto, nos termos do art. 49 do Código de Defesa do
            Consumidor.
          </p>
          <ul style={styles.list as CSSProperties}>
            <li>
              Para solicitar arrependimento, troca ou devolução, utilize a página de
              contato informando o número do pedido e o motivo da solicitação.
            </li>
            <li>
              Em caso de defeito ou divergência no envio, a L4CKOS orientará o
              procedimento de análise e a logística reversa quando aplicável.
            </li>
            <li>
              A garantia legal segue os prazos do CDC: 30 dias para produtos não
              duráveis e 90 dias para produtos duráveis, contados na forma da lei.
            </li>
            <li>
              O reembolso, quando devido, será realizado conforme o meio de pagamento
              utilizado e os prazos operacionais da instituição financeira.
            </li>
          </ul>
        </section>

        <section style={styles.section as CSSProperties}>
          <h2 style={styles.sectionTitle as CSSProperties}>7. Atendimento ao consumidor</h2>
          <p style={styles.text as CSSProperties}>
            A L4CKOS disponibiliza atendimento para dúvidas, pedidos, trocas,
            devoluções e suporte pós-venda pelos canais oficiais informados nesta
            página e na página de contato.
          </p>
        </section>

        <section style={styles.section as CSSProperties}>
          <h2 style={styles.sectionTitle as CSSProperties}>8. Propriedade intelectual</h2>
          <p style={styles.text as CSSProperties}>
            Textos, imagens, identidade visual, logotipos, layout e demais conteúdos
            do site pertencem à L4CKOS ou aos seus licenciantes. É proibida a
            reprodução, distribuição ou uso comercial sem autorização prévia e
            expressa.
          </p>
        </section>

        <section style={styles.section as CSSProperties}>
          <h2 style={styles.sectionTitle as CSSProperties}>9. Privacidade e proteção de dados</h2>
          <p style={styles.text as CSSProperties}>
            O tratamento de dados pessoais realizado pela L4CKOS observa a legislação
            aplicável, especialmente a Lei Geral de Proteção de Dados Pessoais
            (Lei nº 13.709/2018). Para mais detalhes, consulte nossa Política de
            Privacidade.
          </p>
        </section>

        <section style={styles.section as CSSProperties}>
          <h2 style={styles.sectionTitle as CSSProperties}>10. Alterações destes termos</h2>
          <p style={styles.text as CSSProperties}>
            Estes Termos podem ser atualizados periodicamente para refletir mudanças
            operacionais, legais ou regulatórias. A versão vigente estará sempre
            disponível nesta página com a respectiva data de atualização.
          </p>
        </section>

        <section style={styles.section as CSSProperties}>
          <h2 style={styles.sectionTitle as CSSProperties}>11. Contato</h2>
          <p style={styles.text as CSSProperties}>
            Para dúvidas sobre estes Termos, compras, pedidos ou atendimento ao
            consumidor, utilize nossos canais oficiais:
          </p>
          <div style={styles.contactBox as CSSProperties}>
            <p>
              <strong>E-mail:</strong> {contactChannels.email}
            </p>
            <p>
              <strong>Atendimento:</strong> {contactChannels.responseTime}
            </p>
          </div>
        </section>

        <section style={styles.section as CSSProperties}>
          <h2 style={styles.sectionTitle as CSSProperties}>12. Legislação aplicável</h2>
          <p style={styles.text as CSSProperties}>
            Estes Termos são regidos pela legislação brasileira, em especial pelo
            Código de Defesa do Consumidor, pelo Código Civil e pelo Decreto nº
            7.962/2013, sem prejuízo de outros direitos assegurados ao consumidor.
          </p>
        </section>
      </div>
    </div>
  );
}

const styles: Record<string, CSSProperties> = {
  container: {
    minHeight: "100vh",
    paddingBottom: 80,
  },
  hero: {
    background: "linear-gradient(135deg, #1a1a1a 0%, #2d2d2d 100%)",
    color: "white",
    padding: "60px 40px",
    textAlign: "center",
    marginBottom: 40,
  },
  title: {
    fontSize: 48,
    fontWeight: 900,
    margin: 0,
    marginBottom: 16,
    color: "white",
  },
  subtitle: {
    fontSize: 16,
    color: "rgba(255, 255, 255, 0.8)",
    margin: 0,
  },
  content: {
    maxWidth: 900,
    margin: "0 auto",
    padding: "0 40px 60px",
  },
  section: {
    marginBottom: 48,
  },
  sectionTitle: {
    fontSize: 24,
    fontWeight: 800,
    color: "#f0ede8",
    margin: "0 0 16px 0",
  },
  text: {
    fontSize: 15,
    color: "#a6a6a6",
    lineHeight: "1.8",
    margin: "0 0 16px 0",
  },
  list: {
    fontSize: 15,
    color: "#a6a6a6",
    lineHeight: "1.8",
    paddingLeft: 24,
    margin: 0,
  },
  contactBox: {
    padding: 24,
    background: "#151515",
    borderRadius: 12,
    border: "1px solid #2a2a2a",
    marginTop: 16,
  },
};
