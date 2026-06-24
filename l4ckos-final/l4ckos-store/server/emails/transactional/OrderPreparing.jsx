import { EmailLayout } from "../components/EmailLayout.jsx";
import { EmailOrderSummary } from "../components/EmailOrderSummary.jsx";
import { EmailStatusBadge } from "../components/EmailStatusBadge.jsx";
import { EmailText } from "../components/EmailText.jsx";

export function OrderPreparing({ customerName, orderNumber, total }) {
  const greeting = customerName ? `Olá, ${customerName}.` : "Olá.";

  return (
    <EmailLayout
      preview={`Pedido #${orderNumber || "-"} em preparação`}
      title="Pedido em preparação."
      subtitle={`Pedido #${orderNumber || "-"}`}
      footerNote="Você recebeu este e-mail porque possui um pedido na L4CKOS."
    >
      <EmailStatusBadge tone="info">Em separação</EmailStatusBadge>
      <EmailText variant="lead">{greeting}</EmailText>
      <EmailText>
        Seu pedido já está sendo separado pela equipe. Quando o envio for concluído, você receberá o código de
        rastreamento automaticamente.
      </EmailText>
      <EmailOrderSummary orderNumber={orderNumber} total={total} statusLabel="Em preparação" />
    </EmailLayout>
  );
}
