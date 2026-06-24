import { Column, Row, Text } from "@react-email/components";
import { EmailPanel } from "./EmailPanel.jsx";
import { EmailSectionTitle } from "./EmailSectionTitle.jsx";

export function EmailOrderSummary({ orderNumber, total, statusLabel, shippingLabel, items = [] }) {
  return (
    <>
      <EmailSectionTitle>Resumo do pedido</EmailSectionTitle>
      <EmailPanel>
        <Row>
          <Column style={total ? styles.leftColumn : styles.fullColumn}>
            <Text style={styles.label}>Pedido</Text>
            <Text style={styles.value}>#{orderNumber || "-"}</Text>
          </Column>
          {total ? (
            <Column style={styles.rightColumn}>
              <Text style={styles.label}>Total</Text>
              <Text style={styles.value}>{total}</Text>
            </Column>
          ) : null}
        </Row>

        {statusLabel || shippingLabel ? (
          <Row style={styles.metaRow}>
            <Column style={styles.leftColumn}>
              {statusLabel ? (
                <>
                  <Text style={styles.label}>Status</Text>
                  <Text style={styles.secondary}>{statusLabel}</Text>
                </>
              ) : null}
            </Column>
            <Column style={styles.rightColumn}>
              {shippingLabel ? (
                <>
                  <Text style={styles.label}>Entrega</Text>
                  <Text style={styles.secondary}>{shippingLabel}</Text>
                </>
              ) : null}
            </Column>
          </Row>
        ) : null}

        {Array.isArray(items) && items.length ? (
          <table role="presentation" cellPadding="0" cellSpacing="0" border="0" width="100%" style={styles.itemsTable}>
            <tbody>
              {items.slice(0, 4).map((item, index) => (
                <tr key={`${item?.name || item?.title || "item"}-${index}`}>
                  <td style={styles.itemCell}>
                    <Text style={styles.itemName}>{item?.name || item?.title || `Item ${index + 1}`}</Text>
                    <Text style={styles.itemMeta}>Quantidade: {item?.quantity || item?.qty || 1}</Text>
                  </td>
                  <td align="right" style={styles.priceCell}>
                    <Text style={styles.price}>{item?.price || item?.unitPrice || ""}</Text>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : null}
      </EmailPanel>
    </>
  );
}

const styles = {
  fullColumn: {
    width: "100%",
    verticalAlign: "top",
  },
  leftColumn: {
    width: "50%",
    paddingRight: "10px",
    verticalAlign: "top",
  },
  rightColumn: {
    width: "50%",
    paddingLeft: "10px",
    verticalAlign: "top",
  },
  metaRow: {
    borderTop: "1px solid #272727",
  },
  label: {
    margin: "0 0 4px",
    color: "#77736f",
    fontSize: "9px",
    lineHeight: "12px",
    fontWeight: "800",
    letterSpacing: "1.4px",
    textTransform: "uppercase",
  },
  value: {
    margin: "0 0 14px",
    color: "#f4f1ec",
    fontSize: "19px",
    lineHeight: "24px",
    fontWeight: "800",
  },
  secondary: {
    margin: "0 0 10px",
    color: "#c5c0ba",
    fontSize: "13px",
    lineHeight: "20px",
  },
  itemsTable: {
    width: "100%",
    marginTop: "8px",
    borderCollapse: "collapse",
    borderTop: "1px solid #272727",
  },
  itemCell: {
    padding: "12px 10px 10px 0",
    borderBottom: "1px solid #222222",
  },
  priceCell: {
    width: "110px",
    padding: "12px 0 10px 10px",
    borderBottom: "1px solid #222222",
    verticalAlign: "top",
  },
  itemName: {
    margin: 0,
    color: "#f4f1ec",
    fontSize: "13px",
    lineHeight: "19px",
    fontWeight: "700",
  },
  itemMeta: {
    margin: "3px 0 0",
    color: "#77736f",
    fontSize: "10px",
    lineHeight: "16px",
  },
  price: {
    margin: 0,
    color: "#c5c0ba",
    fontSize: "12px",
    lineHeight: "18px",
    fontWeight: "700",
  },
};
