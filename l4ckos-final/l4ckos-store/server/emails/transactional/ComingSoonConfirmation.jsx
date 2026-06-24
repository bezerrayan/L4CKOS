import { EmailButton } from "../components/EmailButton.jsx";
import { EmailLayout } from "../components/EmailLayout.jsx";
import { EmailPanel } from "../components/EmailPanel.jsx";
import { EmailStatusBadge } from "../components/EmailStatusBadge.jsx";
import { EmailText } from "../components/EmailText.jsx";

export function ComingSoonConfirmation({ name, launchUrl }) {
  const greeting = name ? `Olá, ${name}.` : "Olá.";

  return (
    <EmailLayout
      preview="Seu acesso antecipado à L4CKOS foi confirmado"
      title="Você está dentro."
      subtitle="Acesso antecipado confirmado"
      footerNote="Você recebeu este e-mail porque se cadastrou na lista de acesso antecipado da L4CKOS."
    >
      <EmailStatusBadge tone="info">Acesso antecipado</EmailStatusBadge>
      <EmailText variant="lead">{greeting}</EmailText>
      <EmailText>
        Seu cadastro na lista de acesso antecipado da L4CKOS foi confirmado. Quando o próximo lançamento estiver
        disponível, você receberá o aviso antes da abertura ao público.
      </EmailText>

      <EmailPanel title="O que acontece agora">
        <EmailText style={{ margin: 0 }}>
          Não precisa fazer mais nada. Enviaremos as informações oficiais diretamente para este e-mail.
        </EmailText>
      </EmailPanel>

      <EmailButton href={launchUrl}>Acompanhar novidades</EmailButton>
    </EmailLayout>
  );
}
