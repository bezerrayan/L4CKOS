import { EmailButton } from "../components/EmailButton.jsx";
import { EmailInfoRow } from "../components/EmailInfoRow.jsx";
import { EmailLayout } from "../components/EmailLayout.jsx";
import { EmailStatusBadge } from "../components/EmailStatusBadge.jsx";
import { EmailText } from "../components/EmailText.jsx";

/**
 * Exclusive drop notifications. NONE of these receives or prints an access code: the code is delivered manually by the team
 * (it is stored only as a hash), so the e-mail only tells the customer that a decision exists and what it grants.
 * Dates arrive already formatted in the DROP's timezone by the notifier.
 */
const appBase = () => String(process.env.APP_BASE_URL || "https://l4ckos.com.br").replace(/\/$/, "");
const greeting = name => (name ? `Olá, ${name}.` : "Olá.");

export function ExclusiveDropRequestReceived({ customerName, dropName, productUrl }) {
  return (
    <EmailLayout
      preview={`Recebemos seu pedido de acesso ao drop ${dropName || "exclusivo"}`}
      title="Pedido de acesso recebido."
      subtitle={dropName || "Drop exclusivo"}
      footerNote="Você recebeu este e-mail porque solicitou acesso a um drop exclusivo da L4CKOS."
    >
      <EmailStatusBadge tone="info">Aguardando aprovação</EmailStatusBadge>
      <EmailText variant="lead">{greeting(customerName)}</EmailText>
      <EmailText>Recebemos a sua solicitação. Avisaremos por e-mail assim que houver uma decisão.</EmailText>
      {productUrl ? <EmailButton href={productUrl}>Acompanhar o status</EmailButton> : null}
    </EmailLayout>
  );
}

export function ExclusiveDropAccessApproved({ customerName, dropName, unitLimit, expiresAtLabel, purchaseStartsAtLabel, productUrl }) {
  return (
    <EmailLayout
      preview={`Seu acesso ao drop ${dropName || "exclusivo"} foi aprovado`}
      title="Seu acesso foi aprovado."
      subtitle={dropName || "Drop exclusivo"}
      footerNote="Você recebeu este e-mail porque solicitou acesso a um drop exclusivo da L4CKOS."
    >
      <EmailStatusBadge tone="success">Acesso aprovado</EmailStatusBadge>
      <EmailText variant="lead">{greeting(customerName)}</EmailText>
      <EmailText>
        Sua solicitação foi aprovada. Você poderá comprar até {unitLimit} {Number(unitLimit) === 1 ? "unidade" : "unidades"}, em qualquer combinação de tamanhos.
      </EmailText>
      <EmailInfoRow label="Unidades autorizadas" value={String(unitLimit)} />
      {purchaseStartsAtLabel ? <EmailInfoRow label="Compras a partir de" value={purchaseStartsAtLabel} /> : null}
      {expiresAtLabel ? <EmailInfoRow label="Acesso válido até" value={expiresAtLabel} /> : null}
      <EmailText>
        Seu código individual será enviado separadamente pela equipe L4CKOS. Ele funciona somente nesta conta e não deve ser compartilhado.
      </EmailText>
      {productUrl ? <EmailButton href={productUrl}>Ir para o produto</EmailButton> : null}
    </EmailLayout>
  );
}

export function ExclusiveDropAccessRejected({ customerName, dropName }) {
  return (
    <EmailLayout
      preview={`Atualização sobre o seu pedido de acesso ao drop ${dropName || "exclusivo"}`}
      title="Sobre o seu pedido de acesso."
      subtitle={dropName || "Drop exclusivo"}
      footerNote="Você recebeu este e-mail porque solicitou acesso a um drop exclusivo da L4CKOS."
    >
      <EmailStatusBadge tone="neutral">Solicitação não aprovada</EmailStatusBadge>
      <EmailText variant="lead">{greeting(customerName)}</EmailText>
      <EmailText>Desta vez não conseguimos aprovar o seu acesso a este drop. Obrigado pelo interesse na L4CKOS.</EmailText>
      <EmailButton href={`${appBase()}/produtos`}>Ver o catálogo</EmailButton>
    </EmailLayout>
  );
}

export function ExclusiveDropAccessRevoked({ customerName, dropName }) {
  return (
    <EmailLayout
      preview={`Seu acesso ao drop ${dropName || "exclusivo"} foi encerrado`}
      title="Seu acesso foi encerrado."
      subtitle={dropName || "Drop exclusivo"}
      footerNote="Você recebeu este e-mail porque tinha acesso a um drop exclusivo da L4CKOS."
    >
      <EmailStatusBadge tone="warning">Acesso revogado</EmailStatusBadge>
      <EmailText variant="lead">{greeting(customerName)}</EmailText>
      <EmailText>
        Seu acesso a este drop não está mais ativo e novas compras não são possíveis. Pedidos já abertos seguem o fluxo normal de pagamento.
      </EmailText>
      <EmailText>Em caso de dúvida, responda a este e-mail.</EmailText>
    </EmailLayout>
  );
}
