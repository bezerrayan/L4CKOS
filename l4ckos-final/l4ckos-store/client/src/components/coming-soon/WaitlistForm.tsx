import { useState } from "react";
import { contactChannels } from "../../config/site";
import { apiUrl } from "../../const";
import { csrfFetch } from "../../lib/csrf";

function isValidEmail(email: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email);
}

export default function WaitlistForm() {
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

      const data = (await response.json().catch(() => null)) as { message?: string } | null;
      if (!response.ok) {
        throw new Error(data?.message || "Não foi possível entrar na lista agora.");
      }

      setFeedback(data?.message || "Você entrou na lista VIP.");
      setEmail("");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Não foi possível entrar na lista agora.";
      setFeedback(message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <section>
      <div className="space-y-4 text-zinc-800">
        <p className="text-center font-sans text-[1.05rem] font-semibold uppercase tracking-[0.16em] text-zinc-800 sm:text-[1.25rem]">Acesso antecipado</p>

        <form onSubmit={handleSubmit} className="space-y-3.5">
          <input
            type="email"
            value={email}
            onChange={event => setEmail(event.target.value)}
            placeholder="Digite seu email"
            className="h-12 w-full rounded-xl border border-zinc-300 bg-white/72 px-4 text-center font-sans text-[1.05rem] text-zinc-800 outline-none transition placeholder:text-zinc-500 focus:border-zinc-500 focus:ring-2 focus:ring-zinc-400/20 sm:h-14 sm:text-[2rem]"
          />

          <button
            type="submit"
            disabled={loading}
            className="coming-cta-pulse h-12 w-full rounded-xl bg-[linear-gradient(135deg,#1a1a1a_0%,#2f2f33_100%)] px-4 font-sans text-sm font-semibold uppercase tracking-[0.11em] text-white shadow-[0_12px_20px_rgba(0,0,0,0.2)] transition duration-200 hover:-translate-y-0.5 hover:brightness-110 disabled:translate-y-0 disabled:opacity-70 sm:h-14 sm:text-[1.05rem]"
          >
            {loading ? "Enviando..." : "Quero acesso antecipado"}
          </button>
        </form>

        {feedback ? <p className="text-center font-sans text-sm text-zinc-700 sm:text-base">{feedback}</p> : null}

        <p className="text-center font-sans text-sm text-zinc-600 sm:text-[15px]">+1200 pessoas aguardando o lançamento</p>

        <a
          href={contactChannels.instagramUrl}
          target="_blank"
          rel="noreferrer"
          className="inline-flex h-10 w-full items-center justify-center rounded-xl font-sans text-sm font-medium text-zinc-700 transition hover:bg-zinc-100/45 hover:text-zinc-900"
        >
          Seguir novidades
        </a>
      </div>
    </section>
  );
}
