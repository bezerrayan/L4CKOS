import { EmailButton } from "../components/EmailButton.jsx";
import { EmailLayout } from "../components/EmailLayout.jsx";
import { EmailProductGrid } from "../components/EmailProductGrid.jsx";
import { EmailStatusBadge } from "../components/EmailStatusBadge.jsx";
import { EmailText } from "../components/EmailText.jsx";

export function AbandonedCartReminder3({ name, cartUrl, products = [], unsubscribeUrl }) {
  const greeting = name ? `Olá, ${name}.` : "Olá.";

  return (
    <EmailLayout
      preview="Último lembrete sobre sua seleção"
      title="Último lembrete."
      subtitle="Seu carrinho L4CKOS"
      unsubscribeUrl={unsubscribeUrl}
      isMarketing
    >
      <EmailStatusBadge tone="danger">Último aviso</EmailStatusBadge>
      <EmailText variant="lead">{greeting}</EmailText>
      <EmailText>
        Este é o último lembrete desta sequência. Caso queira manter essa seleção, conclua a compra antes de uma
        possível alteração no estoque.
      </EmailText>
      <EmailProductGrid title="Itens selecionados" products={products} />
      <EmailButton href={cartUrl}>Finalizar pedido</EmailButton>
    </EmailLayout>
  );
}
