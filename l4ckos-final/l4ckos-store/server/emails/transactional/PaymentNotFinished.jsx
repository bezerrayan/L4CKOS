import { EmailButton } from "../components/EmailButton.jsx";
import { EmailInfoRow } from "../components/EmailInfoRow.jsx";
import { EmailLayout } from "../components/EmailLayout.jsx";
import { EmailPanel } from "../components/EmailPanel.jsx";
import { EmailStatusBadge } from "../components/EmailStatusBadge.jsx";
import { EmailText } from "../components/EmailText.jsx";

export function PaymentNotFinished({ customerName, orderNumber, total, paymentUrl, recoveryWindowLabel }) {
  const greeting = customerName ? `Olá, ${customerName}.` : "Olá.";

  return (
    <EmailLayout
      preview={`O pedido #${orderNumber || "-"} ainda pode ser concluído`}
      title="Compra ainda em aberto."
      subtitle={`Pedido #${orderNumber || "-"}`}
      footerNote="Você recebeu este e-mail porque iniciou uma compra na L4CKOS e o pagamento não foi concluído."
    >
      <EmailStatusBadge tone="warning">Pagamento não concluído</EmailStatusBadge>
      <EmailText variant="lead">{greeting}</EmailText>
      <EmailText>
        Identificamos que a compra não foi concluída. Caso ainda queira seguir com o pedido, retome o pagamento pelo
        botão abaixo.
      </EmailText>

      <EmailPanel title="Resumo rápido">
        <EmailInfoRow label="Total previsto" value={total || "-"} />
        <EmailInfoRow
          label="Prazo de retomada"
          value={recoveryWindowLabel || "Enquanto a cobrança permanecer ativa"}
        />
      </EmailPanel>

      <EmailButton href={paymentUrl}>Retomar pagamento</EmailButton>
    </EmailLayout>
  );
}
