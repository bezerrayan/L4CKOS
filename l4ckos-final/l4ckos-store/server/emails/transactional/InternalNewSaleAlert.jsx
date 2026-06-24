import { EmailButton } from "../components/EmailButton.jsx";
import { EmailInfoRow } from "../components/EmailInfoRow.jsx";
import { EmailLayout } from "../components/EmailLayout.jsx";
import { EmailOrderSummary } from "../components/EmailOrderSummary.jsx";
import { EmailPanel } from "../components/EmailPanel.jsx";
import { EmailProductGrid } from "../components/EmailProductGrid.jsx";
import { EmailSectionTitle } from "../components/EmailSectionTitle.jsx";
import { EmailStatusBadge } from "../components/EmailStatusBadge.jsx";
import { EmailText } from "../components/EmailText.jsx";

export function InternalNewSaleAlert({ customerName, customerEmail, orderNumber, total, items = [], orderUrl }) {
  return (
    <EmailLayout
      preview={`Nova venda confirmada: pedido #${orderNumber || "-"}`}
      title="Nova venda confirmada."
      subtitle={`Pedido #${orderNumber || "-"}`}
      footerNote="Mensagem automática destinada à equipe operacional da L4CKOS."
    >
      <EmailStatusBadge tone="success">Venda confirmada</EmailStatusBadge>
      <EmailText>O pagamento foi confirmado e o pedido já pode seguir para a operação.</EmailText>

      <EmailOrderSummary
        orderNumber={orderNumber}
        total={total}
        items={items}
        statusLabel="Pagamento aprovado"
      />

      <EmailProductGrid title="Itens vendidos" products={items} />

      <EmailSectionTitle>Cliente</EmailSectionTitle>
      <EmailPanel>
        <EmailInfoRow label="Nome" value={customerName || "Cliente não informado"} />
        <EmailInfoRow label="E-mail" value={customerEmail || "Não informado"} />
      </EmailPanel>

      <EmailButton href={orderUrl}>Abrir pedido</EmailButton>
    </EmailLayout>
  );
}
