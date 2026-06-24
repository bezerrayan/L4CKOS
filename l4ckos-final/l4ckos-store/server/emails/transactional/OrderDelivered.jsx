import { EmailButton } from "../components/EmailButton.jsx";
import { EmailLayout } from "../components/EmailLayout.jsx";
import { EmailStatusBadge } from "../components/EmailStatusBadge.jsx";
import { EmailText } from "../components/EmailText.jsx";

export function OrderDelivered({ customerName, orderNumber, orderUrl }) {
  const greeting = customerName ? `Olá, ${customerName}.` : "Olá.";

  return (
    <EmailLayout
      preview={`Pedido #${orderNumber || "-"} entregue`}
      title="Pedido entregue."
      subtitle={`Pedido #${orderNumber || "-"}`}
      footerNote="Você recebeu este e-mail porque possui um pedido na L4CKOS."
    >
      <EmailStatusBadge tone="success">Entrega concluída</EmailStatusBadge>
      <EmailText variant="lead">{greeting}</EmailText>
      <EmailText>
        Seu pedido foi marcado como entregue. Esperamos que tudo tenha chegado como previsto e que a experiência
        esteja à altura da L4CKOS.
      </EmailText>
      <EmailButton href={orderUrl}>Ver pedido</EmailButton>
    </EmailLayout>
  );
}
