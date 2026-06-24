import { EmailButton } from "../components/EmailButton.jsx";
import { EmailLayout } from "../components/EmailLayout.jsx";
import { EmailOrderSummary } from "../components/EmailOrderSummary.jsx";
import { EmailStatusBadge } from "../components/EmailStatusBadge.jsx";
import { EmailText } from "../components/EmailText.jsx";

export function PaymentPending({ customerName, orderNumber, total, paymentUrl, dueLabel }) {
  const greeting = customerName ? `Olá, ${customerName}.` : "Olá.";

  return (
    <EmailLayout
      preview={`Pagamento pendente do pedido #${orderNumber || "-"}`}
      title="Pagamento pendente."
      subtitle={`Pedido #${orderNumber || "-"}`}
      footerNote="Você recebeu este e-mail porque há um pagamento pendente em um pedido da L4CKOS."
    >
      <EmailStatusBadge tone="warning">Aguardando pagamento</EmailStatusBadge>
      <EmailText variant="lead">{greeting}</EmailText>
      <EmailText>
        A cobrança foi gerada e o pedido continua reservado temporariamente. Conclua o pagamento para iniciar a
        preparação.
      </EmailText>
      <EmailOrderSummary
        orderNumber={orderNumber}
        total={total}
        statusLabel="Pagamento pendente"
        shippingLabel={dueLabel}
      />
      <EmailButton href={paymentUrl}>Concluir pagamento</EmailButton>
    </EmailLayout>
  );
}
