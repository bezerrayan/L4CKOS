import { Link } from "react-router-dom";
import type { ReactNode } from "react";
import "./LegalDocument.css";

export type LegalSection = {
  id: string;
  title: string;
  content: ReactNode;
};

type LegalDocumentProps = {
  title: string;
  description: string;
  updatedAt: string;
  sections: LegalSection[];
};

export default function LegalDocument({ title, description, updatedAt, sections }: LegalDocumentProps) {
  function focusSection(sectionId: string) {
    window.setTimeout(() => {
      document.getElementById(sectionId)?.focus({ preventScroll: true });
    }, 0);
  }

  return (
    <main className="l4-legal-page">
      <header className="l4-legal-hero">
        <Link to="/" className="l4-legal-back">Voltar para a loja</Link>
        <h1>{title}</h1>
        <p>{description}</p>
        <span>Última atualização: {updatedAt}</span>
      </header>

      <div className="l4-legal-layout">
        <details className="l4-legal-mobile-nav">
          <summary>NESTA PÁGINA</summary>
          <nav aria-label={`Seções de ${title}`}>
            {sections.map(section => (
              <a key={section.id} href={`#${section.id}`} onClick={() => focusSection(section.id)}>{section.title}</a>
            ))}
          </nav>
        </details>

        <aside className="l4-legal-nav">
          <nav aria-label={`Seções de ${title}`}>
            <strong>Nesta página</strong>
            {sections.map(section => (
              <a key={section.id} href={`#${section.id}`} onClick={() => focusSection(section.id)}>{section.title}</a>
            ))}
          </nav>
        </aside>

        <article className="l4-legal-content">
          {sections.map(section => (
            <section key={section.id} id={section.id} tabIndex={-1}>
              <h2>{section.title}</h2>
              {section.content}
            </section>
          ))}
        </article>
      </div>
    </main>
  );
}
