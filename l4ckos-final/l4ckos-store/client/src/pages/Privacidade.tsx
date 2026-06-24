/**
 * Página Política de Privacidade
 */

import { useEffect } from "react";
import type { CSSProperties } from "react";
import { contactChannels } from "../config/site";

export default function Privacidade() {
  useEffect(() => {
    window.scrollTo(0, 0);
  }, []);

  return (
    <div style={styles.container as CSSProperties}>
      <div style={styles.hero as CSSProperties}>
        <h1 style={styles.title}>Política de Privacidade</h1>
        <p style={styles.subtitle}>
          Última atualização: {new Date().toLocaleDateString("pt-BR")}
        </p>
      </div>

      <div style={styles.content as CSSProperties}>
        <section style={styles.section as CSSProperties}>
          <h2 style={styles.sectionTitle as CSSProperties}>1. Introdução</h2>
          <p style={styles.text as CSSProperties}>
            A L4CKOS respeita sua privacidade e trata dados pessoais de acordo com a
            legislação aplicável, especialmente a Lei Geral de Proteção de Dados
            Pessoais (LGPD). Esta Política explica quais informações coletamos, para
            quais finalidades e como você pode exercer seus direitos.
          </p>
        </section>

        <section style={styles.section as CSSProperties}>
          <h2 style={styles.sectionTitle as CSSProperties}>2. Dados que podemos coletar</h2>
          <p style={styles.text as CSSProperties}>
            Os dados tratados variam conforme a forma de uso do site e os serviços
            solicitados por você.
          </p>
          <h3 style={styles.subTitle as CSSProperties}>Dados informados diretamente:</h3>
          <ul style={styles.list as CSSProperties}>
            <li>Nome completo;</li>
            <li>E-mail;</li>
            <li>Telefone;</li>
            <li>CPF, quando necessário para faturamento ou entrega;</li>
            <li>Endereço de entrega e cobrança;</li>
            <li>Informações relacionadas ao pedido e ao atendimento.</li>
          </ul>
          <h3 style={styles.subTitle as CSSProperties}>Dados coletados automaticamente:</h3>
          <ul style={styles.list as CSSProperties}>
            <li>Endereço IP e dados de conexão;</li>
            <li>Dispositivo, navegador e sistema operacional;</li>
            <li>Páginas acessadas e interações com o site;</li>
            <li>Cookies e identificadores semelhantes.</li>
          </ul>
        </section>

        <section style={styles.section as CSSProperties}>
          <h2 style={styles.sectionTitle as CSSProperties}>3. Finalidades e bases legais</h2>
          <p style={styles.text as CSSProperties}>
            Tratamos seus dados pessoais para executar o contrato de compra e venda,
            prestar atendimento, cumprir obrigações legais e proteger a segurança das
            operações.
          </p>
          <ul style={styles.list as CSSProperties}>
            <li>Processar pagamentos, pedidos, entregas e reembolsos;</li>
            <li>Responder contatos, reclamações, trocas e devoluções;</li>
            <li>Prevenir fraude e aumentar a segurança da conta;</li>
            <li>Cumprir obrigações fiscais, regulatórias e de defesa do consumidor;</li>
            <li>Enviar comunicações promocionais, quando houver consentimento ou base legal aplicável.</li>
          </ul>
        </section>

        <section style={styles.section as CSSProperties}>
          <h2 style={styles.sectionTitle as CSSProperties}>4. Compartilhamento de dados</h2>
          <p style={styles.text as CSSProperties}>
            Não comercializamos seus dados pessoais. O compartilhamento pode ocorrer
            apenas quando necessário para a operação do serviço ou para cumprimento de
            obrigação legal.
          </p>
          <ul style={styles.list as CSSProperties}>
            <li>Processadores de pagamento e instituições financeiras;</li>
            <li>Plataformas de envio, logística e antifraude;</li>
            <li>Prestadores de tecnologia, hospedagem, e-mail e suporte;</li>
            <li>Autoridades públicas, quando houver obrigação legal ou regulatória.</li>
          </ul>
        </section>

        <section style={styles.section as CSSProperties}>
          <h2 style={styles.sectionTitle as CSSProperties}>5. Cookies e tecnologias semelhantes</h2>
          <p style={styles.text as CSSProperties}>
            Utilizamos cookies e tecnologias similares para autenticação, segurança,
            desempenho e melhoria da navegação. Você pode gerenciar preferências de
            cookies diretamente em seu navegador, observando que determinadas funções
            do site podem depender deles para operar corretamente.
          </p>
        </section>

        <section style={styles.section as CSSProperties}>
          <h2 style={styles.sectionTitle as CSSProperties}>6. Armazenamento e segurança</h2>
          <p style={styles.text as CSSProperties}>
            Adotamos medidas técnicas e administrativas razoáveis para proteger os
            dados pessoais contra acessos não autorizados, destruição, perda, alteração
            ou qualquer forma de tratamento inadequado ou ilícito. Ainda assim, nenhum
            ambiente digital é completamente imune a riscos.
          </p>
        </section>

        <section style={styles.section as CSSProperties}>
          <h2 style={styles.sectionTitle as CSSProperties}>7. Retenção dos dados</h2>
          <p style={styles.text as CSSProperties}>
            Mantemos os dados pessoais pelo prazo necessário para cumprir as
            finalidades desta Política, atender exigências legais, fiscais e
            regulatórias, e resguardar o exercício regular de direitos em processos
            administrativos, arbitrais ou judiciais.
          </p>
        </section>

        <section style={styles.section as CSSProperties}>
          <h2 style={styles.sectionTitle as CSSProperties}>8. Seus direitos</h2>
          <p style={styles.text as CSSProperties}>
            Nos termos da LGPD, você pode solicitar, quando aplicável:
          </p>
          <ul style={styles.list as CSSProperties}>
            <li>Confirmação da existência de tratamento;</li>
            <li>Acesso aos dados pessoais;</li>
            <li>Correção de dados incompletos, inexatos ou desatualizados;</li>
            <li>Anonimização, bloqueio ou eliminação de dados desnecessários;</li>
            <li>Portabilidade, observado o segredo comercial e regulatório;</li>
            <li>Informações sobre compartilhamento;</li>
            <li>Revogação do consentimento, quando esta for a base legal aplicável.</li>
          </ul>
        </section>

        <section style={styles.section as CSSProperties}>
          <h2 style={styles.sectionTitle as CSSProperties}>9. Marketing e comunicações</h2>
          <p style={styles.text as CSSProperties}>
            Comunicações promocionais podem ser enviadas de acordo com a legislação
            aplicável e com suas preferências. Você pode solicitar o cancelamento
            dessas mensagens a qualquer momento pelos canais informados no próprio
            e-mail ou entrando em contato conosco.
          </p>
        </section>

        <section style={styles.section as CSSProperties}>
          <h2 style={styles.sectionTitle as CSSProperties}>10. Links de terceiros</h2>
          <p style={styles.text as CSSProperties}>
            O site pode conter links para páginas de terceiros. Esta Política não se
            aplica a ambientes externos e a L4CKOS não controla as práticas de
            privacidade adotadas por esses terceiros.
          </p>
        </section>

        <section style={styles.section as CSSProperties}>
          <h2 style={styles.sectionTitle as CSSProperties}>11. Crianças e adolescentes</h2>
          <p style={styles.text as CSSProperties}>
            O site não é direcionado especificamente a crianças. Caso seja constatado
            tratamento inadequado de dados de crianças ou adolescentes em desacordo
            com a legislação, as medidas cabíveis serão adotadas para correção da
            situação.
          </p>
        </section>

        <section style={styles.section as CSSProperties}>
          <h2 style={styles.sectionTitle as CSSProperties}>12. Alterações nesta política</h2>
          <p style={styles.text as CSSProperties}>
            Esta Política pode ser atualizada para refletir mudanças legais,
            regulatórias ou operacionais. A versão mais recente permanecerá
            disponível nesta página, com a respectiva data de atualização.
          </p>
        </section>

        <section style={styles.section as CSSProperties}>
          <h2 style={styles.sectionTitle as CSSProperties}>13. Contato sobre privacidade</h2>
          <p style={styles.text as CSSProperties}>
            Se você quiser exercer direitos previstos na LGPD ou tiver dúvidas sobre o
            tratamento de seus dados, entre em contato pelos canais abaixo:
          </p>
          <div style={styles.contactBox as CSSProperties}>
            <p>
              <strong>E-mail:</strong> {contactChannels.email}
            </p>
            <p>
              <strong>Canal de atendimento:</strong> {contactChannels.responseTime}
            </p>
          </div>
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
  subTitle: {
    fontSize: 16,
    fontWeight: 700,
    color: "#d3d3d3",
    margin: "24px 0 12px 0",
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
    margin: "0 0 16px 0",
  },
  contactBox: {
    padding: 24,
    background: "#151515",
    borderRadius: 12,
    border: "1px solid #2a2a2a",
    marginTop: 16,
  },
};
