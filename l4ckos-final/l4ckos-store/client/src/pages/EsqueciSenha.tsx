import { useState } from "react";
import { Link } from "react-router-dom";
import { trpc } from "../lib/trpc";
import { useToast } from "../contexts/ToastContext";
import { getApiErrorDisplay } from "../utils/apiError";
import { AuthFormError, AuthLayout } from "../components/auth/AuthLayout";

function isValidEmail(email: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email);
}

export default function EsqueciSenha() {
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
    <AuthLayout title="Recuperar acesso" description="Enviaremos um link seguro para redefinir a senha da sua conta local.">
      {submitted ? (
        <section className="l4-auth-success" role="status" aria-live="polite">
          <strong>Confira seu e-mail</strong>
          <p>Se existir uma conta local com este e-mail, você receberá em instantes as instruções para criar uma nova senha.</p>
          <p>Se você costuma entrar com Google, a redefinição deve ser feita diretamente pelo Google.</p>
        </section>
      ) : (
        <form className="l4-auth-form" onSubmit={handleSubmit}>
          {formError ? <AuthFormError {...formError} /> : null}
          <label className="l4-auth-field" htmlFor="email">E-mail<input id="email" type="email" autoComplete="email" value={email} onChange={event => setEmail(event.target.value)} placeholder="seu@email.com" disabled={isBusy} /></label>
          <p className="l4-auth-note"><strong>Como funciona</strong><span>O link expira em 1 hora, só pode ser usado uma vez e invalida sessões antigas quando a senha for trocada.</span></p>
          <button className="l4-auth-primary" type="submit" disabled={isBusy}>{isBusy ? "Enviando…" : "Enviar link de redefinição"}</button>
        </form>
      )}
      <p className="l4-auth-policy">Usamos cookies essenciais para autenticação e proteção da sessão. Consulte a <Link to="/privacidade">Política de Privacidade</Link>.</p>
      <nav className="l4-auth-footlinks" aria-label="Outras opções de conta"><Link to="/entrar">Voltar para login</Link><Link to="/cadastro">Criar conta</Link></nav>
    </AuthLayout>
  );
}
