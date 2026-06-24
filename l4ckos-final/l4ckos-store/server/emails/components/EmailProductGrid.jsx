import { Link, Text } from "@react-email/components";
import { EmailPanel } from "./EmailPanel.jsx";
import { EmailSectionTitle } from "./EmailSectionTitle.jsx";

export function EmailProductGrid({ title = "Produtos em destaque", products = [] }) {
  if (!Array.isArray(products) || !products.length) return null;

  return (
    <>
      <EmailSectionTitle>{title}</EmailSectionTitle>
      <EmailPanel>
        <table role="presentation" cellPadding="0" cellSpacing="0" border="0" width="100%" style={styles.table}>
          <tbody>
            {products.slice(0, 4).map((product, index) => {
              const content = (
                <>
                  <Text style={styles.name}>{product?.name || product?.title || `Produto ${index + 1}`}</Text>
                  {product?.description ? <Text style={styles.description}>{product.description}</Text> : null}
                </>
              );

              return (
                <tr key={`${product?.name || product?.title || "produto"}-${index}`}>
                  <td style={{ ...styles.cell, ...(index === products.slice(0, 4).length - 1 ? styles.lastCell : {}) }}>
                    {product?.url ? <Link href={product.url} style={styles.productLink}>{content}</Link> : content}
                  </td>
                  <td
                    align="right"
                    style={{ ...styles.priceCell, ...(index === products.slice(0, 4).length - 1 ? styles.lastCell : {}) }}
                  >
                    {product?.price ? <Text style={styles.price}>{product.price}</Text> : null}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </EmailPanel>
    </>
  );
}

const styles = {
  table: {
    width: "100%",
    borderCollapse: "collapse",
  },
  cell: {
    padding: "11px 10px 11px 0",
    borderBottom: "1px solid #262626",
    verticalAlign: "top",
  },
  priceCell: {
    width: "110px",
    padding: "11px 0 11px 10px",
    borderBottom: "1px solid #262626",
    verticalAlign: "top",
  },
  lastCell: {
    borderBottom: "0",
  },
  productLink: {
    color: "#f4f1ec",
    textDecoration: "none",
  },
  name: {
    margin: 0,
    color: "#f4f1ec",
    fontSize: "13px",
    lineHeight: "19px",
    fontWeight: "800",
  },
  description: {
    margin: "4px 0 0",
    color: "#8d8984",
    fontSize: "11px",
    lineHeight: "17px",
  },
  price: {
    margin: 0,
    color: "#c5c0ba",
    fontSize: "12px",
    lineHeight: "18px",
    fontWeight: "700",
  },
};
