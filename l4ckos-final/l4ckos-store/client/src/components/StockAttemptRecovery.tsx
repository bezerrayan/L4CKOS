import { useEffect } from "react";
import { Link } from "react-router-dom";
import { trpc } from "../lib/trpc";
import { formatPrice } from "../lib/utils";
import { describeStockAttempt, isAttemptNotFound } from "../stock/stockAttemptView";
import { updateStoredStockAttemptById, type StockAttemptStorage } from "../stock/stockCheckoutClient";

type Props = {
  attemptId: string;
  storage: StockAttemptStorage;
  onPaid?: (paid: { orderId: string | null; amountCents: number }) => void;
};

/**
 * Re-opens an attempt started earlier in this browser using only the real `stockCheckout.resume`
 * procedure (owner-scoped on the server). It never creates a new attempt or payment.
 */
export function StockAttemptRecovery({ attemptId, storage, onPaid }: Props) {
  const query = trpc.stockCheckout.resume.useQuery({ attemptId }, { retry: false, refetchOnWindowFocus: true });
  const data = query.data;

  useEffect(() => {
    if (!data) return;
    updateStoredStockAttemptById({ storage, attemptId, status: data.status, canStartNewAttempt: data.canStartNewAttempt });
    if (data.status === "paid") onPaid?.({ orderId: data.orderId ?? null, amountCents: data.amountCents });
  }, [data, storage, attemptId, onPaid]);

  if (query.isLoading) {
    return <section className="l4-checkout-charge is-pending" role="status" aria-busy="true"><strong>Verificando seu pedido...</strong></section>;
  }

  if (query.error) {
    if (isAttemptNotFound(query.error)) return null;
    return (
      <section className="l4-checkout-charge is-warning" role="alert">
        <strong>Não foi possível consultar seu pedido</strong>
        <p>Nenhuma nova cobrança foi iniciada. Verifique sua conexão e tente de novo.</p>
        <button type="button" onClick={() => void query.refetch()}>Consultar novamente</button>
      </section>
    );
  }

  if (!data) return null;
  const view = describeStockAttempt(data);
  return (
    <section className={`l4-checkout-charge is-${view.tone}`} role="status" aria-live="polite" data-stock-status={data.status}>
      <strong>{view.title}</strong>
      <p>{view.message}</p>
      {data.orderId ? <p>Pedido #{data.orderId}</p> : null}
      {data.amountCents > 0 ? <p>Total: {formatPrice(data.amountCents / 100)}</p> : null}
      {view.canContinuePayment && data.checkoutUrl ? <a href={data.checkoutUrl} target="_blank" rel="noreferrer">Continuar pagamento</a> : null}
      {view.canRefresh ? <button type="button" onClick={() => void query.refetch()} disabled={query.isFetching}>{query.isFetching ? "Atualizando..." : "Atualizar status"}</button> : null}
      {data.status === "paid" ? <Link to="/meus-pedidos">Ver meus pedidos</Link> : null}
    </section>
  );
}
