import { EmailButton } from "../components/EmailButton.jsx";
import { EmailCouponPanel } from "../components/EmailCouponPanel.jsx";
import { EmailLayout } from "../components/EmailLayout.jsx";
import { EmailStatusBadge } from "../components/EmailStatusBadge.jsx";
import { EmailText } from "../components/EmailText.jsx";

export function PromotionEmail({ name, promotionUrl, couponCode, couponDescription, unsubscribeUrl }) {
  const greeting = name ? `Olá, ${name}.` : "Olá.";

  return (
    <EmailLayout
      preview="Uma condição especial está ativa na L4CKOS"
      title="Condição especial ativa."
      subtitle="Por tempo limitado"
      unsubscribeUrl={unsubscribeUrl}
      isMarketing
    >
      <EmailStatusBadge tone="info">Condição especial</EmailStatusBadge>
      <EmailText variant="lead">{greeting}</EmailText>
      <EmailText>
        Uma condição especial está disponível por tempo limitado em uma seleção de produtos da L4CKOS.
      </EmailText>
      <EmailCouponPanel code={couponCode} description={couponDescription} />
      <EmailButton href={promotionUrl}>Ver condição</EmailButton>
    </EmailLayout>
  );
}
