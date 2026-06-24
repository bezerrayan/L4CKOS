import { Link } from "@react-email/components";
import { EmailInfoRow } from "../components/EmailInfoRow.jsx";
import { EmailLayout } from "../components/EmailLayout.jsx";
import { EmailPanel } from "../components/EmailPanel.jsx";
import { EmailSectionTitle } from "../components/EmailSectionTitle.jsx";
import { EmailStatusBadge } from "../components/EmailStatusBadge.jsx";
import { EmailText } from "../components/EmailText.jsx";

export function NewContactInternal({ name, email, phone, subject, message }) {
  return (
    <EmailLayout
      preview="Novo contato recebido pelo site"
      title="Novo contato."
      subtitle="Formulário da loja"
      footerNote="Mensagem automática destinada à equipe de atendimento da L4CKOS."
    >
      <EmailStatusBadge tone="info">Novo atendimento</EmailStatusBadge>

      <EmailSectionTitle>Dados do contato</EmailSectionTitle>
      <EmailPanel>
        <EmailInfoRow label="Nome" value={name || "-"} />
        <EmailInfoRow
          label="E-mail"
          value={
            email ? (
              <Link href={`mailto:${email}`} style={styles.link}>{email}</Link>
            ) : (
              "-"
            )
          }
        />
        {phone ? <EmailInfoRow label="Telefone" value={phone} /> : null}
        <EmailInfoRow label="Assunto" value={subject || "Contato geral"} />
      </EmailPanel>

      <EmailSectionTitle>Mensagem</EmailSectionTitle>
      <EmailPanel>
        <EmailText style={styles.message}>{message || "-"}</EmailText>
      </EmailPanel>
    </EmailLayout>
  );
}

const styles = {
  link: {
    color: "#f4f1ec",
    textDecoration: "underline",
  },
  message: {
    margin: 0,
    whiteSpace: "pre-wrap",
  },
};
