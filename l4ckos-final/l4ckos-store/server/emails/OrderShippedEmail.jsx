import { EmailButton } from "./components/EmailButton.jsx";
import { EmailLayout } from "./components/EmailLayout.jsx";
import { EmailOrderSummary } from "./components/EmailOrderSummary.jsx";
import { EmailText } from "./components/EmailText.jsx";

export function OrderShippedEmail({ customerName, orderNumber, trackingCode, trackingUrl }) {
  const greeting = customerName ? `Olá, ${customerName}.` : "Olá.";
  const safeOrder = String(orderNumber || "-");

  return (
    <EmailLayout
      preview={`Pedido #${safeOrder} enviado`}
      title="Pedido enviado."
      subtitle={`Pedido #${safeOrder}`}
      footerNote="Você recebeu este e-mail porque possui um pedido na L4CKOS."
    >
      <EmailText variant="lead">{greeting}</EmailText>
      <EmailText>Seu pedido foi despachado e está a caminho do endereço informado.</EmailText>
      <EmailOrderSummary orderNumber={safeOrder} statusLabel={`Rastreio: ${trackingCode || "-"}`} />
      <EmailButton href={trackingUrl}>Rastrear pedido</EmailButton>
    </EmailLayout>
  );
}
