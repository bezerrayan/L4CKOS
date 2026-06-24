import { Text } from "@react-email/components";

export function EmailInfoRow({ label, value }) {
  return (
    <Text style={styles.row}>
      <strong style={styles.label}>{label}</strong>
      <span style={styles.value}> {value}</span>
    </Text>
  );
}

const styles = {
  row: {
    margin: "0 0 9px",
    color: "#d8d4cf",
    fontSize: "13px",
    lineHeight: "21px",
  },
  label: {
    color: "#e6576a",
    fontSize: "10px",
    fontWeight: "800",
    letterSpacing: "1.1px",
    textTransform: "uppercase",
  },
  value: {
    color: "#d8d4cf",
  },
};
