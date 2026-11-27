import { useMemo, useRef } from "react";
import { Link } from "react-router-dom";
import { StockCardContinue } from "../components/StockCardContinue";
import { useUser } from "../contexts/UserContext";
import { trpc } from "../lib/trpc";
import { stockAttemptResumeV1Schema } from "../../../shared/stockCheckoutV1";
import { describeReturnAttempt, RETURN_POLL_INTERVAL_MS, shouldKeepPollingReturn } from "../stock/returnView";
import "./PedidoDetalhe.css";

/**
 * Landing page after the Asaas-hosted card page. It asks the backend for the customer's latest STOCK attempt and
 * renders only what the backend reports; coming back from the payment page never confirms an order by itself.
 */
export default function PedidoRetorno() {
  const { isAuthenticated, isLoading: authLoading } = useUser();
  const startedAt = useRef(Date.now());
  const query = trpc.stockCheckout.resumeLatest.useQuery(undefined, {
    enabled: isAuthenticated,
    retry: false,
    staleTime: 0,
    refetchInterval: current => {
      const parsed = stockAttemptResumeV1Schema.safeParse(current.state.data);
      return shouldKeepPollingReturn(parsed.success ? parsed.data.status : undefined, Date.now() - startedAt.current) ? RETURN_POLL_INTERVAL_MS : false;
    },
  });

  const attempt = useMemo(() => {
    const parsed = stockAttemptResumeV1Schema.safeParse(query.data);
    return parsed.success ? parsed.data : null;
  }, [query.data]);
  const view = attempt ? describeReturnAttempt(attempt, Date.now() - startedAt.current) : null;

  return (
    <main className="l4-order-detail-page" aria-labelledby="return-title">
      <header className="l4-detail-page-head">
        <div>
          <p className="l4-detail-eyebrow">Pedido</p>
          <h1 id="return-title">Acompanhamento do pagamento</h1>
        </div>
        <Link to="/meus-pedidos" className="l4-detail-action">Meus pedidos</Link>
      </header>

      {authLoading ? <p className="l4-detail-message">Verificando sua sessão…</p> : null}
      {!authLoading && !isAuthenticated ? (
        <p className="l4-detail-message">Entre na sua conta para acompanhar o pedido. <Link to="/login">Entrar</Link></p>
      ) : null}
      {isAuthenticated && query.isLoading ? <p className="l4-detail-message" role="status">Consultando o status do pagamento…</p> : null}
      {isAuthenticated && query.isError ? (
        <p className="l4-detail-error" role="alert">
          Não foi possível consultar o pedido agora. Seu pagamento não é alterado por esta página.{" "}
          <button type="button" className="l4-detail-action" onClick={() => void query.refetch()}>Tentar de novo</button>
        </p>
      ) : null}
      {isAuthenticated && !query.isLoading && !query.isError && !attempt ? (
        <p className="l4-detail-message">Não encontramos um pedido recente nesta conta. <Link to="/meus-pedidos">Ver meus pedidos</Link></p>
      ) : null}

      {attempt && view ? (
        <section className={`l4-order-detail-body is-${view.tone}`} role="status" aria-live="polite" data-stock-status={attempt.status}>
          <h2>{view.title}</h2>
          <p className="l4-detail-muted">{view.message}</p>
          {attempt.orderId ? <p className="l4-detail-muted">Pedido #{attempt.orderId}</p> : null}
          {attempt.amountCents > 0 ? <p className="l4-detail-muted">Total: {new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(attempt.amountCents / 100)}</p> : null}
          {view.stillWaiting ? (
            <p className="l4-detail-muted">A confirmação ainda não chegou. Isso pode levar alguns minutos; você pode voltar a esta página ou acompanhar em Meus pedidos. Não pague novamente.</p>
          ) : null}
          {view.canContinuePayment && attempt.paymentMethod === "CARD" ? <StockCardContinue checkoutUrl={attempt.checkoutUrl} /> : null}
          <footer className="l4-detail-actions">
            {view.canRefresh ? <button type="button" className="l4-detail-action" onClick={() => void query.refetch()}>Atualizar status</button> : null}
            {view.orderPath ? <Link to={view.orderPath} className="l4-detail-action is-primary">Acompanhar pedido</Link> : null}
            <Link to="/produtos" className="l4-detail-action">Voltar à loja</Link>
          </footer>
        </section>
      ) : null}
    </main>
  );
}
