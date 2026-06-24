import { useState } from "react";
import { apiUrl } from "../../const";
import { csrfFetch } from "../../lib/csrf";

function isValidEmail(email: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email);
}

export default function EmailCapture() {
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [feedback, setFeedback] = useState("");

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setFeedback("");

    const normalizedEmail = email.trim().toLowerCase();
    if (!isValidEmail(normalizedEmail)) {
      setFeedback("Digite um e-mail válido.");
      return;
    }

    try {
      setLoading(true);
      const response = await csrfFetch(apiUrl("/api/waitlist"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: normalizedEmail }),
      });

      const data = (await response.json()) as { message?: string };
      if (!response.ok) {
        throw new Error(data.message || "Não foi possível enviar seu e-mail agora.");
      }

      setFeedback(data.message || "Você será avisado do lançamento.");
      setEmail("");
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Não foi possível enviar seu e-mail agora.";
      setFeedback(message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="w-full max-w-xl space-y-3">
      <input
        type="email"
        value={email}
        onChange={event => setEmail(event.target.value)}
        placeholder="Digite seu email para receber acesso antecipado"
        className="h-12 w-full rounded-lg border border-white/40 bg-transparent px-4 text-white outline-none focus:border-red-500"
      />
      <button
        type="submit"
        disabled={loading}
        className="h-12 w-full rounded-lg border border-white bg-black font-semibold uppercase tracking-wide text-white transition hover:border-red-500 hover:shadow-[0_0_20px_rgba(255,0,0,0.4)] disabled:opacity-70"
      >
        {loading ? "Enviando..." : "Quero ser avisado"}
      </button>
      {feedback ? <p className="text-sm text-zinc-200">{feedback}</p> : null}
    </form>
  );
}
