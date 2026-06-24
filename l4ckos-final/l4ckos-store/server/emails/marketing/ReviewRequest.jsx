import { EmailButton } from "../components/EmailButton.jsx";
import { EmailLayout } from "../components/EmailLayout.jsx";
import { EmailStatusBadge } from "../components/EmailStatusBadge.jsx";
import { EmailText } from "../components/EmailText.jsx";

export function ReviewRequest({ name, orderNumber, reviewUrl, unsubscribeUrl }) {
  const greeting = name ? `Olá, ${name}.` : "Olá.";

  return (
    <EmailLayout
      preview={`Como foi sua experiência com o pedido #${orderNumber || "-"}?`}
      title="Conte como foi."
      subtitle={`Pedido #${orderNumber || "-"}`}
      unsubscribeUrl={unsubscribeUrl}
      isMarketing
    >
      <EmailStatusBadge tone="neutral">Sua experiência</EmailStatusBadge>
      <EmailText variant="lead">{greeting}</EmailText>
      <EmailText>
        Sua avaliação ajuda a L4CKOS a melhorar produtos, atendimento e operação. Leva poucos minutos e faz diferença.
      </EmailText>
      <EmailButton href={reviewUrl}>Avaliar pedido</EmailButton>
    </EmailLayout>
  );
}
