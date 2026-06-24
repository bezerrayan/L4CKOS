import { EmailButton } from "../components/EmailButton.jsx";
import { EmailLayout } from "../components/EmailLayout.jsx";
import { EmailOrderSummary } from "../components/EmailOrderSummary.jsx";
import { EmailStatusBadge } from "../components/EmailStatusBadge.jsx";
import { EmailText } from "../components/EmailText.jsx";

export function OrderShipped({ customerName, orderNumber, trackingCode, trackingUrl }) {
  const greeting = customerName ? `Olá, ${customerName}.` : "Olá.";

  return (
    <EmailLayout
      preview={`Pedido #${orderNumber || "-"} enviado`}
      title="Pedido enviado."
      subtitle={`Pedido #${orderNumber || "-"}`}
      footerNote="Você recebeu este e-mail porque possui um pedido na L4CKOS."
    >
      <EmailStatusBadge tone="info">Em trânsito</EmailStatusBadge>
      <EmailText variant="lead">{greeting}</EmailText>
      <EmailText>Seu pedido saiu da operação e agora está a caminho do endereço informado.</EmailText>
      <EmailOrderSummary orderNumber={orderNumber} statusLabel={`Rastreio: ${trackingCode || "-"}`} />
      <EmailButton href={trackingUrl}>Rastrear pedido</EmailButton>
    </EmailLayout>
  );
}
