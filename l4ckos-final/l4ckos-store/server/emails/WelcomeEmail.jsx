import { EmailButton } from "./components/EmailButton.jsx";
import { EmailLayout } from "./components/EmailLayout.jsx";
import { EmailText } from "./components/EmailText.jsx";

export function WelcomeEmail({ name }) {
  const greeting = name ? `Olá, ${name}.` : "Olá.";
  const appBase = String(process.env.APP_BASE_URL || "https://l4ckos.com.br").replace(/\/$/, "");

  return (
    <EmailLayout
      preview="Sua conta L4CKOS está pronta"
      title="Bem-vindo à L4CKOS."
      subtitle="Sua conta está pronta"
      footerNote="Você recebeu este e-mail porque uma conta foi criada na L4CKOS com este endereço."
    >
      <EmailText variant="lead">{greeting}</EmailText>
      <EmailText>
        Sua conta foi criada com sucesso. Agora você pode acompanhar pedidos, salvar favoritos e acessar sua
        experiência L4CKOS em um só lugar.
      </EmailText>
      <EmailButton href={`${appBase}/login`}>Acessar minha conta</EmailButton>
    </EmailLayout>
  );
}
