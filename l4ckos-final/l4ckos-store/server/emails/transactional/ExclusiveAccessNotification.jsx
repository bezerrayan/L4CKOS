import { EmailLayout } from "../components/EmailLayout.jsx";
import { EmailText } from "../components/EmailText.jsx";

const copy = {
  request_received: { title: "Solicitação recebida.", preview: "Recebemos sua solicitação de acesso ao drop exclusivo.", body: "Sua solicitação de acesso ao drop exclusivo foi recebida. Você receberá outra mensagem quando houver uma decisão." },
  access_approved: { title: "Acesso aprovado.", preview: "Seu acesso ao drop exclusivo foi aprovado.", body: "Seu acesso ao drop exclusivo foi aprovado. Entre na sua conta e consulte a página do produto para continuar." },
  access_rejected: { title: "Solicitação atualizada.", preview: "Há uma atualização sobre sua solicitação de acesso.", body: "Sua solicitação de acesso ao drop exclusivo foi atualizada. Consulte a página do produto para ver as opções disponíveis." },
  access_revoked: { title: "Acesso atualizado.", preview: "Há uma atualização sobre seu acesso ao drop exclusivo.", body: "Seu acesso ao drop exclusivo foi atualizado. Se você já iniciou uma compra, consulte o status no checkout." },
};

export function ExclusiveAccessNotification({ customerName, eventType }) {
  const message = copy[eventType] ?? copy.request_received;
  return (
    <EmailLayout title={message.title} preview={message.preview} footerNote="Você recebeu este e-mail por causa de uma solicitação de acesso a um drop exclusivo da L4CKOS.">
      <EmailText variant="lead">{customerName ? `Olá, ${customerName}.` : "Olá."}</EmailText>
      <EmailText>{message.body}</EmailText>
      <EmailText>Para proteger seu acesso, códigos individuais não são enviados por e-mail. Entre na sua conta L4CKOS para consultar as instruções.</EmailText>
    </EmailLayout>
  );
}
