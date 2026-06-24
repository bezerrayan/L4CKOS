import { EmailButton } from "../components/EmailButton.jsx";
import { EmailLayout } from "../components/EmailLayout.jsx";
import { EmailStatusBadge } from "../components/EmailStatusBadge.jsx";
import { EmailText } from "../components/EmailText.jsx";

export function PasswordReset({ name, resetUrl }) {
  const greeting = name ? `Olá, ${name}.` : "Olá.";

  return (
    <EmailLayout
      preview="Redefina sua senha da L4CKOS"
      title="Redefinição de senha."
      subtitle="Segurança da conta"
      footerNote="Você recebeu este e-mail porque foi solicitada uma redefinição de senha para sua conta L4CKOS."
    >
      <EmailStatusBadge tone="warning">Ação de segurança</EmailStatusBadge>
      <EmailText variant="lead">{greeting}</EmailText>
      <EmailText>
        Recebemos uma solicitação para redefinir a senha da sua conta. Caso tenha sido você, continue pelo botão
        abaixo. Caso contrário, ignore esta mensagem.
      </EmailText>
      <EmailButton href={resetUrl}>Redefinir senha</EmailButton>
      <EmailText variant="small">Por segurança, o link expira em 1 hora e só pode ser usado uma vez.</EmailText>
    </EmailLayout>
  );
}
