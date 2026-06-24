import { EmailButton } from "../components/EmailButton.jsx";
import { EmailLayout } from "../components/EmailLayout.jsx";
import { EmailProductGrid } from "../components/EmailProductGrid.jsx";
import { EmailStatusBadge } from "../components/EmailStatusBadge.jsx";
import { EmailText } from "../components/EmailText.jsx";

export function NewDropAnnouncement({ name, dropUrl, products = [], unsubscribeUrl }) {
  const greeting = name ? `Olá, ${name}.` : "Olá.";

  return (
    <EmailLayout
      preview="Um novo drop da L4CKOS está disponível"
      title="Novo drop disponível."
      subtitle="Nova seleção L4CKOS"
      unsubscribeUrl={unsubscribeUrl}
      isMarketing
    >
      <EmailStatusBadge tone="info">Novo drop</EmailStatusBadge>
      <EmailText variant="lead">{greeting}</EmailText>
      <EmailText>
        Uma nova seleção acaba de entrar no catálogo. Explore as peças e os detalhes desta edição enquanto houver
        disponibilidade.
      </EmailText>
      <EmailProductGrid title="Destaques do drop" products={products} />
      <EmailButton href={dropUrl}>Ver novo drop</EmailButton>
    </EmailLayout>
  );
}
