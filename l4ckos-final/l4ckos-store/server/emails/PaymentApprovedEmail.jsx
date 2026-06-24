import { EmailLayout } from "./components/EmailLayout.jsx";
import { EmailOrderSummary } from "./components/EmailOrderSummary.jsx";
import { EmailText } from "./components/EmailText.jsx";

export function PaymentApprovedEmail({ customerName, orderNumber, total }) {
  const greeting = customerName ? `Olá, ${customerName}.` : "Olá.";
  const safeOrder = String(orderNumber || "-");

  return (
    <EmailLayout
      preview={`Pagamento aprovado para o pedido #${safeOrder}`}
      title="Pagamento aprovado."
      subtitle={`Pedido #${safeOrder}`}
      footerNote="Você recebeu este e-mail porque realizou um pagamento na L4CKOS."
    >
      <EmailText variant="lead">{greeting}</EmailText>
      <EmailText>Seu pagamento foi aprovado. Agora o pedido seguirá para preparação.</EmailText>
      <EmailOrderSummary
        orderNumber={safeOrder}
        total={String(total || "-")}
        statusLabel="Pagamento aprovado"
      />
    </EmailLayout>
  );
}
