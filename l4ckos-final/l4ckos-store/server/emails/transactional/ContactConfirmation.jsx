import { EmailLayout } from "../components/EmailLayout.jsx";
import { EmailStatusBadge } from "../components/EmailStatusBadge.jsx";
import { EmailText } from "../components/EmailText.jsx";

export function ContactConfirmation({ name }) {
  const greeting = name ? `Olá, ${name}.` : "Olá.";

  return (
    <EmailLayout
      preview="Recebemos sua mensagem"
      title="Mensagem recebida."
      subtitle="Atendimento L4CKOS"
      footerNote="Esta é uma confirmação automática de recebimento. Nossa equipe responderá pelo mesmo endereço de e-mail."
    >
      <EmailStatusBadge tone="neutral">Atendimento</EmailStatusBadge>
      <EmailText variant="lead">{greeting}</EmailText>
      <EmailText>
        Sua mensagem foi recebida e já entrou na fila de atendimento da L4CKOS. Assim que houver uma atualização,
        responderemos por este mesmo e-mail.
      </EmailText>
      <EmailText variant="small">
        Por segurança, não envie senhas, códigos de autenticação ou dados bancários por e-mail.
      </EmailText>
    </EmailLayout>
  );
}
