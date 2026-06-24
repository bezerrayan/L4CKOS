import { Body, Head, Html, Preview } from "@react-email/components";
import { EmailFooter } from "./EmailFooter.jsx";
import { EmailHeader } from "./EmailHeader.jsx";

export function EmailLayout({
  preview,
  title,
  subtitle,
  footerNote,
  unsubscribeUrl,
  isMarketing = false,
  children,
}) {
  return (
    <Html lang="pt-BR">
      <Head>
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <meta name="color-scheme" content="dark" />
        <meta name="supported-color-schemes" content="dark" />
        <style>{responsiveCss}</style>
      </Head>
      <Preview>{preview || title || "L4CKOS"}</Preview>
      <Body className="email-body" style={styles.body}>
        <table
          role="presentation"
          cellPadding="0"
          cellSpacing="0"
          border="0"
          width="100%"
          bgcolor="#050505"
          className="email-outer"
          style={styles.outerTable}
        >
          <tbody>
            <tr>
              <td align="center" className="email-outer-cell" style={styles.outerCell}>
                <table
                  role="presentation"
                  cellPadding="0"
                  cellSpacing="0"
                  border="0"
                  width="620"
                  bgcolor="#090909"
                  className="email-shell"
                  style={styles.shellTable}
                >
                  <tbody>
                    <tr>
                      <td bgcolor="#d5152f" style={styles.topBar}>&nbsp;</td>
                    </tr>
                    <tr>
                      <td bgcolor="#090909" className="email-surface" style={styles.shellCell}>
                        <EmailHeader title={title} subtitle={subtitle} />
                        <table
                          role="presentation"
                          cellPadding="0"
                          cellSpacing="0"
                          border="0"
                          width="100%"
                          bgcolor="#090909"
                          className="email-content-table"
                          style={styles.contentTable}
                        >
                          <tbody>
                            <tr>
                              <td bgcolor="#090909" className="email-content" style={styles.contentCell}>
                                {children}
                              </td>
                            </tr>
                          </tbody>
                        </table>
                        <EmailFooter
                          note={footerNote}
                          unsubscribeUrl={unsubscribeUrl}
                          isMarketing={isMarketing}
                        />
                      </td>
                    </tr>
                  </tbody>
                </table>
              </td>
            </tr>
          </tbody>
        </table>
      </Body>
    </Html>
  );
}

const darkGradient = "linear-gradient(#050505, #050505)";
const surfaceGradient = "linear-gradient(#090909, #090909)";

const styles = {
  body: {
    margin: 0,
    padding: 0,
    backgroundColor: "#050505",
    backgroundImage: darkGradient,
    fontFamily: "Arial, Helvetica, sans-serif",
    WebkitTextSizeAdjust: "100%",
  },
  outerTable: {
    width: "100%",
    borderCollapse: "collapse",
    backgroundColor: "#050505",
    backgroundImage: darkGradient,
  },
  outerCell: {
    padding: "32px 12px",
  },
  shellTable: {
    width: "620px",
    maxWidth: "620px",
    borderCollapse: "collapse",
    backgroundColor: "#090909",
    backgroundImage: surfaceGradient,
    border: "1px solid #202020",
  },
  topBar: {
    height: "4px",
    fontSize: "0",
    lineHeight: "0",
    backgroundColor: "#d5152f",
  },
  shellCell: {
    backgroundColor: "#090909",
    backgroundImage: surfaceGradient,
  },
  contentTable: {
    width: "100%",
    borderCollapse: "collapse",
    backgroundColor: "#090909",
    backgroundImage: surfaceGradient,
  },
  contentCell: {
    padding: "30px 32px 36px",
    backgroundColor: "#090909",
    backgroundImage: surfaceGradient,
    color: "#d8d4cf",
    fontSize: "16px",
    lineHeight: "1.7",
  },
};

const responsiveCss = `
  :root {
    color-scheme: dark;
    supported-color-schemes: dark;
  }

  .email-body,
  .email-outer {
    background-color: #050505 !important;
    background-image: linear-gradient(#050505, #050505) !important;
  }

  .email-shell,
  .email-surface,
  .email-content-table,
  .email-content,
  .email-header,
  .email-footer {
    background-color: #090909 !important;
    background-image: linear-gradient(#090909, #090909) !important;
  }

  .email-content p {
    color: #d8d4cf !important;
  }

  .email-button {
    box-sizing: border-box !important;
  }

  @media only screen and (max-width: 640px) {
    .email-outer-cell {
      padding: 0 !important;
    }

    .email-shell {
      width: 100% !important;
      max-width: 100% !important;
      border-left: 0 !important;
      border-right: 0 !important;
    }

    .email-header-cell,
    .email-content,
    .email-footer-cell {
      padding-left: 22px !important;
      padding-right: 22px !important;
    }

    .email-title {
      font-size: 30px !important;
      line-height: 36px !important;
      letter-spacing: -0.6px !important;
    }

    .email-header-tagline {
      display: none !important;
    }

    .email-button-wrap {
      width: 100% !important;
    }

    .email-button {
      display: block !important;
      width: 100% !important;
      text-align: center !important;
    }

    .email-footer-logo-cell {
      width: 46px !important;
    }
  }

  @media (prefers-color-scheme: dark) {
    .email-body,
    .email-outer {
      background-color: #050505 !important;
      background-image: linear-gradient(#050505, #050505) !important;
    }

    .email-shell,
    .email-surface,
    .email-content-table,
    .email-content,
    .email-header,
    .email-footer {
      background-color: #090909 !important;
      background-image: linear-gradient(#090909, #090909) !important;
    }
  }

  [data-ogsc] .email-body,
  [data-ogsc] .email-outer {
    background-color: #050505 !important;
  }

  [data-ogsc] .email-shell,
  [data-ogsc] .email-surface,
  [data-ogsc] .email-content-table,
  [data-ogsc] .email-content,
  [data-ogsc] .email-header,
  [data-ogsc] .email-footer {
    background-color: #090909 !important;
  }
`;
