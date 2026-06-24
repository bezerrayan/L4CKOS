import { EmailButton } from "../components/EmailButton.jsx";
import { EmailLayout } from "../components/EmailLayout.jsx";
import { EmailStatusBadge } from "../components/EmailStatusBadge.jsx";
import { EmailText } from "../components/EmailText.jsx";

export function WelcomeAccount({ name, appUrl }) {
  const greeting = name ? `Olá, ${name}.` : "Olá.";

  return (
    <EmailLayout
      preview="Sua conta L4CKOS está pronta"
      title="Bem-vindo à L4CKOS."
      subtitle="Sua conta está pronta"
      footerNote="Você recebeu este e-mail porque uma conta foi criada na L4CKOS com este endereço."
    >
      <EmailStatusBadge tone="success">Conta ativa</EmailStatusBadge>
      <EmailText variant="lead">{greeting}</EmailText>
      <EmailText>
        Sua conta foi criada com sucesso. Agora você pode acompanhar pedidos, salvar favoritos, revisar endereços e
        acessar sua experiência L4CKOS em um só lugar.
      </EmailText>
      <EmailButton href={appUrl}>Acessar minha conta</EmailButton>
    </EmailLayout>
  );
}
