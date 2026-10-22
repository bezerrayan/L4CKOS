/**
 * Página Contato - Formulário para contatar a loja
 */

import { useState, useEffect } from "react";
import { useSearchParams } from "react-router-dom";
import { useToast } from "../contexts/ToastContext";
import { apiUrl } from "../const";
import { contactChannels } from "../config/site";
import { csrfFetch } from "../lib/csrf";
import { getApiErrorDisplay } from "../utils/apiError";
import "./Contato.css";

const whatsappMessage = "Olá! Vim pelo site da L4CKOS e gostaria de falar com a equipe.";
const officialWhatsAppUrl = `https://wa.me/5561984716602?text=${encodeURIComponent(whatsappMessage)}`;

function isValidEmail(email: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email);
}

const allowedSubjects = [
  "produto",
  "pedido_pagamento",
  "entrega_rastreamento",
  "troca_devolucao",
  "privacidade",
  "parcerias",
  "outro",
] as const;

type ContactSubject = typeof allowedSubjects[number];

function getSafeSubject(value: string | null): ContactSubject {
  return allowedSubjects.includes(value as ContactSubject) ? value as ContactSubject : "produto";
}

export default function Contato() {
  const [searchParams] = useSearchParams();
  const { showToast } = useToast();
  const initialSubject = getSafeSubject(searchParams.get("assunto"));
  const [formData, setFormData] = useState({
    nome: "",
    email: "",
    telefone: "",
    assunto: initialSubject,
    mensagem: "",
  });
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [formError, setFormError] = useState<{ message: string; details: string[] } | null>(null);

  useEffect(() => {
    window.scrollTo(0, 0);
  }, []);

  const handleChange = (
    e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>
  ) => {
    const { name, value } = e.target;
    setFormData((prev) => ({ ...prev, [name]: value }));
    setFormError(null);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const normalizedEmail = formData.email.trim().toLowerCase();

    if (!formData.nome || !normalizedEmail || !formData.mensagem) {
      setFormError(null);
      showToast({
        message: "Por favor, preencha todos os campos obrigatórios.",
        duration: 3000,
      });
      return;
    }

    if (!isValidEmail(normalizedEmail)) {
      setFormError(null);
      showToast({
        message: "Informe um e-mail válido.",
        duration: 3000,
      });
      return;
    }

    setIsSubmitting(true);
    setFormError(null);

    try {
      const response = await csrfFetch(apiUrl("/api/contact"), {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          name: formData.nome,
          email: normalizedEmail,
          subject: formData.assunto,
          message: formData.mensagem,
        }),
      });

      const payload = await response.json().catch(() => null) as {
        error?: string;
        message?: string;
        details?: string[];
      } | null;
      if (!response.ok) {
        throw new Error(payload?.message || payload?.error || "Erro ao enviar mensagem.");
      }

      showToast({
        message: "Mensagem enviada com sucesso. Responderemos em breve.",
        duration: 4000,
      });
      setFormData({
        nome: "",
        email: "",
        telefone: "",
        assunto: "produto",
        mensagem: "",
      });
    } catch (error) {
      const parsed = getApiErrorDisplay(error, "Não foi possível enviar sua mensagem agora.");
      setFormError({ message: parsed.message, details: parsed.details });
      showToast({
        message: parsed.message,
        duration: 4000,
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <main className="l4-contact">
      <section className="l4-contact-hero" aria-labelledby="contact-title">
        <span className="l4-contact-kicker">CANAIS OFICIAIS / L4CKOS</span>
        <h1 id="contact-title">FALE COM A L<span className="l4-contact-brand-four">4</span>CKOS.</h1>
        <p>Dúvidas sobre produtos, pedidos, entregas ou trocas? Estamos por aqui.</p>
      </section>

      <div className="l4-contact-content">
        <section className="l4-contact-channels" aria-labelledby="contact-channels-title">
          <h2 id="contact-channels-title">CANAIS DE ATENDIMENTO</h2>

          <div className="l4-contact-channel">
            <span className="l4-contact-channel-label">E-MAIL</span>
            <a className="l4-contact-email" href={`mailto:${contactChannels.email}`}>
              {contactChannels.email}
            </a>
            <p>Canal oficial para dúvidas, suporte e pós-venda.</p>
          </div>

          <div className="l4-contact-channel">
            <span className="l4-contact-channel-label">WHATSAPP</span>
            <a className="l4-contact-phone" href={officialWhatsAppUrl} target="_blank" rel="noopener noreferrer">
              (61) 98471-6602
            </a>
            <a className="l4-contact-whatsapp-cta" href={officialWhatsAppUrl} target="_blank" rel="noopener noreferrer">
              CONVERSAR PELO WHATSAPP <span aria-hidden="true">→</span>
            </a>
          </div>

          <div className="l4-contact-response">
            <span className="l4-contact-channel-label">PRAZO DE RESPOSTA</span>
            <p>{contactChannels.responseTime}</p>
          </div>
        </section>

        <section className="l4-contact-form-section" aria-labelledby="contact-form-title">
          <h2 id="contact-form-title">ENVIE UMA MENSAGEM</h2>
          <form onSubmit={handleSubmit} className="l4-contact-form">
            {formError ? (
              <div className="l4-contact-alert" role="alert" aria-live="polite">
                <strong>{formError.message}</strong>
                {formError.details.length > 0 ? (
                  <ul>
                    {formError.details.map(detail => <li key={detail}>{detail}</li>)}
                  </ul>
                ) : null}
              </div>
            ) : null}

            <div className="l4-contact-field">
              <label htmlFor="nome">Nome completo *</label>
              <input id="nome" type="text" name="nome" value={formData.nome} onChange={handleChange} placeholder="Seu nome" disabled={isSubmitting} />
            </div>

            <div className="l4-contact-field">
              <label htmlFor="email">E-mail *</label>
              <input id="email" type="email" name="email" value={formData.email} onChange={handleChange} placeholder="seu@email.com" disabled={isSubmitting} />
            </div>

            <div className="l4-contact-field">
              <label htmlFor="telefone">Telefone ou WhatsApp (opcional)</label>
              <input id="telefone" type="tel" name="telefone" value={formData.telefone} onChange={handleChange} placeholder="Opcional" disabled={isSubmitting} />
            </div>

            <div className="l4-contact-field">
              <label htmlFor="assunto">Assunto *</label>
              <select id="assunto" name="assunto" value={formData.assunto} onChange={handleChange} disabled={isSubmitting}>
                <option value="produto">Dúvida sobre produto</option>
                <option value="pedido_pagamento">Pedido e pagamento</option>
                <option value="entrega_rastreamento">Entrega e rastreamento</option>
                <option value="troca_devolucao">Troca ou devolução</option>
                <option value="privacidade">Privacidade e dados pessoais</option>
                <option value="parcerias">Parcerias</option>
                <option value="outro">Outro assunto</option>
              </select>
            </div>

            <div className="l4-contact-field l4-contact-field-message">
              <label htmlFor="mensagem">Mensagem *</label>
              <textarea
                id="mensagem"
                name="mensagem"
                value={formData.mensagem}
                onChange={handleChange}
                placeholder="Descreva sua dúvida ou solicitação. Se houver pedido, informe o número para agilizar o atendimento."
                disabled={isSubmitting}
              />
            </div>

            <button type="submit" className="l4-contact-submit" disabled={isSubmitting}>
              {isSubmitting ? "Enviando..." : "Enviar mensagem"}
            </button>
          </form>
        </section>
      </div>
    </main>
  );
}
