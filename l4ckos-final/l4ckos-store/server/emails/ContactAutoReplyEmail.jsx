import { EmailLayout } from "./components/EmailLayout.jsx";
import { EmailText } from "./components/EmailText.jsx";

export function ContactAutoReplyEmail({ name }) {
  const greeting = name ? `Olá, ${name}.` : "Olá.";

  return (
    <EmailLayout
      preview="Recebemos sua mensagem"
      title="Mensagem recebida."
      subtitle="Atendimento L4CKOS"
      footerNote="Esta é uma confirmação automática de recebimento. Nossa equipe responderá pelo mesmo endereço de e-mail."
    >
      <EmailText variant="lead">{greeting}</EmailText>
      <EmailText>
        Obrigado pelo contato. Sua mensagem foi recebida e já está com a equipe da L4CKOS.
      </EmailText>
      <EmailText>Assim que houver uma atualização, responderemos por este mesmo e-mail.</EmailText>
      <EmailText variant="small">
        Por segurança, não envie senhas, códigos de autenticação ou dados bancários por e-mail.
      </EmailText>
    </EmailLayout>
  );
}
