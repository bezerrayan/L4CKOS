import LegalDocument, { type LegalSection } from "../components/LegalDocument";
import { openCookiePreferences } from "../components/CookiePreferences";

const contact = {
  email: "contato@l4ckos.com.br",
  responseTime: "Buscamos responder em até 1 dia útil.",
};

const cookieRows = [
  ["Cookie de sessão", "L4CKOS", "Necessário", "Mantém sessão/autenticação e acesso seguro.", "Sessão configurada pelo servidor."],
  ["l4ckos_csrf", "L4CKOS", "Necessário", "Protege formulários e ações contra CSRF.", "Sessão configurada pelo servidor."],
  ["oauth_state", "L4CKOS / Google OAuth", "Necessário", "Valida temporariamente o retorno do login com Google.", "Temporário, durante o fluxo de login."],
  ["loja-escoteira:cart", "L4CKOS", "Necessário", "Mantém os itens da sacola no navegador.", "Até remoção pelo usuário ou limpeza do navegador."],
  ["l4ckos:cookie-preferences", "L4CKOS", "Necessário", "Registra a escolha de preferências de cookies.", "Até mudança de versão da política ou limpeza do navegador."],
];

const sections: LegalSection[] = [
  {
    id: "introducao",
    title: "1. Introdução",
    content: (
      <p>
        Esta Política explica como a L4CKOS trata dados pessoais no site, na loja online, nos formulários de contato, na lista de lançamento e nos fluxos de conta, pedidos e atendimento.
      </p>
    ),
  },
  {
    id: "controlador",
    title: "2. Quem controla os dados",
    content: (
      <div className="l4-legal-box">
        <p><strong>Marca:</strong> L4CKOS.</p>
        <p><strong>Responsável atual:</strong> Yan Bezerra.</p>
        <p><strong>Contato:</strong> {contact.email}.</p>
        <p>Dados empresariais como CNPJ, razão social, endereço e eventual encarregado formal de dados ainda precisam ser definidos e revisados antes do lançamento definitivo.</p>
      </div>
    ),
  },
  {
    id: "dados-coletados",
    title: "3. Dados coletados",
    content: (
      <>
        <p>Os dados tratados dependem da forma de uso do site.</p>
        <h3>Dados informados diretamente</h3>
        <ul>
          <li>Nome, e-mail, telefone opcional e mensagem em formulários.</li>
          <li>Dados de conta, cadastro e redefinição de senha.</li>
          <li>Endereço, itens do pedido, variações escolhidas e informações necessárias para compra e entrega.</li>
          <li>Dados fornecidos em solicitações de troca, devolução, suporte ou privacidade.</li>
        </ul>
        <h3>Dados tratados automaticamente</h3>
        <ul>
          <li>Endereço IP, registros técnicos e logs de segurança.</li>
          <li>Cookies necessários e armazenamento local da sacola.</li>
          <li>Informações técnicas de navegação necessárias para funcionamento do site.</li>
        </ul>
      </>
    ),
  },
  {
    id: "coleta",
    title: "4. Como os dados são coletados",
    content: (
      <p>
        Os dados são coletados quando você cria conta, faz login, usa a sacola, realiza pedido, solicita pagamento, envia formulário, entra na lista de lançamento, usa login social ou navega em áreas que geram registros técnicos de segurança.
      </p>
    ),
  },
  {
    id: "finalidades",
    title: "5. Finalidades e bases legais",
    content: (
      <ul>
        <li>Executar compras, pedidos, pagamentos, entrega e atendimento.</li>
        <li>Manter conta, autenticação, segurança e prevenção de abusos.</li>
        <li>Responder solicitações de suporte, troca, devolução e privacidade.</li>
        <li>Cumprir obrigações legais, fiscais, regulatórias e de defesa do consumidor.</li>
        <li>Enviar comunicações de lançamento ou marketing somente quando houver base válida e mecanismo de descadastro.</li>
      </ul>
    ),
  },
  {
    id: "compartilhamento",
    title: "6. Compartilhamento e operadores",
    content: (
      <>
        <p>Não vendemos dados pessoais. O compartilhamento ocorre quando necessário para operação da loja ou cumprimento legal.</p>
        <ul>
          <li>Pagamento: Asaas e instituições envolvidas no processamento.</li>
          <li>E-mail: Resend, quando configurado para comunicações transacionais ou de lista.</li>
          <li>Login social: Google OAuth, quando utilizado pelo usuário.</li>
          <li>Tecnologia: hospedagem, banco MySQL/Drizzle e infraestrutura usada pelo projeto.</li>
          <li>Armazenamento de arquivos/imagens: AWS S3 SDK quando o recurso de upload estiver configurado.</li>
        </ul>
      </>
    ),
  },
  {
    id: "transferencias",
    title: "7. Transferências internacionais",
    content: (
      <p>
        Alguns fornecedores de tecnologia, autenticação, e-mail, hospedagem ou pagamento podem operar infraestrutura fora do Brasil. Essa avaliação deve ser revisada conforme os provedores efetivamente contratados para produção.
      </p>
    ),
  },
  {
    id: "cookies",
    title: "8. Cookies e tecnologias semelhantes",
    content: (
      <>
        <p>Cookies são pequenos arquivos ou identificadores usados para manter recursos do site funcionando. Também há dados guardados no armazenamento local do navegador, como a sacola.</p>
        <p>No momento, não foram identificados analytics, Google Tag Manager, pixels de publicidade, remarketing ou gravação de sessão carregando no site público.</p>
        <table className="l4-legal-cookie-table">
          <thead>
            <tr>
              <th>Nome</th>
              <th>Provedor</th>
              <th>Categoria</th>
              <th>Finalidade</th>
              <th>Duração</th>
            </tr>
          </thead>
          <tbody>
            {cookieRows.map(row => (
              <tr key={row[0]}>
                {row.map(cell => <td key={cell}>{cell}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
        <p>Bloquear cookies necessários no navegador pode impedir login, segurança, sacola e envio de formulários.</p>
        <button type="button" className="l4-legal-action secondary" onClick={openCookiePreferences}>ABRIR PREFERÊNCIAS DE COOKIES</button>
      </>
    ),
  },
  {
    id: "retencao",
    title: "9. Armazenamento e retenção",
    content: (
      <>
        <p>Os prazos específicos ainda precisam ser definidos operacionalmente e revisados juridicamente. Como orientação, a retenção deve observar finalidade, obrigações legais e necessidade de defesa de direitos.</p>
        <ul>
          <li>Dados da conta: enquanto a conta existir ou houver obrigação aplicável.</li>
          <li>Pedidos e dados fiscais: conforme exigências legais e de defesa do consumidor.</li>
          <li>Atendimento: pelo período necessário para resolver a solicitação e manter histórico mínimo.</li>
          <li>Logs de segurança: pelo tempo necessário para proteção, auditoria e investigação de incidentes.</li>
          <li>Marketing/lista: até descadastro, revogação ou limpeza da base conforme política definida.</li>
        </ul>
      </>
    ),
  },
  {
    id: "seguranca",
    title: "10. Segurança",
    content: (
      <p>
        A L4CKOS adota medidas técnicas e administrativas para proteger dados contra acessos não autorizados, perda, alteração ou uso indevido. Nenhum ambiente digital é totalmente isento de riscos.
      </p>
    ),
  },
  {
    id: "direitos",
    title: "11. Direitos do titular",
    content: (
      <>
        <p>Nos termos da LGPD, você pode solicitar confirmação de tratamento, acesso, correção, eliminação quando aplicável, informação sobre compartilhamento, revogação de consentimento, oposição e portabilidade observadas as condições legais.</p>
        <a className="l4-legal-action" href="/contato?assunto=privacidade">SOLICITAR ATENDIMENTO DE PRIVACIDADE</a>
      </>
    ),
  },
  {
    id: "marketing",
    title: "12. Marketing e comunicações",
    content: (
      <p>
        Comunicações promocionais dependem de base válida e devem permitir descadastro. A rejeição de marketing não deve impedir a compra ou o uso de recursos essenciais da loja.
      </p>
    ),
  },
  {
    id: "criancas-adolescentes",
    title: "13. Crianças e adolescentes",
    content: (
      <p>
        A L4CKOS pode ser acessada por adolescentes. O tratamento de dados e as experiências oferecidas devem observar a legislação aplicável e considerar a proteção desse público. Esta seção precisa de revisão jurídica considerando o público real da marca.
      </p>
    ),
  },
  {
    id: "links",
    title: "14. Links de terceiros",
    content: (
      <p>
        O site pode conter links para ambientes de terceiros, como login social, pagamento ou redes sociais. Esses ambientes possuem políticas próprias.
      </p>
    ),
  },
  {
    id: "alteracoes",
    title: "15. Alterações",
    content: (
      <p>
        Esta Política pode ser atualizada para refletir mudanças legais, técnicas ou operacionais. A data deve ser alterada somente quando houver revisão do conteúdo.
      </p>
    ),
  },
  {
    id: "contato",
    title: "16. Contato de privacidade",
    content: (
      <div className="l4-legal-box">
        <p><strong>E-mail:</strong> {contact.email}</p>
        <p><strong>Atendimento:</strong> {contact.responseTime}</p>
      </div>
    ),
  },
];

export default function Privacidade() {
  return (
    <LegalDocument
      title="POLÍTICA DE PRIVACIDADE E COOKIES"
      description="Como a L4CKOS trata dados pessoais, cookies, segurança e preferências de privacidade no site."
      updatedAt="24/06/2026"
      sections={sections}
    />
  );
}
