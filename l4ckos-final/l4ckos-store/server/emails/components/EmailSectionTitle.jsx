import { Text } from "@react-email/components";

export function EmailSectionTitle({ children }) {
  return <Text style={styles.title}>{children}</Text>;
}

const styles = {
  title: {
    margin: "26px 0 10px",
    paddingLeft: "10px",
    color: "#e6576a",
    fontSize: "10px",
    lineHeight: "14px",
    fontWeight: "800",
    letterSpacing: "1.8px",
    textTransform: "uppercase",
    borderLeft: "3px solid #d5152f",
  },
};
