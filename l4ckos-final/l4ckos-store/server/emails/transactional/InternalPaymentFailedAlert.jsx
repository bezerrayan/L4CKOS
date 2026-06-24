import { EmailInfoRow } from "../components/EmailInfoRow.jsx";
import { EmailLayout } from "../components/EmailLayout.jsx";
import { EmailPanel } from "../components/EmailPanel.jsx";
import { EmailStatusBadge } from "../components/EmailStatusBadge.jsx";
import { EmailText } from "../components/EmailText.jsx";

export function InternalPaymentFailedAlert({ customerName, customerEmail, orderNumber, total, failureReason }) {
  return (
    <EmailLayout
      preview={`Falha de pagamento no pedido #${orderNumber || "-"}`}
      title="Falha de pagamento."
      subtitle={`Pedido #${orderNumber || "-"}`}
      footerNote="Mensagem automática destinada à equipe operacional da L4CKOS."
    >
      <EmailStatusBadge tone="danger">Atenção operacional</EmailStatusBadge>
      <EmailText>O provedor retornou uma falha de pagamento que pode exigir acompanhamento.</EmailText>

      <EmailPanel title="Contexto do pedido">
        <EmailInfoRow label="Cliente" value={customerName || "Cliente não informado"} />
        <EmailInfoRow label="E-mail" value={customerEmail || "Não informado"} />
        <EmailInfoRow label="Total previsto" value={total || "-"} />
        <EmailInfoRow label="Motivo" value={failureReason || "Não informado pelo provedor"} />
      </EmailPanel>
    </EmailLayout>
  );
}
