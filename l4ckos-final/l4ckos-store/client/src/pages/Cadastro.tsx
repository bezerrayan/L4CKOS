import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useToast } from "../contexts/ToastContext";
import { getLoginUrl } from "../const";
import { trpc } from "../lib/trpc";
import { getPasswordPolicyDetails } from "../../../shared/passwordPolicy";
import PasswordChecklist from "../components/auth/PasswordChecklist";
import { getApiErrorDisplay } from "../utils/apiError";
import { useUser } from "../contexts/UserContext";
import { AuthFormError, AuthLayout } from "../components/auth/AuthLayout";

function isValidEmail(email: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email);
}

export default function Cadastro() {
  const navigate = useNavigate();
  const { showToast } = useToast();
  const { isAuthenticated, isLoading } = useUser();
  const utils = trpc.useUtils();
  const localSignupMutation = trpc.auth.localSignup.useMutation();
  const [formData, setFormData] = useState({ firstName: "", lastName: "", email: "", password: "", confirmPassword: "" });
  const [showPassword, setShowPassword] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [acceptedTerms, setAcceptedTerms] = useState(false);
  const [formError, setFormError] = useState<{ code?: string; message: string; details: string[] } | null>(null);
  const showTopAlert = Boolean(formError && formError.code !== "WEAK_PASSWORD" && formError.code !== "PASSWORD_MISMATCH");

  useEffect(() => {
    if (!isLoading && isAuthenticated) navigate("/", { replace: true });
  }, [isAuthenticated, isLoading, navigate]);

  const handleChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = event.target;
    setFormData(current => ({ ...current, [name]: value }));
    if (name === "password" || name === "confirmPassword") setFormError(null);
  };

  const handleSignUp = async (event: React.FormEvent) => {
    event.preventDefault();
    const normalizedEmail = formData.email.trim().toLowerCase();
    if (!formData.firstName || !normalizedEmail || !formData.password || !formData.confirmPassword) {
      setFormError(null);
      showToast({ message: "Por favor, preencha todos os campos obrigatórios", duration: 3000 });
      return;
    }
    if (!isValidEmail(normalizedEmail)) {
      setFormError(null);
      showToast({ message: "Informe um e-mail válido", duration: 3000 });
      return;
    }
    if (formData.password !== formData.confirmPassword) {
      setFormError({ code: "PASSWORD_MISMATCH", message: "As senhas precisam ser iguais para concluir o cadastro.", details: ["Confirme a senha exatamente como foi digitada acima."] });
      showToast({ message: "As senhas não coincidem", duration: 3000 });
      return;
    }
    const passwordDetails = getPasswordPolicyDetails(formData.password);
    if (passwordDetails.length > 0) {
      setFormError({ code: "WEAK_PASSWORD", message: "A senha não atende aos requisitos de segurança.", details: passwordDetails });
      showToast({ message: "Revise os requisitos da senha antes de continuar.", duration: 3000 });
      return;
    }
    if (!acceptedTerms) {
      showToast({ message: "Você precisa aceitar os Termos e a Política de Privacidade para criar a conta.", duration: 3000 });
      return;
    }
    setIsSubmitting(true);
    setFormError(null);
    try {
      await localSignupMutation.mutateAsync({ name: `${formData.firstName} ${formData.lastName}`.trim() || formData.firstName, email: normalizedEmail, password: formData.password });
      await utils.auth.me.invalidate();
      showToast({ message: "Cadastro realizado com sucesso!", duration: 3000 });
      navigate("/");
    } catch (error) {
      const parsed = getApiErrorDisplay(error, "Não foi possível criar sua conta agora.");
      setFormError({ code: parsed.code, message: parsed.message, details: parsed.details });
      showToast({ message: parsed.message, duration: 3000 });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleGoogleSignUp = () => {
    const loginUrl = getLoginUrl();
    if (!loginUrl) {
      showToast({ message: "Não foi possível iniciar cadastro com Google", duration: 3000 });
      return;
    }
    window.location.href = loginUrl;
  };
  const isBusy = isSubmitting || localSignupMutation.isPending;

  return (
    <AuthLayout title="Criar sua conta" description="Crie seu acesso para comprar com agilidade e acompanhar seus pedidos.">
      <form className="l4-auth-form" onSubmit={handleSignUp}>
        {showTopAlert && formError ? <AuthFormError message={formError.message} details={formError.details} /> : null}
        <div className="l4-auth-name-grid">
          <label className="l4-auth-field" htmlFor="firstName">Primeiro nome *<input id="firstName" name="firstName" autoComplete="given-name" value={formData.firstName} onChange={handleChange} placeholder="João" disabled={isBusy} /></label>
          <label className="l4-auth-field" htmlFor="lastName">Sobrenome<input id="lastName" name="lastName" autoComplete="family-name" value={formData.lastName} onChange={handleChange} placeholder="da Silva" disabled={isBusy} /></label>
        </div>
        <label className="l4-auth-field" htmlFor="email">E-mail *<input id="email" name="email" type="email" autoComplete="email" value={formData.email} onChange={handleChange} placeholder="seu@email.com" disabled={isBusy} />{formError?.code === "PASSWORD_MISMATCH" ? <span role="status">A confirmação precisa ser igual à senha informada.</span> : null}</label>
        <label className="l4-auth-field" htmlFor="password">Senha *<input id="password" name="password" type={showPassword ? "text" : "password"} autoComplete="new-password" value={formData.password} onChange={handleChange} placeholder="Crie uma senha forte" disabled={isBusy} /><PasswordChecklist password={formData.password} /></label>
        <label className="l4-auth-field" htmlFor="confirmPassword">Confirmar senha *<input id="confirmPassword" name="confirmPassword" type={showPassword ? "text" : "password"} autoComplete="new-password" value={formData.confirmPassword} onChange={handleChange} placeholder="Confirme sua senha" disabled={isBusy} /></label>
        {formError && (formError.code === "PASSWORD_MISMATCH" || formError.code === "WEAK_PASSWORD") ? <AuthFormError message={formError.message} details={formError.details} /> : null}
        <label className="l4-auth-toggle"><input type="checkbox" checked={showPassword} onChange={event => setShowPassword(event.target.checked)} disabled={isBusy} />Mostrar senha e confirmação</label>
        <label className="l4-auth-terms"><input type="checkbox" checked={acceptedTerms} onChange={event => setAcceptedTerms(event.target.checked)} disabled={isBusy} /><span>Concordo com os <Link to="/termos">Termos de Serviço</Link> e a <Link to="/privacidade">Política de Privacidade</Link>.</span></label>
        <button className="l4-auth-primary" type="submit" disabled={isBusy}>{isBusy ? "Criando conta…" : "Criar conta"}</button>
      </form>
      <div className="l4-auth-divider" aria-hidden="true">OU</div>
      <button className="l4-auth-secondary" type="button" onClick={handleGoogleSignUp} disabled={isBusy}><GoogleMark />Cadastrar com Google</button>
      <p className="l4-auth-policy">Cookies essenciais protegem a autenticação e mantêm sua sessão. Consulte a <Link to="/privacidade">Política de Privacidade</Link>.</p>
      <p className="l4-auth-footer">Já tem conta? <Link to="/entrar">Fazer login</Link></p>
    </AuthLayout>
  );
}

function GoogleMark() {
  return <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/><path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/><path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18A11 11 0 0 0 1 12c0 1.77.43 3.44 1.18 4.92l3.66-2.83z"/><path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/></svg>;
}
