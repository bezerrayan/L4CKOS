import LegalDocument, { type LegalSection } from "../components/LegalDocument";

const contact = {
  email: "contato@l4ckos.com.br",
  responseTime: "Buscamos responder em até 1 dia útil.",
};

const sections: LegalSection[] = [
  {
    id: "objeto",
    title: "1. Objeto",
    content: (
      <p>
        Estes Termos apresentam as regras de uso do site e as condições aplicáveis às compras realizadas pela L4CKOS. A concordância com condições de compra deve ocorrer de forma clara nos fluxos de cadastro, pedido ou checkout, quando aplicável.
      </p>
    ),
  },
  {
    id: "fornecedor",
    title: "2. Identificação do fornecedor",
    content: (
      <div className="l4-legal-box">
        <p><strong>Marca:</strong> L4CKOS.</p>
        <p><strong>Responsável atual:</strong> Yan Bezerra.</p>
        <p><strong>E-mail oficial:</strong> {contact.email}.</p>
        <p>Dados empresariais como CNPJ, razão social e endereço de atendimento ainda precisam ser definidos antes do lançamento comercial definitivo.</p>
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
        <p>Os produtos, preços, variações, estoque e condições aplicáveis são exibidos nas páginas da loja e podem mudar conforme atualização do catálogo.</p>
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
        Prazos, modalidades e custos de entrega devem ser apresentados antes da conclusão da compra. O acompanhamento pode ser feito pela área de pedidos e pelos canais oficiais de atendimento disponíveis.
      </p>
    ),
  },
  {
    id: "trocas",
    title: "7. Arrependimento, trocas, devoluções e garantia legal",
    content: (
      <>
        <p>Nas compras realizadas pela internet, o consumidor pode solicitar cancelamento em até 7 dias corridos contados do recebimento do produto, nos termos da legislação aplicável.</p>
        <p>Defeitos, avarias ou envio de produto incorreto devem ser comunicados para análise e orientação do procedimento adequado.</p>
        <p>A política de troca voluntária por tamanho ou preferência ainda depende de definição operacional da L4CKOS.</p>
      </>
    ),
  },
  {
    id: "atendimento",
    title: "8. Atendimento",
    content: (
      <p>
        O atendimento oficial é feito pela página de contato e pelo e-mail {contact.email}. {contact.responseTime}
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
        Estes Termos podem ser atualizados para refletir mudanças legais, operacionais ou de funcionamento da loja. A data desta página deve ser alterada apenas quando o conteúdo for revisado.
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
      <div className="l4-legal-box">
        <p><strong>E-mail:</strong> {contact.email}</p>
        <p><strong>Atendimento:</strong> {contact.responseTime}</p>
      </div>
    ),
  },
];

export default function Termos() {
  return (
    <LegalDocument
      title="TERMOS DE USO E CONDIÇÕES DE COMPRA"
      description="Regras de uso do site e condições aplicáveis às compras realizadas pela L4CKOS."
      updatedAt="24/06/2026"
      sections={sections}
    />
  );
}
