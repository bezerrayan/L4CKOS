import { EmailButton } from "../components/EmailButton.jsx";
import { EmailLayout } from "../components/EmailLayout.jsx";
import { EmailStatusBadge } from "../components/EmailStatusBadge.jsx";
import { EmailText } from "../components/EmailText.jsx";

export function LaunchAnnouncement({ name, launchUrl, unsubscribeUrl }) {
  const greeting = name ? `Olá, ${name}.` : "Olá.";

  return (
    <EmailLayout
      preview="A L4CKOS está no ar"
      title="A L4CKOS está no ar."
      subtitle="A loja está aberta"
      unsubscribeUrl={unsubscribeUrl}
      isMarketing
    >
      <EmailStatusBadge tone="info">Lançamento</EmailStatusBadge>
      <EmailText variant="lead">{greeting}</EmailText>
      <EmailText>
        A espera acabou. A loja da L4CKOS está aberta e a coleção de lançamento já pode ser acessada.
      </EmailText>
      <EmailButton href={launchUrl}>Entrar na loja</EmailButton>
    </EmailLayout>
  );
}
