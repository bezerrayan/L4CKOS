import { Section, Text } from "@react-email/components";

export function EmailPanel({ children, title }) {
  return (
    <Section style={styles.panel}>
      {title ? <Text style={styles.title}>{title}</Text> : null}
      {children}
    </Section>
  );
}

const styles = {
  panel: {
    margin: "14px 0 18px",
    padding: "18px 18px",
    backgroundColor: "#101010",
    backgroundImage: "linear-gradient(#101010, #101010)",
    border: "1px solid #262626",
    borderRadius: "4px",
  },
  title: {
    margin: "0 0 12px",
    color: "#f4f1ec",
    fontSize: "14px",
    lineHeight: "20px",
    fontWeight: "800",
  },
};
