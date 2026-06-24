import { Text } from "@react-email/components";
import { EmailPanel } from "./EmailPanel.jsx";
import { EmailSectionTitle } from "./EmailSectionTitle.jsx";

export function EmailCouponPanel({ code, description }) {
  if (!code) return null;

  return (
    <>
      <EmailSectionTitle>Seu benefício</EmailSectionTitle>
      <EmailPanel>
        <Text style={styles.label}>Código</Text>
        <Text style={styles.code}>{code}</Text>
        {description ? <Text style={styles.description}>{description}</Text> : null}
      </EmailPanel>
    </>
  );
}

const styles = {
  label: {
    margin: "0 0 6px",
    color: "#77736f",
    fontSize: "9px",
    lineHeight: "12px",
    fontWeight: "800",
    letterSpacing: "1.5px",
    textTransform: "uppercase",
  },
  code: {
    margin: "0",
    color: "#f4f1ec",
    fontSize: "24px",
    lineHeight: "30px",
    fontWeight: "800",
    letterSpacing: "2.8px",
    textTransform: "uppercase",
  },
  description: {
    margin: "10px 0 0",
    color: "#99948e",
    fontSize: "13px",
    lineHeight: "21px",
  },
};
