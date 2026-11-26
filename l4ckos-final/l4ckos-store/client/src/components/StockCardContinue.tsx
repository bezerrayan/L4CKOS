import { isTrustedHostedInvoiceUrl } from "../stock/hostedInvoice";

type Props = {
  /** Asaas-hosted invoice returned by the server for a pending card charge. */
  checkoutUrl?: string | null;
};

/**
 * Continue a pending hosted-card payment. Presentational only: it never creates or changes a payment, and it only links
 * to the exact Asaas invoice host of this build. Card data is entered on the Asaas page, never in the storefront.
 */
export function StockCardContinue({ checkoutUrl }: Props) {
  if (!isTrustedHostedInvoiceUrl(checkoutUrl, import.meta.env.VITE_DEPLOY_TARGET)) {
    return <p data-testid="stock-card-unavailable">O link de pagamento não está disponível agora. Atualize o status ou fale com o suporte.</p>;
  }
  return (
    <div className="l4-checkout-card" data-testid="stock-card-continue">
      <p>Você será levado à página segura da Asaas para informar os dados do cartão. A L4CKOS não recebe nem armazena o número do cartão.</p>
      <a href={checkoutUrl} rel="noopener noreferrer">Continuar no pagamento seguro</a>
    </div>
  );
}
