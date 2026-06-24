import { EmailButton } from "../components/EmailButton.jsx";
import { EmailLayout } from "../components/EmailLayout.jsx";
import { EmailProductGrid } from "../components/EmailProductGrid.jsx";
import { EmailStatusBadge } from "../components/EmailStatusBadge.jsx";
import { EmailText } from "../components/EmailText.jsx";

export function AbandonedCartReminder2({ name, cartUrl, products = [], unsubscribeUrl }) {
  const greeting = name ? `Olá, ${name}.` : "Olá.";

  return (
    <EmailLayout
      preview="Os itens do seu carrinho ainda estão disponíveis"
      title="Os itens ainda estão aqui."
      subtitle="Disponibilidade sujeita ao estoque"
      unsubscribeUrl={unsubscribeUrl}
      isMarketing
    >
      <EmailStatusBadge tone="warning">Lembrete de carrinho</EmailStatusBadge>
      <EmailText variant="lead">{greeting}</EmailText>
      <EmailText>
        Sua seleção continua registrada. Caso a compra ainda esteja nos seus planos, este é um bom momento para
        concluir antes de uma mudança de disponibilidade.
      </EmailText>
      <EmailProductGrid title="Sua seleção" products={products} />
      <EmailButton href={cartUrl}>Retomar compra</EmailButton>
    </EmailLayout>
  );
}
