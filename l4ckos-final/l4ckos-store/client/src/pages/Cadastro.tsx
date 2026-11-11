/**
 * Página de cadastro.
 
 */

import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useToast } from "../contexts/ToastContext";
import type { CSSProperties } from "react";
import { getLoginUrl } from "../const";
import { useIsMobile } from "../hooks/useIsMobile";
import { trpc } from "../lib/trpc";
import logoMainDark from "../images/l4ckos-main-dark-transparent.png";
import { getPasswordPolicyDetails } from "../../../shared/passwordPolicy";
import PasswordChecklist from "../components/auth/PasswordChecklist";
import { getApiErrorDisplay } from "../utils/apiError";
import { useUser } from "../contexts/UserContext";

function isValidEmail(email: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email);
}

export default function Cadastro() {
  const isMobile = useIsMobile();
  const navigate = useNavigate();
  const { showToast } = useToast();
  const { isAuthenticated, isLoading } = useUser();
  const utils = trpc.useUtils();
  const localSignupMutation = trpc.auth.localSignup.useMutation();

  const [formData, setFormData] = useState({
    firstName: "",
    lastName: "",
    email: "",
    password: "",
    confirmPassword: "",
  });
  const [showPassword, setShowPassword] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [acceptedTerms, setAcceptedTerms] = useState(false);
  const [formError, setFormError] = useState<{ code?: string; message: string; details: string[] } | null>(null);
  const showTopAlert = Boolean(formError && formError.code !== "WEAK_PASSWORD" && formError.code !== "PASSWORD_MISMATCH");

  useEffect(() => {
    if (!isLoading && isAuthenticated) {
      navigate("/", { replace: true });
    }
  }, [isAuthenticated, isLoading, navigate]);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    setFormData((prev) => ({
      ...prev,
      [name]: value,
    }));
    if (name === "password" || name === "confirmPassword") {
      setFormError(null);
    }
  };

  const handleSignUp = async (e: React.FormEvent) => {
    e.preventDefault();
    const normalizedEmail = formData.email.trim().toLowerCase();

    // Validações
    if (
      !formData.firstName ||
      !normalizedEmail ||
      !formData.password ||
      !formData.confirmPassword
    ) {
      setFormError(null);
      showToast({
        message: "Por favor, preencha todos os campos obrigatórios",
        duration: 3000,
      });
      return;
    }

    if (!isValidEmail(normalizedEmail)) {
      setFormError(null);
      showToast({
        message: "Informe um e-mail válido",
        duration: 3000,
      });
      return;
    }

    if (formData.password !== formData.confirmPassword) {
      setFormError({
        code: "PASSWORD_MISMATCH",
        message: "As senhas precisam ser iguais para concluir o cadastro.",
        details: ["Confirme a senha exatamente como foi digitada acima."],
      });
      showToast({
        message: "As senhas não coincidem",
        duration: 3000,
      });
      return;
    }

    const passwordDetails = getPasswordPolicyDetails(formData.password);
    if (passwordDetails.length > 0) {
      setFormError({
        code: "WEAK_PASSWORD",
        message: "A senha não atende aos requisitos de segurança.",
        details: passwordDetails,
      });
      showToast({
        message: "Revise os requisitos da senha antes de continuar.",
        duration: 3000,
      });
      return;
    }

    if (!acceptedTerms) {
      showToast({
        message: "Você precisa aceitar os Termos e a Política de Privacidade para criar a conta.",
        duration: 3000,
      });
      return;
    }

    setIsSubmitting(true);
    setFormError(null);
    try {
      await localSignupMutation.mutateAsync({
        name: `${formData.firstName} ${formData.lastName}`.trim() || formData.firstName,
        email: normalizedEmail,
        password: formData.password,
      });
      await utils.auth.me.invalidate();

      showToast({
        message: "Cadastro realizado com sucesso!",
        duration: 3000,
      });
      navigate("/");
    } catch (err) {
      const parsed = getApiErrorDisplay(err, "Não foi possível criar sua conta agora.");
      setFormError({ code: parsed.code, message: parsed.message, details: parsed.details });
      showToast({
        message: parsed.message,
        duration: 3000,
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleGoogleSignUp = () => {
    const loginUrl = getLoginUrl();
    if (!loginUrl) {
      showToast({
        message: "Não foi possível iniciar cadastro com Google",
        duration: 3000,
      });
      return;
    }

    window.location.href = loginUrl;
  };

  return (
    <div
      style={{
        ...styles.container,
        gridTemplateColumns: isMobile ? "1fr" : styles.container.gridTemplateColumns,
        minHeight: isMobile ? "auto" : styles.container.minHeight,
      } as CSSProperties}
    >
      {/* Lado esquerdo */}
      <div style={{ ...styles.leftPanel, display: isMobile ? "none" : "flex" } as CSSProperties}>
        <div style={styles.logoSection as CSSProperties}>
          <div style={styles.logoPlaceholder as CSSProperties}>
            <img src={logoMainDark} alt="Logo da marca" style={styles.logoImage as CSSProperties} />
          </div>
        </div>
      </div>

      {/* Lado direito */}
      <div
        style={{
          ...styles.rightPanel,
          padding: isMobile ? "24px 14px" : styles.rightPanel.padding,
        } as CSSProperties}
      >
        {/* Header */}
        <div style={styles.header as CSSProperties}>
          <h1 style={{ ...styles.title, fontSize: isMobile ? 28 : styles.title.fontSize } as CSSProperties}>Criar Conta</h1>
          <p style={styles.subtitle as CSSProperties}>
            Crie sua conta para comprar com mais agilidade e acompanhar seus pedidos.
          </p>
        </div>

        {/* Formulário de cadastro */}
        <form className="l4-auth-form" onSubmit={handleSignUp} style={styles.form as CSSProperties}>
          {showTopAlert && formError ? (
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
          <div
            style={{
              ...styles.nameRow,
              gridTemplateColumns: isMobile ? "1fr" : styles.nameRow.gridTemplateColumns,
            } as CSSProperties}
          >
            <div style={styles.formGroup as CSSProperties}>
              <label style={styles.label as CSSProperties} htmlFor="firstName">
                Primeiro Nome *
              </label>
              <input
                id="firstName"
                type="text"
                name="firstName"
                value={formData.firstName}
                onChange={handleChange}
                placeholder="João"
                style={styles.input as CSSProperties}
                disabled={isSubmitting || localSignupMutation.isPending}
              />
            </div>

            <div style={styles.formGroup as CSSProperties}>
              <label style={styles.label as CSSProperties} htmlFor="lastName">
                Sobrenome
              </label>
              <input
                id="lastName"
                type="text"
                name="lastName"
                value={formData.lastName}
                onChange={handleChange}
                placeholder="da Silva"
                style={styles.input as CSSProperties}
                disabled={isSubmitting || localSignupMutation.isPending}
              />
            </div>
          </div>

          <div style={styles.formGroup as CSSProperties}>
            <label style={styles.label as CSSProperties} htmlFor="email">
              Email *
            </label>
            <input
              id="email"
              type="email"
              name="email"
              value={formData.email}
              onChange={handleChange}
              placeholder="seu@email.com"
              style={styles.input as CSSProperties}
              disabled={isSubmitting || localSignupMutation.isPending}
            />
            {formError?.code === "PASSWORD_MISMATCH" ? (
              <p style={styles.inlineHintError as CSSProperties}>A confirmação precisa ser igual à senha informada.</p>
            ) : null}
          </div>

          <div style={styles.formGroup as CSSProperties}>
            <label style={styles.label as CSSProperties} htmlFor="password">
              Senha *
            </label>
            <input
              id="password"
              type={showPassword ? "text" : "password"}
              name="password"
              value={formData.password}
              onChange={handleChange}
              placeholder="Crie uma senha forte"
              style={styles.input as CSSProperties}
              disabled={isSubmitting || localSignupMutation.isPending}
            />
            <PasswordChecklist password={formData.password} />
          </div>

          <div style={styles.formGroup as CSSProperties}>
            <label
              style={styles.label as CSSProperties}
              htmlFor="confirmPassword"
            >
              Confirmar Senha *
            </label>
            <input
              id="confirmPassword"
              type={showPassword ? "text" : "password"}
              name="confirmPassword"
              value={formData.confirmPassword}
              onChange={handleChange}
              placeholder="Confirme sua senha"
              style={styles.input as CSSProperties}
              disabled={isSubmitting || localSignupMutation.isPending}
            />
            <label style={styles.checkboxLabel as CSSProperties}>
              <input
                type="checkbox"
                checked={showPassword}
                onChange={(event) => setShowPassword(event.target.checked)}
                style={styles.checkboxInput as CSSProperties}
                disabled={isSubmitting || localSignupMutation.isPending}
              />
              Mostrar senha e confirmação
            </label>
          </div>

          {/* Termos */}
          <div style={styles.termsBox as CSSProperties}>
            <input
              type="checkbox"
              checked={acceptedTerms}
              onChange={(event) => setAcceptedTerms(event.target.checked)}
            />
            <label style={styles.termsLabel as CSSProperties}>
              Concordo com os{" "}
              <Link to="/termos" style={{color: "#1a1a1a", textDecoration: "underline"}}>
                Termos de Serviço
              </Link>{" "}
              e{" "}
              <Link to="/privacidade" style={{color: "#1a1a1a", textDecoration: "underline"}}>
                Política de Privacidade
              </Link>
            </label>
          </div>

          {/* Botão de cadastro */}
          <button
            type="submit"
            style={{
              ...styles.submitBtn,
              opacity: isSubmitting ? 0.7 : 1,
              cursor: isSubmitting ? "not-allowed" : "pointer",
            } as CSSProperties}
            disabled={isSubmitting}
            onMouseEnter={(e) => {
              if (!isSubmitting) {
                const btn = e.currentTarget as HTMLElement;
                btn.style.transform = "translateY(-2px)";
                btn.style.boxShadow = "0 12px 24px rgba(26,26,26,0.3)";
              }
            }}
            onMouseLeave={(e) => {
              const btn = e.currentTarget as HTMLElement;
              btn.style.transform = "translateY(0)";
              btn.style.boxShadow = "0 4px 12px rgba(26,26,26,0.2)";
            }}
          >
            {isSubmitting ? "Criando conta..." : "Criar Conta"}
          </button>
        </form>

        {/* Divisor */}
        <div style={styles.divider as CSSProperties}>
          <span style={styles.dividerText as CSSProperties}>OU</span>
        </div>

        {/* Sign Up com Google */}
        <button
          type="button"
          onClick={handleGoogleSignUp}
          style={styles.googleBtn as CSSProperties}
          disabled={isSubmitting}
          onMouseEnter={(e) => {
            if (!isSubmitting) {
              const btn = e.currentTarget as HTMLElement;
              btn.style.background = "#171717";
            }
          }}
          onMouseLeave={(e) => {
            const btn = e.currentTarget as HTMLElement;
            btn.style.background = "#0f0f0f";
          }}
        >
          <svg width="20" height="20" viewBox="0 0 24 24" style={{marginRight: 12}}>
            <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"></path>
            <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"></path>
            <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"></path>
            <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"></path>
          </svg>
          Cadastrar com Google
        </button>

        {/* Link para login */}
        <p style={styles.securityNote as CSSProperties}>
          Ao criar sua conta, usamos cookies seguros e necessários para autenticação, continuidade da sessão e proteção da área do cliente.
          Consulte a <Link to="/privacidade" style={styles.securityLink as CSSProperties}>Política de Privacidade</Link>.
        </p>
        <div style={styles.loginSection as CSSProperties}>
          <p style={styles.loginText as CSSProperties}>
            Já tem conta?{" "}
            <a
              href="#"
              style={styles.loginLink as CSSProperties}
              onClick={(e) => {
                e.preventDefault();
                navigate("/login");
              }}
            >
              Fazer login
            </a>
          </p>
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
    color: "rgba(240, 237, 232, 0.7)",
    fontSize: 14,
    fontWeight: 500,
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
  logo: {
    fontSize: 64,
    fontWeight: 900,
    color: "white",
    marginBottom: 12,
    letterSpacing: "-2px",
  },
  logoSubtitle: {
    fontSize: 14,
    color: "rgba(255,255,255,0.7)",
    fontWeight: 600,
    textTransform: "uppercase",
    letterSpacing: "1px",
  },
  benefitsColumn: {
    flex: 1,
  },
  benefitsTitle: {
    fontSize: 20,
    fontWeight: 700,
    color: "#1a1a1a",
    marginBottom: 24,
    margin: 0,
  },
  benefits: {
    display: "flex",
    flexDirection: "column",
    gap: 16,
  },
  benefitItem: {
    display: "flex",
    alignItems: "center",
    gap: 12,
    fontSize: 14,
    color: "#333333",
    fontWeight: 500,
  },
  benefitIcon: {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    width: 28,
    height: 28,
    background: "rgba(255,255,255,0.2)",
    borderRadius: "50%",
    fontWeight: 700,
    fontSize: 14,
    flexShrink: 0,
  },
  rightPanel: {
    padding: "60px 40px",
    display: "flex",
    flexDirection: "column",
    justifyContent: "center",
    background: "linear-gradient(180deg, #0d0d0d 0%, #080808 100%)",
    overflowY: "auto",
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
  nameRow: {
    display: "grid",
    gridTemplateColumns: "1fr 1fr",
    gap: 12,
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
    transition: "all 0.3s ease",
    outline: "none",
    background: "#0f0f0f",
    color: "#f0ede8",
  },
  termsBox: {
    display: "flex",
    alignItems: "flex-start",
    gap: 12,
    padding: 14,
    background: "#111111",
    border: "1px solid #232323",
    borderRadius: 10,
    fontSize: 13,
  },
  termsLabel: {
    color: "#a1a1aa",
    lineHeight: 1.5,
    cursor: "pointer",
  },
  inlineHintError: {
    margin: "6px 0 0",
    color: "#f0b7b7",
    fontSize: 12,
    lineHeight: 1.4,
  },
  checkboxLabel: {
    display: "inline-flex",
    alignItems: "center",
    gap: 8,
    marginTop: 2,
    color: "#b4b4bb",
    fontSize: 13,
    lineHeight: 1.4,
    cursor: "pointer",
  },
  checkboxInput: {
    margin: 0,
    accentColor: "#f0ede8",
  },
  submitBtn: {
    padding: "14px 24px",
    background: "linear-gradient(135deg, #1a1a1a 0%, #3a3a3a 100%)",
    color: "white",
    border: "none",
    borderRadius: 8,
    fontSize: 15,
    fontWeight: 700,
    cursor: "pointer",
    transition: "all 0.3s ease",
    boxShadow: "0 4px 12px rgba(0,0,0,0.35)",
  },
  divider: {
    display: "flex",
    alignItems: "center",
    gap: 16,
    margin: "20px 0",
  },
  dividerText: {
    color: "#71717a",
    fontSize: 13,
    fontWeight: 600,
    textTransform: "uppercase",
  },
  googleBtn: {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    padding: "12px 24px",
    background: "#0f0f0f",
    color: "#f0ede8",
    border: "1px solid #2f2f2f",
    borderRadius: 8,
    fontSize: 14,
    fontWeight: 700,
    cursor: "pointer",
    transition: "all 0.3s ease",
    marginBottom: 16,
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
  loginSection: {
    textAlign: "center",
    paddingTop: 24,
    borderTop: "1px solid #27272a",
  },
  loginText: {
    fontSize: 14,
    color: "#a1a1aa",
    margin: 0,
  },
  loginLink: {
    color: "#f0ede8",
    fontWeight: 700,
    marginLeft: 8,
    transition: "color 0.2s ease",
  },
};



