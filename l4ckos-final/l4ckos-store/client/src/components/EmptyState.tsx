import { Link } from "react-router-dom";
import type { ComponentType, CSSProperties } from "react";
import "./EmptyState.css";

type EmptyStateProps = {
  icon: ComponentType<{ size?: number; strokeWidth?: number; "aria-hidden"?: boolean }>;
  title: string;
  text: string;
  action?: {
    label: string;
    to?: string;
    onClick?: () => void;
  };
  secondaryAction?: {
    label: string;
    to?: string;
    onClick?: () => void;
  };
  style?: CSSProperties;
};

export default function EmptyState({ icon: Icon, title, text, action, secondaryAction, style }: EmptyStateProps) {
  const renderAction = (item: NonNullable<EmptyStateProps["action"]>, variant: "primary" | "secondary") => {
    const className = `l4-empty-action ${variant}`;
    if (item.to) {
      return (
        <Link className={className} to={item.to}>
          {item.label}
        </Link>
      );
    }

    return (
      <button className={className} type="button" onClick={item.onClick}>
        {item.label}
      </button>
    );
  };

  return (
    <section className="l4-empty-state" style={style}>
      <div className="l4-empty-icon" aria-hidden="true">
        <Icon size={34} strokeWidth={1.8} aria-hidden />
      </div>
      <h2>{title}</h2>
      <p>{text}</p>
      {action || secondaryAction ? (
        <div className="l4-empty-actions">
          {action ? renderAction(action, "primary") : null}
          {secondaryAction ? renderAction(secondaryAction, "secondary") : null}
        </div>
      ) : null}
    </section>
  );
}
