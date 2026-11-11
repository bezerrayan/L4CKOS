import type { ReactNode } from "react";
import logoMainDark from "../../images/l4ckos-main-dark-transparent.png";
import "./AuthLayout.css";

export function AuthLayout({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <section className="l4-auth-layout" aria-labelledby="l4-auth-title">
      <aside className="l4-auth-brand" aria-label="L4CKOS — Built for Adventure">
        <img src={logoMainDark} alt="L4CKOS — Built for Adventure" />
        <span>BUILT FOR ADVENTURE</span>
      </aside>
      <main className="l4-auth-content">
        <header className="l4-auth-heading">
          <span className="l4-auth-eyebrow">SUA CONTA L4CKOS</span>
          <h1 id="l4-auth-title">{title}</h1>
          <p>{description}</p>
        </header>
        {children}
      </main>
    </section>
  );
}

export function AuthFormError({ message, details }: { message: string; details: string[] }) {
  return (
    <div className="l4-auth-error" role="alert">
      <strong>{message}</strong>
      {details.length ? <ul>{details.map(detail => <li key={detail}>{detail}</li>)}</ul> : null}
    </div>
  );
}
