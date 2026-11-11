import { useState } from "react";
import type { CSSProperties } from "react";
import { Link } from "react-router-dom";
import { trpc } from "../lib/trpc";
import { useToast } from "../contexts/ToastContext";
import { useIsMobile } from "../hooks/useIsMobile";
import logoMainDark from "../images/l4ckos-main-dark-transparent.png";
import { getApiErrorDisplay } from "../utils/apiError";

function isValidEmail(email: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email);
}

export default function EsqueciSenha() {
  const isMobile = useIsMobile();
  const { showToast } = useToast();
  const requestResetMutation = trpc.auth.requestPasswordReset.useMutation();
  const [email, setEmail] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const [formError, setFormError] = useState<{ message: string; details: string[] } | null>(null);

  const isBusy = requestResetMutation.isPending;

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    const normalizedEmail = email.trim().toLowerCase();

    if (!normalizedEmail) {
      showToast({ message: "Informe seu e-mail para continuar.", duration: 3000 });
      return;
    }

    if (!isValidEmail(normalizedEmail)) {
      showToast({ message: "Informe um e-mail válido.", duration: 3000 });
      return;
    }

    setFormError(null);

    try {
      const response = await requestResetMutation.mutateAsync({ email: normalizedEmail });
      setSubmitted(true);
      showToast({ message: response.message, duration: 4000 });
    } catch (error) {
      const parsed = getApiErrorDisplay(error, "Não foi possível iniciar a redefinição agora.");
      setFormError({ message: parsed.message, details: parsed.details });
      showToast({ message: parsed.message, duration: 3000 });
    }
  };

  return (
    <div
      style={{
        ...styles.container,
        gridTemplateColumns: isMobile ? "1fr" : styles.container.gridTemplateColumns,
        minHeight: isMobile ? "auto" : styles.container.minHeight,
      } as CSSProperties}
    >
      <div style={{ ...styles.leftPanel, display: isMobile ? "none" : "flex" } as CSSProperties}>
        <div style={styles.logoSection as CSSProperties}>
          <div style={styles.logoPlaceholder as CSSProperties}>
            <img src={logoMainDark} alt="Logo da marca" style={styles.logoImage as CSSProperties} />
          </div>
        </div>
      </div>

      <div
        style={{
          ...styles.rightPanel,
          padding: isMobile ? "24px 14px" : styles.rightPanel.padding,
        } as CSSProperties}
      >
        <div style={styles.header as CSSProperties}>
          <h1 style={{ ...styles.title, fontSize: isMobile ? 28 : styles.title.fontSize } as CSSProperties}>
            Esqueci minha senha
          </h1>
          <p style={styles.subtitle as CSSProperties}>
            Enviaremos um link seguro para redefinir a senha da sua conta local.
          </p>
        </div>

        <form className="l4-auth-form" onSubmit={handleSubmit} style={styles.form as CSSProperties}>
          {formError ? (
            <div role="alert" style={styles.formAlert as CSSProperties}>
              <strong style={styles.formAlertTitle as CSSProperties}>{formError.message}</strong>
              {formError.details.length > 0 ? (
                <ul style={styles.formAlertList as CSSProperties}>
                  {formError.details.map(detail => (
                    <li key={detail}>{detail}</li>
                  ))}
                </ul>
              ) : null}
            </div>
          ) : null}

          {submitted ? (
            <div style={styles.successCard as CSSProperties}>
              <strong style={styles.successTitle as CSSProperties}>Confira seu e-mail</strong>
              <p style={styles.successText as CSSProperties}>
                Se existir uma conta local com este e-mail, você receberá em instantes as instruções para criar uma nova senha.
              </p>
              <p style={styles.secondaryNote as CSSProperties}>
                Se você costuma entrar com Google, a redefinição deve ser feita diretamente pelo Google.
              </p>
            </div>
          ) : (
            <>
              <div style={styles.formGroup as CSSProperties}>
                <label style={styles.label as CSSProperties} htmlFor="email">
                  Email
                </label>
                <input
                  id="email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="seu@email.com"
                  style={styles.input as CSSProperties}
                  disabled={isBusy}
                />
              </div>

              <div style={styles.supportCard as CSSProperties}>
                <div style={styles.supportCopy as CSSProperties}>
                  <span style={styles.supportTitle as CSSProperties}>Como funciona</span>
                  <span style={styles.supportText as CSSProperties}>
                    O link expira em 1 hora, só pode ser usado uma vez e invalida sessões antigas quando a senha for trocada.
                  </span>
                </div>
              </div>

              <button
                type="submit"
                style={{
                  ...styles.submitBtn,
                  opacity: isBusy ? 0.7 : 1,
                  cursor: isBusy ? "not-allowed" : "pointer",
                } as CSSProperties}
                disabled={isBusy}
              >
                {isBusy ? "Enviando..." : "Enviar link de redefinição"}
              </button>
            </>
          )}
        </form>

        <p style={styles.securityNote as CSSProperties}>
          Usamos cookies essenciais para autenticação e proteção da sessão. Consulte a
          <Link to="/privacidade" style={styles.securityLink as CSSProperties}> Política de Privacidade</Link>.
        </p>

        <div style={styles.footerNav as CSSProperties}>
          <Link to="/login" style={styles.footerLink as CSSProperties}>Voltar para login</Link>
          <Link to="/cadastro" style={styles.footerLink as CSSProperties}>Criar conta</Link>
        </div>
      </div>
    </div>
  );
}

const styles: Record<string, CSSProperties> = {
  container: {
    display: "grid",
    gridTemplateColumns: "0.9fr 1.1fr",
    minHeight: "clamp(420px, 60vh, 560px)",
    gap: 0,
    alignItems: "start",
    background: "#0a0a0a",
    border: "1px solid #1f1f1f",
  },
  leftPanel: {
    background: "transparent",
    padding: "40px 24px 0",
    display: "flex",
    flexDirection: "column",
    justifyContent: "flex-start",
    alignItems: "center",
    alignSelf: "center",
    color: "#f0ede8",
  },
  logoSection: {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    width: "100%",
    minHeight: 0,
  },
  logoPlaceholder: {
    textAlign: "center",
    width: "100%",
    maxWidth: 360,
    margin: "0 auto",
    padding: "6px 0",
    background: "transparent",
    border: "none",
    borderRadius: 0,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
  },
  logoImage: {
    width: "96%",
    maxWidth: "96%",
    height: "auto",
    objectFit: "contain",
    objectPosition: "center",
    filter: "drop-shadow(0 18px 34px rgba(232, 0, 42, 0.16))",
  },
  rightPanel: {
    padding: "60px 40px",
    display: "flex",
    flexDirection: "column",
    justifyContent: "center",
    background: "linear-gradient(180deg, #0d0d0d 0%, #080808 100%)",
  },
  header: {
    marginBottom: 40,
  },
  title: {
    fontSize: 36,
    fontWeight: 900,
    color: "#f0ede8",
    margin: 0,
    marginBottom: 12,
  },
  subtitle: {
    fontSize: 16,
    color: "#9ca3af",
    margin: 0,
    lineHeight: 1.6,
  },
  form: {
    display: "flex",
    flexDirection: "column",
    gap: 20,
    marginBottom: 24,
  },
  formAlert: {
    padding: "12px 14px",
    borderRadius: 12,
    border: "1px solid rgba(184, 95, 95, 0.34)",
    background: "rgba(70, 25, 25, 0.18)",
    color: "#f4d6d6",
  },
  formAlertTitle: {
    display: "block",
    marginBottom: 6,
    fontSize: 14,
  },
  formAlertList: {
    margin: 0,
    paddingLeft: 18,
    display: "grid",
    gap: 4,
    fontSize: 12,
    color: "#e7bebe",
  },
  formGroup: {
    display: "flex",
    flexDirection: "column",
    gap: 8,
  },
  label: {
    fontSize: 12,
    fontWeight: 700,
    color: "#f0ede8",
    textTransform: "uppercase",
    letterSpacing: "0.5px",
  },
  input: {
    padding: "12px 16px",
    border: "1px solid #2f2f2f",
    borderRadius: 8,
    fontSize: 14,
    fontFamily: "inherit",
    outline: "none",
    background: "#0f0f0f",
    color: "#f0ede8",
  },
  supportCard: {
    display: "flex",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: 16,
    padding: "14px 16px",
    borderRadius: 12,
    border: "1px solid #232323",
    background: "#111111",
  },
  supportCopy: {
    display: "grid",
    gap: 4,
  },
  supportTitle: {
    color: "#f0ede8",
    fontSize: 13,
    fontWeight: 700,
    textTransform: "uppercase",
    letterSpacing: "0.04em",
  },
  supportText: {
    color: "#9d9ca3",
    fontSize: 13,
    lineHeight: 1.55,
  },
  submitBtn: {
    padding: "14px 24px",
    background: "linear-gradient(135deg, #1a1a1a 0%, #3a3a3a 100%)",
    color: "white",
    border: "none",
    borderRadius: 8,
    fontSize: 15,
    fontWeight: 700,
    boxShadow: "0 4px 12px rgba(0,0,0,0.35)",
  },
  successCard: {
    display: "grid",
    gap: 10,
    padding: "16px 18px",
    borderRadius: 14,
    border: "1px solid rgba(107, 180, 129, 0.28)",
    background: "rgba(18, 48, 28, 0.28)",
  },
  successTitle: {
    color: "#f0ede8",
    fontSize: 15,
  },
  successText: {
    margin: 0,
    color: "#d6e8d9",
    fontSize: 14,
    lineHeight: 1.6,
  },
  secondaryNote: {
    margin: 0,
    color: "#9fb3a4",
    fontSize: 13,
    lineHeight: 1.6,
  },
  securityNote: {
    margin: "0 0 18px",
    color: "#8f8f95",
    fontSize: 13,
    lineHeight: 1.6,
    textAlign: "center",
  },
  securityLink: {
    color: "#f0ede8",
    fontWeight: 600,
    marginLeft: 4,
  },
  footerNav: {
    display: "flex",
    justifyContent: "center",
    gap: 20,
    paddingTop: 24,
    borderTop: "1px solid #27272a",
    flexWrap: "wrap",
  },
  footerLink: {
    color: "#f0ede8",
    fontSize: 14,
    fontWeight: 700,
  },
};
