import { EmailLayout } from "../components/EmailLayout.jsx";
import { EmailOrderSummary } from "../components/EmailOrderSummary.jsx";
import { EmailStatusBadge } from "../components/EmailStatusBadge.jsx";
import { EmailText } from "../components/EmailText.jsx";

/** Render only from the persisted cancellation state; no payment or delivery claims are inferred. */
export function OrderCancelled({
  customerName,
  orderNumber,
  total,
  items = [],
  refundStatus,
}) {
  const greeting = customerName ? `Olá, ${customerName}.` : "Olá.";
  const statusText =
    refundStatus === "refunded"
      ? "Se houve pagamento, o estorno foi confirmado."
      : refundStatus === "pending"
        ? "Se houve pagamento, o estorno ainda está em processamento."
        : "Se houve pagamento, consulte o atendimento para acompanhar o estorno.";

  return (
    <EmailLayout
      preview={`Pedido #${orderNumber || "-"} cancelado`}
      title="Pedido cancelado."
      subtitle={`Pedido #${orderNumber || "-"}`}
      footerNote="Você recebeu este e-mail porque houve uma atualização no seu pedido da L4CKOS."
    >
      <EmailStatusBadge tone="warning">Pedido cancelado</EmailStatusBadge>
      <EmailText variant="lead">{greeting}</EmailText>
      <EmailText>
        O pedido foi cancelado e os itens não serão preparados para envio.
      </EmailText>
      <EmailOrderSummary
        orderNumber={orderNumber}
        total={total}
        statusLabel="Cancelado"
        items={items}
      />
      <EmailText>{statusText}</EmailText>
      <EmailText>
        Se precisar de ajuda, responda a esta mensagem para falar com o
        atendimento L4CKOS.
      </EmailText>
    </EmailLayout>
  );
}
