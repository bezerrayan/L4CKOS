import { EmailButton } from "../components/EmailButton.jsx";
import { EmailLayout } from "../components/EmailLayout.jsx";
import { EmailOrderSummary } from "../components/EmailOrderSummary.jsx";
import { EmailStatusBadge } from "../components/EmailStatusBadge.jsx";
import { EmailText } from "../components/EmailText.jsx";

export function OrderCreated({ customerName, orderNumber, total, items = [], orderUrl }) {
  const preorderItems = items.filter(item => String(item?.name || "").includes("— Pré-venda —"));
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
        {preorderItems.length ? "Recebemos seu pedido. Após a confirmação do pagamento integral, os itens de pré-venda entram na demanda do lote. A produção seguirá o calendário do lançamento; o envio ocorrerá quando todos os itens estiverem disponíveis." : "Recebemos seu pedido e reservamos os itens selecionados. Agora aguardamos a confirmação do pagamento para iniciar a preparação."}
      </EmailText>

      <EmailOrderSummary orderNumber={orderNumber} total={total} statusLabel="Pedido criado" items={items} />
      {preorderItems.map((item, index) => <EmailText key={index}>{item.name}</EmailText>)}
      <EmailButton href={orderUrl}>Acompanhar pedido</EmailButton>
    </EmailLayout>
  );
}
