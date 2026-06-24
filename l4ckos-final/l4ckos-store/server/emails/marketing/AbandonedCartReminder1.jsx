import { EmailButton } from "../components/EmailButton.jsx";
import { EmailLayout } from "../components/EmailLayout.jsx";
import { EmailProductGrid } from "../components/EmailProductGrid.jsx";
import { EmailStatusBadge } from "../components/EmailStatusBadge.jsx";
import { EmailText } from "../components/EmailText.jsx";

export function AbandonedCartReminder1({ name, cartUrl, products = [], unsubscribeUrl }) {
  const greeting = name ? `Olá, ${name}.` : "Olá.";

  return (
    <EmailLayout
      preview="Sua seleção continua no carrinho"
      title="Sua seleção continua aqui."
      subtitle="Carrinho L4CKOS"
      unsubscribeUrl={unsubscribeUrl}
      isMarketing
    >
      <EmailStatusBadge tone="neutral">Carrinho salvo</EmailStatusBadge>
      <EmailText variant="lead">{greeting}</EmailText>
      <EmailText>
        Você deixou alguns itens no carrinho. Caso ainda queira concluir a compra, sua seleção continua disponível por
        enquanto.
      </EmailText>
      <EmailProductGrid title="Itens no carrinho" products={products} />
      <EmailButton href={cartUrl}>Voltar ao carrinho</EmailButton>
    </EmailLayout>
  );
}
