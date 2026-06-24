import { EmailButton } from "./components/EmailButton.jsx";
import { EmailLayout } from "./components/EmailLayout.jsx";
import { EmailOrderSummary } from "./components/EmailOrderSummary.jsx";
import { EmailText } from "./components/EmailText.jsx";

export function OrderReceivedEmail({ customerName, orderNumber, items = [], total }) {
  const greeting = customerName ? `Olá, ${customerName}.` : "Olá.";
  const safeOrder = String(orderNumber || "-");
  const appBase = String(process.env.APP_BASE_URL || "https://l4ckos.com.br").replace(/\/$/, "");

  return (
    <EmailLayout
      preview={`Recebemos o pedido #${safeOrder}`}
      title="Pedido recebido."
      subtitle={`Pedido #${safeOrder}`}
      footerNote="Você recebeu este e-mail porque realizou um pedido na L4CKOS."
    >
      <EmailText variant="lead">{greeting}</EmailText>
      <EmailText>Recebemos seu pedido e reservamos os itens selecionados.</EmailText>
      <EmailOrderSummary
        orderNumber={safeOrder}
        total={String(total || "-")}
        statusLabel="Pedido recebido"
        items={items}
      />
      <EmailButton href={`${appBase}/conta/pedidos`}>Acompanhar pedido</EmailButton>
    </EmailLayout>
  );
}
