import { EmailButton } from "../components/EmailButton.jsx";
import { EmailLayout } from "../components/EmailLayout.jsx";
import { EmailOrderSummary } from "../components/EmailOrderSummary.jsx";
import { EmailStatusBadge } from "../components/EmailStatusBadge.jsx";
import { EmailText } from "../components/EmailText.jsx";

export function PaymentFailed({ customerName, orderNumber, total, paymentUrl, failureReason }) {
  const greeting = customerName ? `Olá, ${customerName}.` : "Olá.";

  return (
    <EmailLayout
      preview={`Pagamento não aprovado para o pedido #${orderNumber || "-"}`}
      title="Pagamento não aprovado."
      subtitle={`Pedido #${orderNumber || "-"}`}
      footerNote="Você recebeu este e-mail porque houve uma tentativa de pagamento em um pedido da L4CKOS."
    >
      <EmailStatusBadge tone="danger">Falha no pagamento</EmailStatusBadge>
      <EmailText variant="lead">{greeting}</EmailText>
      <EmailText>
        Não conseguimos confirmar o pagamento. Revise os dados e tente novamente para manter os itens do pedido.
      </EmailText>
      <EmailOrderSummary
        orderNumber={orderNumber}
        total={total}
        statusLabel={failureReason || "Pagamento recusado"}
      />
      <EmailButton href={paymentUrl}>Tentar novamente</EmailButton>
    </EmailLayout>
  );
}
