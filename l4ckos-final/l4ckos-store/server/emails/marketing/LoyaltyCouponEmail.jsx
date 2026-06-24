import { EmailButton } from "../components/EmailButton.jsx";
import { EmailCouponPanel } from "../components/EmailCouponPanel.jsx";
import { EmailLayout } from "../components/EmailLayout.jsx";
import { EmailStatusBadge } from "../components/EmailStatusBadge.jsx";
import { EmailText } from "../components/EmailText.jsx";

export function LoyaltyCouponEmail({ name, couponCode, couponDescription, shopUrl, unsubscribeUrl }) {
  const greeting = name ? `Olá, ${name}.` : "Olá.";

  return (
    <EmailLayout
      preview="Seu benefício de fidelidade está disponível"
      title="Um benefício para você."
      subtitle="Fidelidade L4CKOS"
      unsubscribeUrl={unsubscribeUrl}
      isMarketing
    >
      <EmailStatusBadge tone="info">Benefício liberado</EmailStatusBadge>
      <EmailText variant="lead">{greeting}</EmailText>
      <EmailText>
        Obrigado por continuar construindo essa jornada com a L4CKOS. Liberamos uma condição para sua próxima compra.
      </EmailText>
      <EmailCouponPanel code={couponCode} description={couponDescription} />
      <EmailButton href={shopUrl}>Usar benefício</EmailButton>
    </EmailLayout>
  );
}
