import { paymentApprovedMessage } from "../../../shared/preorder";
import { EmailLayout } from "../components/EmailLayout.jsx";
import { EmailOrderSummary } from "../components/EmailOrderSummary.jsx";
import { EmailStatusBadge } from "../components/EmailStatusBadge.jsx";
import { EmailText } from "../components/EmailText.jsx";

export function PaymentApproved({ customerName, orderNumber, total, salesMode = "STOCK" }) {
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
        {paymentApprovedMessage(salesMode)}
      </EmailText>
      <EmailOrderSummary orderNumber={orderNumber} total={total} statusLabel="Pagamento aprovado" />
    </EmailLayout>
  );
}
