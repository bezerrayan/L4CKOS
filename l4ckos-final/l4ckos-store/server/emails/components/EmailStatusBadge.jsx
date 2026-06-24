import { Text } from "@react-email/components";

const toneMap = {
  neutral: { background: "#141414", border: "#313131", color: "#c8c3bd" },
  info: { background: "#160a0c", border: "#5a1d27", color: "#f06a7c" },
  success: { background: "#160a0c", border: "#5a1d27", color: "#f06a7c" },
  warning: { background: "#18130b", border: "#5a421d", color: "#deb162" },
  danger: { background: "#1a090c", border: "#742132", color: "#ff7185" },
};

export function EmailStatusBadge({ children, tone = "neutral" }) {
  const palette = toneMap[tone] || toneMap.neutral;

  return (
    <Text
      style={{
        ...styles.badge,
        backgroundColor: palette.background,
        backgroundImage: `linear-gradient(${palette.background}, ${palette.background})`,
        borderColor: palette.border,
        color: palette.color,
      }}
    >
      {children}
    </Text>
  );
}

const styles = {
  badge: {
    display: "inline-block",
    margin: "0 0 20px",
    padding: "8px 11px",
    border: "1px solid #313131",
    borderRadius: "3px",
    fontSize: "10px",
    lineHeight: "12px",
    fontWeight: "800",
    letterSpacing: "1.5px",
    textTransform: "uppercase",
  },
};
