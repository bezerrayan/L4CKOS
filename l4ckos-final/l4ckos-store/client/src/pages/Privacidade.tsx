import LegalDocument, { type LegalSection } from "../components/LegalDocument";
import { openCookiePreferences } from "../components/CookiePreferences";
import { contactChannels } from "../config/site";

const cookieRows = [
  ["app_session_id", "Mantém a sessão da conta; cookie HttpOnly e SameSite=Lax, com duração definida pelo servidor."],
  ["l4ckos_csrf", "Token de proteção contra CSRF; duração definida pelo servidor."],
  ["oauth_state", "Valida temporariamente a resposta do login Google; vida curta durante a autenticação."],
  ["sidebar_state", "Guarda a posição aberta/fechada de uma barra lateral da interface, quando esse componente é usado; até 7 dias."],
];

const browserStorageRows = [
  ["localStorage — loja-escoteira:cart", "Mantém localmente os itens da sacola até remoção ou limpeza dos dados do navegador."],
  ["localStorage — l4ckos:cookie-preferences", "Registra a versão e a data em que o aviso foi encerrado. No código atual, esse registro não controla scripts de medição nem escolhas por categoria; uma nova versão pode reapresentar o aviso sem remover o registro anterior."],
  ["localStorage — app-user-info", "Cache local da resposta da consulta da conta; removido quando a consulta não retorna usuário autenticado."],
  ["localStorage — theme / sidebar-width", "Preferências de aparência/largura de componentes administrativos, quando utilizados."],
  ["sessionStorage — l4ckos:checkout-attempt:[digest]", "Identificador técnico temporário de tentativa de checkout; a implementação guarda UUID e hash da solicitação, não os dados pessoais da solicitação nesse valor."],
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
    title: "2. Contato sobre dados pessoais",
    content: (
      <p>Para dúvidas ou solicitações relacionadas a dados pessoais, entre em contato pelo e-mail <a href={`mailto:${contactChannels.email}`}>{contactChannels.email}</a>.</p>
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
          <li>Cookies de sessão, segurança, autenticação e estado da interface.</li>
          <li>Dados guardados em localStorage e sessionStorage, descritos abaixo.</li>
          <li>Eventos internos de navegação/uso gerados pela interface. Nesta versão local do frontend, eles não são encaminhados a um serviço de Analytics.</li>
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
        <p>O código da loja integra serviços externos para medição, autenticação, pagamentos, e-mail e infraestrutura. O compartilhamento deve se limitar às finalidades aplicáveis e às informações necessárias para cada serviço. Não afirmamos que esses fornecedores tenham uma única função jurídica em todos os fluxos.</p>
        <ul>
          <li>Pagamento: Asaas e instituições envolvidas no processamento.</li>
          <li>E-mail: Resend, quando configurado para comunicações transacionais ou de lista.</li>
          <li>Google: Google Fonts e Google OAuth quando utilizado. O Google Analytics identificado anteriormente foi desativado neste código local; integrações injetadas fora do frontend versionado não foram verificadas.</li>
          <li>Entrega e consulta de CEP: Melhor Envio, ViaCEP ou BrasilAPI conforme configuração e disponibilidade do serviço.</li>
          <li>Arquivos enviados em recursos da loja: serviço de armazenamento acessado por proxy configurado no servidor.</li>
          <li>Tecnologia: hospedagem, banco de dados e infraestrutura usados pelo projeto; os fornecedores e regiões dependem da configuração efetiva do ambiente.</li>
        </ul>
      </>
    ),
  },
  {
    id: "transferencias",
    title: "7. Transferências internacionais",
    content: (
      <p>
        Serviços externos usados pela loja podem tratar dados em infraestrutura localizada no Brasil ou em outros países, conforme a configuração de cada fornecedor. Quando houver transferência internacional, ela deve observar as hipóteses e garantias previstas na LGPD e na regulamentação da ANPD.
      </p>
    ),
  },
  {
    id: "cookies",
    title: "8. Cookies e tecnologias semelhantes",
    content: (
      <>
        <p>Cookies são gravados no navegador pelo site ou por serviços carregados por ele. Eles são diferentes dos dados guardados em localStorage e sessionStorage. O inventário abaixo descreve mecanismos encontrados no código; a duração de cookies de sessão varia conforme a configuração do servidor e os serviços externos.</p>
        <h3>Cookies</h3>
        <ul className="l4-legal-inventory">
          {cookieRows.map(([name, purpose]) => <li key={name}><code>{name}</code><span>{purpose}</span></li>)}
        </ul>
        <h3>Armazenamento no navegador (não são cookies)</h3>
        <ul className="l4-legal-inventory">
          {browserStorageRows.map(([name, purpose]) => <li key={name}><code>{name}</code><span>{purpose}</span></li>)}
        </ul>
        <h3>Medição do uso do site</h3>
        <p>O Google Analytics identificado anteriormente foi desativado neste código local: o HTML não carrega gtag.js, a interface não inicializa gtag/dataLayer e os eventos internos não são encaminhados a um coletor. Esta descrição se limita ao frontend versionado; não confirma a configuração de ambientes remotos nem a presença de scripts injetados fora dele. A interface de cookies apenas registra o encerramento do aviso e não oferece controle de categorias de medição.</p>
        <p>O bloqueio de cookies no navegador pode afetar sessão, autenticação e proteções de segurança; os demais recursos de armazenamento têm finalidades próprias descritas acima.</p>
        <button type="button" className="l4-legal-action secondary" onClick={openCookiePreferences}>VER INFORMAÇÕES SOBRE COOKIES</button>
      </>
    ),
  },
  {
    id: "retencao",
    title: "9. Armazenamento e retenção",
    content: (
      <>
        <p>Os dados são mantidos pelo período compatível com a finalidade do tratamento e as bases legais aplicáveis, inclusive obrigações legais e exercício regular de direitos. O encerramento de uma finalidade não elimina retenções que ainda sejam exigidas ou permitidas por lei.</p>
        <ul>
          <li>Os prazos podem variar conforme a categoria de dado, a finalidade e a obrigação legal aplicável.</li>
          <li>Solicitações sobre retenção ou eliminação podem ser feitas pelo canal de privacidade, observadas as hipóteses legais de conservação.</li>
        </ul>
      </>
    ),
  },
  {
    id: "seguranca",
    title: "10. Segurança",
    content: (
      <p>
        São aplicadas medidas técnicas e administrativas de segurança compatíveis com o funcionamento do serviço. Nenhum ambiente digital é totalmente isento de riscos; isso não afasta os deveres legais de segurança e resposta a incidentes.
      </p>
    ),
  },
  {
    id: "direitos",
    title: "11. Direitos do titular",
    content: (
      <>
        <p>Nos termos da LGPD, o titular pode solicitar confirmação da existência de tratamento, acesso, correção, anonimização, bloqueio ou eliminação nos casos legais, informação sobre compartilhamento, revogação de consentimento e demais direitos previstos em lei. A portabilidade e outros direitos estão sujeitos às condições e à regulamentação aplicáveis.</p>
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
        Quando houver tratamento de dados pessoais de crianças ou adolescentes, serão observadas as regras legais aplicáveis e a consideração do melhor interesse, conforme o caso.
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
        Esta Política pode ser atualizada para refletir mudanças legais, técnicas ou operacionais. A versão vigente e sua data de revisão são apresentadas nesta página.
      </p>
    ),
  },
  {
    id: "contato",
    title: "16. Contato de privacidade",
    content: (
      <div className="l4-legal-contact">
        <p><strong>E-mail:</strong> {contactChannels.email}</p>
        <p><strong>Atendimento:</strong> {contactChannels.responseTime}</p>
      </div>
    ),
  },
];

export default function Privacidade() {
  return (
    <LegalDocument
      title="POLÍTICA DE PRIVACIDADE E COOKIES"
      description="Como a L4CKOS trata dados pessoais, cookies, segurança e preferências de privacidade no site."
      updatedAt="20/10/2026"
      sections={sections}
    />
  );
}
