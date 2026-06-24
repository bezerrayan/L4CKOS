import { Button, Section } from "@react-email/components";

export function EmailButton({ href, children }) {
  if (!href) return null;

  return (
    <Section className="email-button-wrap" style={styles.wrap}>
      <Button href={href} className="email-button" style={styles.button}>
        {children}
      </Button>
    </Section>
  );
}

const styles = {
  wrap: {
    margin: "22px 0 2px",
  },
  button: {
    display: "inline-block",
    boxSizing: "border-box",
    minHeight: "48px",
    padding: "15px 24px",
    backgroundColor: "#d5152f",
    color: "#ffffff",
    border: "1px solid #d5152f",
    borderRadius: "3px",
    textDecoration: "none",
    textAlign: "center",
    fontSize: "13px",
    lineHeight: "18px",
    fontWeight: "800",
    letterSpacing: "0.3px",
  },
};
