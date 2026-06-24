import { EmailLayout } from "../components/EmailLayout.jsx";
import { EmailOrderSummary } from "../components/EmailOrderSummary.jsx";
import { EmailStatusBadge } from "../components/EmailStatusBadge.jsx";
import { EmailText } from "../components/EmailText.jsx";

export function PaymentApproved({ customerName, orderNumber, total }) {
  const greeting = customerName ? `Olá, ${customerName}.` : "Olá.";

  return (
    <EmailLayout
      preview={`Pagamento aprovado para o pedido #${orderNumber || "-"}`}
      title="Pagamento aprovado."
      subtitle={`Pedido #${orderNumber || "-"}`}
      footerNote="Você recebeu este e-mail porque realizou um pagamento na L4CKOS."
    >
      <EmailStatusBadge tone="success">Pagamento confirmado</EmailStatusBadge>
      <EmailText variant="lead">{greeting}</EmailText>
      <EmailText>
        Seu pagamento foi confirmado. A equipe da L4CKOS já pode liberar o pedido para separação e preparação.
      </EmailText>
      <EmailOrderSummary orderNumber={orderNumber} total={total} statusLabel="Pagamento aprovado" />
    </EmailLayout>
  );
}
