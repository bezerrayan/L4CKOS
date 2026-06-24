import { EmailButton } from "../components/EmailButton.jsx";
import { EmailLayout } from "../components/EmailLayout.jsx";
import { EmailOrderSummary } from "../components/EmailOrderSummary.jsx";
import { EmailStatusBadge } from "../components/EmailStatusBadge.jsx";
import { EmailText } from "../components/EmailText.jsx";

export function OrderCreated({ customerName, orderNumber, total, items = [], orderUrl }) {
  const greeting = customerName ? `Olá, ${customerName}.` : "Olá.";

  return (
    <EmailLayout
      preview={`Recebemos o pedido #${orderNumber || "-"}`}
      title="Pedido recebido."
      subtitle={`Pedido #${orderNumber || "-"}`}
      footerNote="Você recebeu este e-mail porque realizou um pedido na L4CKOS."
    >
      <EmailStatusBadge tone="info">Novo pedido</EmailStatusBadge>
      <EmailText variant="lead">{greeting}</EmailText>
      <EmailText>
        Recebemos seu pedido e reservamos os itens selecionados. Agora aguardamos a confirmação do pagamento para
        iniciar a preparação.
      </EmailText>

      <EmailOrderSummary orderNumber={orderNumber} total={total} statusLabel="Pedido criado" items={items} />
      <EmailButton href={orderUrl}>Acompanhar pedido</EmailButton>
    </EmailLayout>
  );
}
