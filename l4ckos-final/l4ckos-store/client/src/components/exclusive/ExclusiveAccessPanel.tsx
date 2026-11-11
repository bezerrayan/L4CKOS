import { useEffect, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { trpc } from "../../lib/trpc";
import { formatDropInstant } from "../../lib/dropTime";
import type { ProductDropView } from "../../../../shared/exclusiveDropsV1";
import "./ExclusiveAccessPanel.css";

type Exclusive = Extract<ProductDropView, { exclusive: true }>;

/** Stable backend codes only (`error.data.appError.code`); message text is never interpreted. */
export function exclusiveErrorMessage(error: unknown): string {
  const code = (error as { data?: { appError?: { code?: string } } } | null)?.data?.appError?.code;
  switch (code) {
    case "EXCLUSIVE_CODE_INVALID": return "Código inválido ou indisponível para esta conta.";
    case "EXCLUSIVE_CODE_RATE_LIMITED": return "Muitas tentativas. Aguarde alguns minutos e tente novamente.";
    case "EXCLUSIVE_REQUEST_WINDOW_CLOSED": return "As solicitações de acesso não estão abertas neste momento.";
    default: return "Não foi possível concluir agora. Tente novamente em instantes.";
  }
}

/** "Drop exclusivo" identification + the period information. Public: safe for anonymous visitors. */
export function ExclusiveDropBadge({ view }: { view: Exclusive }) {
  const { drop } = view;
  const stateLabel = drop.state === "scheduled" ? "Em breve" : drop.state === "active" ? "Compras abertas" : "Encerrado";
  return (
    <div className="l4-xd-head">
      <span className="l4-xd-badge">Drop exclusivo</span>
      <strong className="l4-xd-name">{drop.name}</strong>
      <dl className="l4-xd-period" aria-label="Período do drop">
        <div><dt>Situação</dt><dd>{stateLabel}</dd></div>
        <div><dt>Compras</dt><dd>{formatDropInstant(drop.purchaseWindow.startsAt, drop.timezone)} → {formatDropInstant(drop.purchaseWindow.endsAt, drop.timezone)}</dd></div>
        {drop.requiresAuthorization && drop.requestWindow.endsAt ? (
          <div><dt>Solicitar acesso até</dt><dd>{formatDropInstant(drop.requestWindow.endsAt, drop.timezone)}</dd></div>
        ) : null}
      </dl>
    </div>
  );
}

/**
 * Replaces the purchase buttons of an exclusive product the viewer cannot buy yet. Reusable for any future drop.
 * The server is the authority: this panel only explains and drives the access flow.
 */
export default function ExclusiveAccessPanel({ view, productId }: { view: Exclusive; productId: number }) {
  const utils = trpc.useUtils();
  const request = trpc.exclusiveDrops.requestAccess.useMutation();
  const redeem = trpc.exclusiveDrops.redeemCode.useMutation();
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const { drop, viewer } = view;
  // A typed code must never outlive the state it was typed for (account switch, reissue, status change).
  useEffect(() => { setCode(""); setError(""); }, [viewer.status]);
  const refresh = () => utils.exclusiveDrops.forProduct.invalidate({ productId });

  const submitRequest = async () => {
    setError("");
    try {
      await request.mutateAsync({ dropId: drop.id });
      await refresh();
    } catch (err) { setError(exclusiveErrorMessage(err)); }
  };
  const submitCode = async (event: FormEvent) => {
    event.preventDefault();
    setError("");
    try {
      await redeem.mutateAsync({ code });
      setCode("");
      await refresh();
    } catch (err) { setError(exclusiveErrorMessage(err)); }
  };

  const closed = drop.state === "closed";
  const body = (() => {
    if (closed) return <p role="status" className="l4-xd-state">Drop encerrado. Indisponível para novos pedidos.</p>;
    if (viewer.status === "login_required") {
      return (
        <>
          <p className="l4-xd-state">Este produto é exclusivo. Entre na sua conta para solicitar acesso.</p>
          <Link className="l4-xd-btn" to={`/entrar?next=${encodeURIComponent(`/produto/${productId}`)}`}>Solicitar acesso</Link>
        </>
      );
    }
    switch (viewer.status) {
      case "none":
      case "rejected": {
        const canAsk = drop.requestWindow.open;
        return (
          <>
            {viewer.status === "rejected" ? <p role="status" className="l4-xd-state">Sua solicitação anterior não foi aprovada.</p> : null}
            <p className="l4-xd-state">{canAsk ? "Este produto é exclusivo. Solicite acesso para comprar." : "As solicitações de acesso não estão abertas no momento."}</p>
            <button type="button" className="l4-xd-btn" onClick={() => void submitRequest()} disabled={!canAsk || request.isPending} aria-disabled={!canAsk || request.isPending}>
              {viewer.status === "rejected" ? "Solicitar novamente" : "Solicitar acesso"}
            </button>
          </>
        );
      }
      case "pending":
        return <p role="status" className="l4-xd-state l4-xd-pending">Aguardando aprovação. Avisaremos quando houver uma decisão.</p>;
      case "approved":
        return (
          <form onSubmit={submitCode} className="l4-xd-code" noValidate>
            <p className="l4-xd-state">Acesso aprovado. Informe o seu código individual para desbloquear a compra.</p>
            <label htmlFor="xd-code">Código individual</label>
            <input id="xd-code" name="code" value={code} onChange={e => setCode(e.target.value)} autoComplete="off" autoCapitalize="characters" spellCheck={false}
              inputMode="text" placeholder="XXXXX-XXXXX-XXXXX-XXXXX" aria-describedby={error ? "xd-code-error" : undefined} aria-invalid={error ? true : undefined} />
            <button type="submit" className="l4-xd-btn" disabled={redeem.isPending || code.trim().length < 16}>Desbloquear</button>
          </form>
        );
      case "revoked":
      case "expired":
        return <p role="status" className="l4-xd-state">Seu acesso a este drop não está mais disponível.</p>;
      case "unlocked":
        // Purchase window not open yet, or no units left: explain instead of offering purchase.
        return <p role="status" className="l4-xd-state">{drop.state === "scheduled" ? `Acesso liberado. As compras abrem em ${formatDropInstant(drop.purchaseWindow.startsAt, drop.timezone)}.` : "Você já utilizou todas as unidades da sua autorização."}</p>;
      default:
        return null;
    }
  })();

  return (
    <section className="l4-xd-panel" aria-label="Acesso ao drop exclusivo">
      <ExclusiveDropBadge view={view} />
      {body}
      {error ? <p id="xd-code-error" role="alert" className="l4-xd-error">{error}</p> : null}
    </section>
  );
}

/** Shown above the purchase buttons once the viewer is unlocked and may buy. */
export function ExclusiveUnlockedNotice({ view, inCartUnits = 0, dropInCartUnits = inCartUnits }: { view: Exclusive; inCartUnits?: number; dropInCartUnits?: number }) {
  const remaining = view.viewer.unitsRemaining ?? 0;
  const { unitLimit, unitsReserved, unitsConsumed } = view.viewer;
  return (
    <section className="l4-xd-panel l4-xd-unlocked" aria-label="Acesso ao drop exclusivo">
      <ExclusiveDropBadge view={view} />
      {view.drop.requiresAuthorization ? (
        <>
          <p role="status" className="l4-xd-state">Acesso liberado: você pode comprar até {remaining} {remaining === 1 ? "unidade" : "unidades"} (qualquer combinação de tamanhos).</p>
          {unitLimit !== undefined ? (
            <dl className="l4-xd-quota" aria-label="Sua cota neste drop">
              <div><dt>Autorizadas</dt><dd>{unitLimit}</dd></div>
              <div><dt>Em pedidos abertos</dt><dd>{unitsReserved ?? 0}</dd></div>
              <div><dt>Compradas</dt><dd>{unitsConsumed ?? 0}</dd></div>
              <div><dt>Disponíveis</dt><dd>{remaining}</dd></div>
            </dl>
          ) : null}
          {inCartUnits > 0 ? <p className="l4-xd-state l4-xd-note">Você já tem {inCartUnits} {inCartUnits === 1 ? "unidade" : "unidades"} deste produto na sacola.</p> : null}
          {dropInCartUnits > inCartUnits ? <p className="l4-xd-state l4-xd-note">Somando todos os produtos deste drop, há {dropInCartUnits} {dropInCartUnits === 1 ? "unidade" : "unidades"} na sacola; o limite é compartilhado. A disponibilidade é confirmada ao finalizar o pedido.</p> : null}
        </>
      ) : null}
    </section>
  );
}
