import { Text } from "@react-email/components";

export function EmailText({ children, variant = "body", style }) {
  const variantStyle = variants[variant] || variants.body;
  return <Text style={{ ...styles.base, ...variantStyle, ...(style || {}) }}>{children}</Text>;
}

const styles = {
  base: {
    color: "#d8d4cf",
    fontFamily: "Arial, Helvetica, sans-serif",
  },
};

const variants = {
  body: {
    margin: "0 0 16px",
    fontSize: "16px",
    lineHeight: "27px",
    fontWeight: "400",
  },
  lead: {
    margin: "0 0 14px",
    color: "#f4f1ec",
    fontSize: "23px",
    lineHeight: "30px",
    fontWeight: "800",
    letterSpacing: "-0.3px",
  },
  muted: {
    margin: "0 0 12px",
    color: "#99948e",
    fontSize: "13px",
    lineHeight: "21px",
  },
  small: {
    margin: "0 0 10px",
    color: "#8d8984",
    fontSize: "11px",
    lineHeight: "18px",
  },
};
