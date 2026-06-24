import { EmailButton } from "../components/EmailButton.jsx";
import { EmailLayout } from "../components/EmailLayout.jsx";
import { EmailProductGrid } from "../components/EmailProductGrid.jsx";
import { EmailStatusBadge } from "../components/EmailStatusBadge.jsx";
import { EmailText } from "../components/EmailText.jsx";

export function NewProductsAnnouncement({ name, products = [], productsUrl, unsubscribeUrl }) {
  const greeting = name ? `Olá, ${name}.` : "Olá.";

  return (
    <EmailLayout
      preview="Novos produtos chegaram à L4CKOS"
      title="Novidades no catálogo."
      subtitle="Produtos recém-publicados"
      unsubscribeUrl={unsubscribeUrl}
      isMarketing
    >
      <EmailStatusBadge tone="info">Novidades</EmailStatusBadge>
      <EmailText variant="lead">{greeting}</EmailText>
      <EmailText>
        Novas peças e acessórios entraram no catálogo da L4CKOS. Confira a seleção enquanto os tamanhos e modelos
        estão disponíveis.
      </EmailText>
      <EmailProductGrid title="Novidades em destaque" products={products} />
      <EmailButton href={productsUrl}>Ver novidades</EmailButton>
    </EmailLayout>
  );
}
