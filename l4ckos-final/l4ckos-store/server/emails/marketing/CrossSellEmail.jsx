import { EmailButton } from "../components/EmailButton.jsx";
import { EmailLayout } from "../components/EmailLayout.jsx";
import { EmailProductGrid } from "../components/EmailProductGrid.jsx";
import { EmailStatusBadge } from "../components/EmailStatusBadge.jsx";
import { EmailText } from "../components/EmailText.jsx";

export function CrossSellEmail({ name, collectionUrl, products = [], unsubscribeUrl }) {
  const greeting = name ? `Olá, ${name}.` : "Olá.";

  return (
    <EmailLayout
      preview="Uma seleção que combina com sua última compra"
      title="Complete sua seleção."
      subtitle="Curadoria complementar"
      unsubscribeUrl={unsubscribeUrl}
      isMarketing
    >
      <EmailStatusBadge tone="neutral">Selecionado para você</EmailStatusBadge>
      <EmailText variant="lead">{greeting}</EmailText>
      <EmailText>
        Reunimos algumas peças e acessórios que combinam com sua última compra e mantêm a mesma proposta da L4CKOS.
      </EmailText>
      <EmailProductGrid title="Sugestões selecionadas" products={products} />
      <EmailButton href={collectionUrl}>Ver seleção</EmailButton>
    </EmailLayout>
  );
}
