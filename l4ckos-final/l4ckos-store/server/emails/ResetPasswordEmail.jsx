import { EmailButton } from "./components/EmailButton.jsx";
import { EmailLayout } from "./components/EmailLayout.jsx";
import { EmailText } from "./components/EmailText.jsx";

export function ResetPasswordEmail({ name, resetUrl }) {
  const greeting = name ? `Olá, ${name}.` : "Olá.";

  return (
    <EmailLayout
      preview="Redefina sua senha da L4CKOS"
      title="Redefinição de senha."
      subtitle="Segurança da conta"
      footerNote="Você recebeu este e-mail porque foi solicitada uma redefinição de senha para sua conta L4CKOS."
    >
      <EmailText variant="lead">{greeting}</EmailText>
      <EmailText>Recebemos uma solicitação para redefinir a senha da sua conta L4CKOS.</EmailText>
      <EmailButton href={resetUrl}>Redefinir senha</EmailButton>
      <EmailText variant="small">
        Caso não tenha solicitado esta alteração, ignore este e-mail. Sua senha continuará a mesma.
      </EmailText>
    </EmailLayout>
  );
}
