import LegalDocument, { type LegalSection } from "../components/LegalDocument";
import { contactChannels } from "../config/site";

const sections: LegalSection[] = [
  {
    id: "objeto",
    title: "1. Objeto",
    content: (
      <p>
        Estes Termos descrevem o uso do site e informações gerais sobre compras. As características, disponibilidade, preço, custos e condições específicos de cada oferta devem ser consultados na página do produto e no resumo apresentado antes da conclusão do pedido.
      </p>
    ),
  },
  {
    id: "fornecedor",
    title: "2. Identificação e contato",
    content: (
      <div className="l4-legal-contact">
        <p>Esta loja é apresentada sob a marca L4CKOS.</p>
        <p><strong>Contato:</strong> {contactChannels.email}.</p>
      </div>
    ),
  },
  {
    id: "cadastro",
    title: "3. Cadastro e segurança da conta",
    content: (
      <>
        <p>O usuário deve fornecer informações corretas, atualizadas e completas nos formulários do site.</p>
        <ul>
          <li>Não compartilhe senha ou credenciais de acesso.</li>
          <li>Mantenha e-mail e dados de contato atualizados.</li>
          <li>Comunique qualquer suspeita de uso indevido da conta.</li>
        </ul>
      </>
    ),
  },
  {
    id: "produtos",
    title: "4. Produtos, preços e disponibilidade",
    content: (
      <>
        <p>As páginas dos produtos informam suas características, preço, variações e disponibilidade. A oferta aplicável ao pedido é aquela apresentada ao consumidor no momento da compra, incluindo condições específicas de pré-venda quando houver.</p>
        <ul>
          <li>Os preços são apresentados em reais.</li>
          <li>O valor final da compra é exibido antes da finalização.</li>
          <li>Imagens e cores podem variar conforme tela, iluminação ou lote, sem alterar características essenciais.</li>
        </ul>
      </>
    ),
  },
  {
    id: "pedido-pagamento",
    title: "5. Pedido, pagamento e confirmação",
    content: (
      <p>
        O pedido é confirmado conforme aprovação do pagamento e validação das informações necessárias. Os meios de pagamento disponíveis são aqueles exibidos no checkout no momento da compra.
      </p>
    ),
  },
  {
    id: "entrega",
    title: "6. Entrega",
    content: (
      <p>
        Modalidades, custos e estimativas de entrega devem ser informados antes da conclusão da compra. Após o pedido, informações de acompanhamento são disponibilizadas pelos recursos existentes na loja e pelos canais oficiais de atendimento.
      </p>
    ),
  },
  {
    id: "trocas",
    title: "7. Arrependimento, trocas, devoluções e garantia legal",
    content: (
      <>
        <p>Nas compras realizadas fora do estabelecimento comercial, o consumidor pode exercer o direito de arrependimento no prazo legal de 7 dias, contado da assinatura ou do recebimento do produto, conforme o caso. Os valores pagos durante o prazo de reflexão são restituídos conforme a legislação aplicável.</p>
        <p>Vícios, defeitos, avarias e divergência em relação ao produto comprado são tratados conforme as garantias e alternativas previstas no Código de Defesa do Consumidor. Para troca comercial por tamanho, cor ou preferência, consulte a equipe antes de enviar o produto; essa possibilidade não substitui nem limita direitos legais.</p>
      </>
    ),
  },
  {
    id: "atendimento",
    title: "8. Atendimento",
    content: (
      <p>
        O atendimento oficial é feito pela página de contato e pelo e-mail {contactChannels.email}. {contactChannels.responseTime}
      </p>
    ),
  },
  {
    id: "propriedade-intelectual",
    title: "9. Propriedade intelectual",
    content: (
      <p>
        Logotipos, identidade visual, textos, imagens, interfaces e demais conteúdos do site pertencem à L4CKOS ou a terceiros licenciantes. O uso comercial sem autorização não é permitido.
      </p>
    ),
  },
  {
    id: "privacidade",
    title: "10. Privacidade e proteção de dados",
    content: (
      <p>
        O tratamento de dados pessoais é descrito na Política de Privacidade e Cookies. O uso da loja deve observar a legislação aplicável de proteção de dados.
      </p>
    ),
  },
  {
    id: "alteracoes",
    title: "11. Alterações dos termos",
    content: (
      <p>
        Estes Termos podem ser atualizados para refletir mudanças legais ou no funcionamento da loja. A versão vigente e sua data de revisão são apresentadas nesta página; a atualização não elimina direitos já assegurados ao consumidor.
      </p>
    ),
  },
  {
    id: "legislacao",
    title: "12. Legislação aplicável",
    content: (
      <p>
        Estes Termos são interpretados conforme a legislação brasileira, incluindo o Código de Defesa do Consumidor, o Código Civil e demais normas aplicáveis, sem restringir direitos assegurados ao consumidor.
      </p>
    ),
  },
  {
    id: "contato",
    title: "13. Contato",
    content: (
      <div className="l4-legal-contact">
        <p><strong>E-mail:</strong> {contactChannels.email}</p>
        <p><strong>Atendimento:</strong> {contactChannels.responseTime}</p>
      </div>
    ),
  },
];

export default function Termos() {
  return (
    <LegalDocument
      title="TERMOS DE USO E CONDIÇÕES DE COMPRA"
      description="Regras de uso do site e condições aplicáveis às compras realizadas pela L4CKOS."
      updatedAt="20/10/2026"
      sections={sections}
    />
  );
}
