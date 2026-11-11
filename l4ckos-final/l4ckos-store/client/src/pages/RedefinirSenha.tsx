import { useMemo, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { trpc } from "../lib/trpc";
import { useToast } from "../contexts/ToastContext";
import PasswordChecklist from "../components/auth/PasswordChecklist";
import { getPasswordPolicyDetails } from "../../../shared/passwordPolicy";
import { getApiErrorDisplay } from "../utils/apiError";
import { AuthFormError, AuthLayout } from "../components/auth/AuthLayout";

export default function RedefinirSenha() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { showToast } = useToast();
  const resetPasswordMutation = trpc.auth.resetPassword.useMutation();
  const token = useMemo(() => searchParams.get("token")?.trim() || "", [searchParams]);
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [formError, setFormError] = useState<{ message: string; details: string[] } | null>(null);
  const [completed, setCompleted] = useState(false);
  const isBusy = resetPasswordMutation.isPending;

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!token) {
      setFormError({ message: "O link de redefinição é inválido ou incompleto.", details: ["Solicite um novo e-mail para continuar."] });
      return;
    }
    if (password !== confirmPassword) {
      setFormError({ message: "As senhas precisam ser iguais para continuar.", details: ["Confirme a nova senha exatamente como foi digitada acima."] });
      return;
    }
    const passwordDetails = getPasswordPolicyDetails(password);
    if (passwordDetails.length > 0) {
      setFormError({ message: "A nova senha não atende aos requisitos de segurança.", details: passwordDetails });
      return;
    }
    setFormError(null);
    try {
      const response = await resetPasswordMutation.mutateAsync({ token, password });
      setCompleted(true);
      showToast({ message: response.message, duration: 4000 });
      window.setTimeout(() => navigate("/login"), 1800);
    } catch (error) {
      const parsed = getApiErrorDisplay(error, "Não foi possível redefinir sua senha agora.");
      setFormError({ message: parsed.message, details: parsed.details });
      showToast({ message: parsed.message, duration: 3000 });
    }
  };

  return (
    <AuthLayout title="Criar nova senha" description="Defina uma nova senha forte para recuperar o acesso à sua conta.">
      {formError ? <AuthFormError {...formError} /> : null}
      {completed ? (
        <section className="l4-auth-success" role="status" aria-live="polite">
          <strong>Senha atualizada</strong>
          <p>Sua senha foi redefinida com sucesso. Você será redirecionado para o login em instantes.</p>
        </section>
      ) : (
        <form className="l4-auth-form" onSubmit={handleSubmit}>
          <label className="l4-auth-field" htmlFor="password">Nova senha<input id="password" type={showPassword ? "text" : "password"} autoComplete="new-password" value={password} onChange={event => setPassword(event.target.value)} placeholder="Crie uma senha forte" disabled={isBusy} /><PasswordChecklist password={password} /></label>
          <label className="l4-auth-field" htmlFor="confirmPassword">Confirmar nova senha<input id="confirmPassword" type={showPassword ? "text" : "password"} autoComplete="new-password" value={confirmPassword} onChange={event => setConfirmPassword(event.target.value)} placeholder="Repita a nova senha" disabled={isBusy} /></label>
          <label className="l4-auth-toggle"><input type="checkbox" checked={showPassword} onChange={event => setShowPassword(event.target.checked)} disabled={isBusy} />Mostrar nova senha</label>
          <button className="l4-auth-primary" type="submit" disabled={isBusy}>{isBusy ? "Redefinindo…" : "Salvar nova senha"}</button>
        </form>
      )}
      <p className="l4-auth-policy">Por segurança, este link é temporário e o acesso antigo é invalidado quando a senha muda.</p>
      <nav className="l4-auth-footlinks" aria-label="Outras opções de conta"><Link to="/entrar">Voltar para login</Link><Link to="/esqueci-senha">Solicitar novo link</Link></nav>
    </AuthLayout>
  );
}
