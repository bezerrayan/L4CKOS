import { useEffect, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { useToast } from "../contexts/ToastContext";
import { getLoginUrl } from "../const";
import { trpc } from "../lib/trpc";
import { getApiErrorDisplay } from "../utils/apiError";
import { useUser } from "../contexts/UserContext";
import { AuthFormError, AuthLayout } from "../components/auth/AuthLayout";

function isValidEmail(email: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email);
}

export default function Login() {
  const navigate = useNavigate();
  const location = useLocation();
  const { showToast } = useToast();
  const { isAuthenticated, isLoading } = useUser();
  const utils = trpc.useUtils();
  const localLoginMutation = trpc.auth.localLogin.useMutation();
  const nextPath = new URLSearchParams(location.search).get("next");
  const safeNextPath = nextPath && nextPath.startsWith("/") && !nextPath.startsWith("//") ? nextPath : "/";
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [formError, setFormError] = useState<{ message: string; details: string[] } | null>(null);
  const isBusy = isSubmitting || localLoginMutation.isPending;

  useEffect(() => {
    if (!isLoading && isAuthenticated) navigate(safeNextPath, { replace: true });
  }, [isAuthenticated, isLoading, navigate, safeNextPath]);

  const handleEmailLogin = async (event: React.FormEvent) => {
    event.preventDefault();
    const normalizedEmail = email.trim().toLowerCase();
    if (!normalizedEmail || !password) {
      setFormError(null);
      showToast({ message: "Por favor, preencha todos os campos", duration: 3000 });
      return;
    }
    if (!isValidEmail(normalizedEmail)) {
      setFormError(null);
      showToast({ message: "Informe um e-mail válido", duration: 3000 });
      return;
    }
    setIsSubmitting(true);
    setFormError(null);
    try {
      await localLoginMutation.mutateAsync({ email: normalizedEmail, password });
      await utils.auth.me.invalidate();
      showToast({ message: "Login realizado com sucesso!", duration: 3000 });
      navigate(safeNextPath);
    } catch (error) {
      const parsed = getApiErrorDisplay(error, "Não foi possível fazer login. Verifique suas credenciais.");
      setFormError({ message: parsed.message, details: parsed.details });
      showToast({ message: parsed.message, duration: 3000 });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleGoogleLogin = () => {
    const loginUrl = getLoginUrl(safeNextPath);
    if (!loginUrl) {
      showToast({ message: "Não foi possível iniciar login com Google", duration: 3000 });
      return;
    }
    window.location.href = loginUrl;
  };

  return (
    <AuthLayout title="Bem-vindo" description="Acesse sua conta para acompanhar pedidos e finalizar compras com mais agilidade.">
      <form className="l4-auth-form" onSubmit={handleEmailLogin}>
        {formError ? <AuthFormError {...formError} /> : null}
        <label className="l4-auth-field" htmlFor="email">
          E-mail
          <input id="email" type="email" autoComplete="username" value={email} onChange={event => setEmail(event.target.value)} placeholder="seu@email.com" disabled={isBusy} />
        </label>
        <label className="l4-auth-field" htmlFor="password">
          Senha
          <input id="password" type={showPassword ? "text" : "password"} autoComplete="current-password" value={password} onChange={event => setPassword(event.target.value)} placeholder="Digite sua senha" disabled={isBusy} />
        </label>
        <label className="l4-auth-toggle">
          <input type="checkbox" checked={showPassword} onChange={event => setShowPassword(event.target.checked)} disabled={isBusy} />
          Mostrar senha
        </label>
        <div className="l4-auth-note">
          <strong>Sessão protegida</strong>
          <span>Cookies essenciais mantêm sua conta autenticada e protegem o acesso. <Link className="l4-auth-inline-link" to="/esqueci-senha">Recuperar senha</Link></span>
        </div>
        <button className="l4-auth-primary" type="submit" disabled={isBusy}>{isBusy ? "Entrando…" : "Entrar"}</button>
      </form>

      <div className="l4-auth-divider" aria-hidden="true">OU</div>
      <button className="l4-auth-secondary" type="button" onClick={handleGoogleLogin} disabled={isBusy}>
        <GoogleMark />
        Continuar com Google
      </button>
      <p className="l4-auth-policy">Ao continuar, você concorda com o uso de cookies essenciais de autenticação. Saiba mais na <Link to="/privacidade">Política de Privacidade</Link>.</p>
      <p className="l4-auth-footer">Não tem conta? <Link to="/cadastro">Criar conta</Link></p>
    </AuthLayout>
  );
}

function GoogleMark() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
      <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
      <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18A11 11 0 0 0 1 12c0 1.77.43 3.44 1.18 4.92l3.66-2.83z" />
      <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
    </svg>
  );
}
