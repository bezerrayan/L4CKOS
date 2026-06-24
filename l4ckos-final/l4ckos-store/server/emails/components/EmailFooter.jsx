import { Img, Link, Text } from "@react-email/components";

export function EmailFooter({ note, unsubscribeUrl, isMarketing = false }) {
  const logoUrl = String(process.env.EMAIL_SIGNATURE_LOGO_URL || "").trim();
  const contactEmail = String(process.env.EMAIL_SIGNATURE_CONTACT_EMAIL || "contato@l4ckos.com.br").trim();
  const websiteUrl = String(process.env.EMAIL_SIGNATURE_WEBSITE || "https://l4ckos.com.br").trim();
  const instagramUrl = String(process.env.EMAIL_SIGNATURE_INSTAGRAM_URL || "https://instagram.com/l4ckosstore").trim();
  const instagramLabel = String(process.env.EMAIL_SIGNATURE_INSTAGRAM_LABEL || "@l4ckosstore").trim();
  const privacyUrl = String(
    process.env.EMAIL_SIGNATURE_PRIVACY_URL || `${websiteUrl.replace(/\/$/, "")}/politica-de-privacidade`,
  ).trim();
  const websiteLabel = websiteUrl.replace(/^https?:\/\//, "").replace(/\/$/, "");
  const currentYear = new Date().getFullYear();
  const defaultNote = isMarketing
    ? "Você recebeu este e-mail porque optou por receber novidades da L4CKOS."
    : "Esta é uma mensagem automática sobre sua conta, pedido ou solicitação na L4CKOS.";

  return (
    <table
      role="presentation"
      cellPadding="0"
      cellSpacing="0"
      border="0"
      width="100%"
      bgcolor="#090909"
      className="email-footer"
      style={styles.table}
    >
      <tbody>
        <tr>
          <td bgcolor="#090909" className="email-footer-cell" style={styles.cell}>
            <table role="presentation" cellPadding="0" cellSpacing="0" border="0" width="100%" style={styles.brandTable}>
              <tbody>
                <tr>
                  {logoUrl ? (
                    <td valign="middle" width="48" className="email-footer-logo-cell" style={styles.logoCell}>
                      <Img src={logoUrl} alt="L4CKOS" width="38" height="38" style={styles.logo} />
                    </td>
                  ) : null}
                  <td valign="middle">
                    <Text style={styles.brand}>L4CKOS</Text>
                    <Text style={styles.slogan}>Built for Adventure.</Text>
                  </td>
                </tr>
              </tbody>
            </table>

            <Text style={styles.links}>
              <Link href={websiteUrl} style={styles.link}>{websiteLabel}</Link>
              <span style={styles.separator}> · </span>
              <Link href={instagramUrl} style={styles.link}>{instagramLabel}</Link>
              <span style={styles.separator}> · </span>
              <Link href={`mailto:${contactEmail}`} style={styles.link}>{contactEmail}</Link>
            </Text>

            <Text style={styles.legal}>{note || defaultNote}</Text>

            <Text style={styles.actions}>
              <Link href={privacyUrl} style={styles.mutedLink}>Política de privacidade</Link>
              {isMarketing && unsubscribeUrl ? (
                <>
                  <span style={styles.separator}> · </span>
                  <Link href={unsubscribeUrl} style={styles.unsubscribeLink}>Cancelar inscrição</Link>
                </>
              ) : null}
            </Text>

            <Text style={styles.copyright}>© {currentYear} L4CKOS.</Text>
          </td>
        </tr>
      </tbody>
    </table>
  );
}

const styles = {
  table: {
    width: "100%",
    borderCollapse: "collapse",
    backgroundColor: "#090909",
    backgroundImage: "linear-gradient(#090909, #090909)",
  },
  cell: {
    padding: "24px 32px 28px",
    backgroundColor: "#090909",
    backgroundImage: "linear-gradient(#090909, #090909)",
    borderTop: "1px solid #202020",
  },
  brandTable: {
    width: "100%",
    borderCollapse: "collapse",
  },
  logoCell: {
    width: "48px",
    paddingRight: "10px",
  },
  logo: {
    display: "block",
    width: "38px",
    height: "38px",
    objectFit: "cover",
    border: "1px solid #292929",
    backgroundColor: "#111111",
  },
  brand: {
    margin: 0,
    color: "#f4f1ec",
    fontSize: "18px",
    lineHeight: "22px",
    fontWeight: "800",
    letterSpacing: "0.2px",
  },
  slogan: {
    margin: "2px 0 0",
    color: "#8d8984",
    fontSize: "11px",
    lineHeight: "16px",
    fontStyle: "italic",
  },
  links: {
    margin: "16px 0 0",
    color: "#bcb7b1",
    fontSize: "12px",
    lineHeight: "21px",
  },
  link: {
    color: "#bcb7b1",
    textDecoration: "none",
  },
  legal: {
    margin: "14px 0 0",
    color: "#77736f",
    fontSize: "10px",
    lineHeight: "17px",
  },
  actions: {
    margin: "7px 0 0",
    color: "#77736f",
    fontSize: "10px",
    lineHeight: "17px",
  },
  mutedLink: {
    color: "#8d8984",
    textDecoration: "underline",
  },
  unsubscribeLink: {
    color: "#d84a5e",
    textDecoration: "underline",
  },
  separator: {
    color: "#595959",
  },
  copyright: {
    margin: "7px 0 0",
    color: "#595959",
    fontSize: "9px",
    lineHeight: "14px",
  },
};
