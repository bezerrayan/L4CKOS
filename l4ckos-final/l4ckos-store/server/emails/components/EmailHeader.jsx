import { Text } from "@react-email/components";

export function EmailHeader({ title, subtitle }) {
  return (
    <table
      role="presentation"
      cellPadding="0"
      cellSpacing="0"
      border="0"
      width="100%"
      bgcolor="#090909"
      className="email-header"
      style={styles.table}
    >
      <tbody>
        <tr>
          <td bgcolor="#090909" className="email-header-cell" style={styles.cell}>
            <table role="presentation" cellPadding="0" cellSpacing="0" border="0" width="100%" style={styles.metaTable}>
              <tbody>
                <tr>
                  <td valign="middle">
                    <Text style={styles.brand}>L4CKOS</Text>
                  </td>
                  <td align="right" valign="middle" className="email-header-tagline">
                    <Text style={styles.tagline}>BUILT FOR ADVENTURE</Text>
                  </td>
                </tr>
              </tbody>
            </table>

            <table role="presentation" cellPadding="0" cellSpacing="0" border="0" style={styles.ruleTable}>
              <tbody>
                <tr>
                  <td bgcolor="#d5152f" style={styles.rule}>&nbsp;</td>
                </tr>
              </tbody>
            </table>

            {title ? (
              <Text className="email-title" style={styles.title}>
                {title}
              </Text>
            ) : null}
            {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
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
    padding: "28px 32px 26px",
    backgroundColor: "#090909",
    backgroundImage: "linear-gradient(#090909, #090909)",
    borderBottom: "1px solid #202020",
  },
  metaTable: {
    width: "100%",
    borderCollapse: "collapse",
  },
  brand: {
    margin: 0,
    color: "#f4f1ec",
    fontSize: "11px",
    lineHeight: "14px",
    fontWeight: "800",
    letterSpacing: "4.6px",
    textTransform: "uppercase",
  },
  tagline: {
    margin: 0,
    color: "#747474",
    fontSize: "9px",
    lineHeight: "12px",
    fontWeight: "700",
    letterSpacing: "2px",
  },
  ruleTable: {
    borderCollapse: "collapse",
    marginTop: "16px",
  },
  rule: {
    width: "56px",
    height: "3px",
    backgroundColor: "#d5152f",
    fontSize: 0,
    lineHeight: 0,
  },
  title: {
    margin: "22px 0 0",
    color: "#f4f1ec",
    fontSize: "36px",
    lineHeight: "42px",
    fontWeight: "800",
    letterSpacing: "-0.9px",
  },
  subtitle: {
    margin: "9px 0 0",
    color: "#a9a5a0",
    fontSize: "14px",
    lineHeight: "22px",
  },
};
