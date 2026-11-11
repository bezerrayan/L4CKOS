import type { StockResumeStatus } from "./stockCheckoutClient";

/**
 * Presentation model for a STOCK checkout attempt.
 *
 * The backend is the only financial source of truth. Nothing here treats a
 * "created charge" response as an approved payment: only `paid`, as reported by
 * the resume endpoint, is rendered as confirmed.
 */
export type StockAttemptTone = "neutral" | "pending" | "success" | "warning" | "error";

export type StockAttemptView = {
  tone: StockAttemptTone;
  title: string;
  message: string;
  /** Show the "Continuar pagamento" link (only meaningful while pending). */
  canContinuePayment: boolean;
  /** The customer may start a brand-new attempt (server must also say so). */
  canStartNewAttempt: boolean;
  /** Finalize button must stay disabled: an attempt is in flight or settled. */
  blocksCheckout: boolean;
  /** Show the manual "Atualizar status" action. */
  canRefresh: boolean;
};

export type StockAttemptViewInput = {
  status: StockResumeStatus;
  canStartNewAttempt?: boolean;
  checkoutUrl?: string | null;
};

const BLOCKING: ReadonlySet<StockResumeStatus> = new Set(["reserved", "creating", "pending", "ambiguous", "paid"]);
const TERMINAL: ReadonlySet<StockResumeStatus> = new Set(["failed", "expired", "cancelled"]);

export function describeStockAttempt(input: StockAttemptViewInput): StockAttemptView {
  const serverAllowsRetry = input.canStartNewAttempt === true;
  const base = {
    canContinuePayment: false,
    canStartNewAttempt: false,
    // Terminal states only unblock when the server says a new attempt is allowed (stock may still be releasing).
    blocksCheckout: BLOCKING.has(input.status) || (TERMINAL.has(input.status) && !serverAllowsRetry),
    canRefresh: true,
  };

  switch (input.status) {
    case "reserved":
      return { ...base, tone: "pending", title: "Pedido criado", message: "Reservamos seu pedido. O pagamento ainda não foi iniciado." };
    case "creating":
      return { ...base, tone: "pending", title: "Preparando pagamento", message: "Estamos gerando a cobrança. Aguarde alguns instantes e atualize o status." };
    case "pending":
      return {
        ...base,
        tone: "pending",
        title: "Aguardando confirmação do pagamento",
        message: "Seu pedido só será confirmado depois que o pagamento for aprovado. Isto pode levar alguns minutos.",
        canContinuePayment: Boolean(input.checkoutUrl),
      };
    case "ambiguous":
      return {
        ...base,
        tone: "warning",
        title: "Pagamento em análise",
        message: "Não conseguimos confirmar o resultado do pagamento. Não pague novamente: estamos verificando e você será avisado.",
      };
    case "paid":
      return { ...base, tone: "success", title: "Pagamento aprovado", message: "Recebemos a confirmação do pagamento. Seu pedido segue para separação.", canRefresh: false };
    case "failed":
      return {
        ...base,
        tone: "error",
        title: "Pagamento não concluído",
        message: serverAllowsRetry ? "O pagamento não foi concluído. Você pode tentar novamente." : "O pagamento não foi concluído. Consulte o status antes de tentar novamente.",
        canStartNewAttempt: serverAllowsRetry,
      };
    case "expired":
      return {
        ...base,
        tone: "warning",
        title: "Tentativa expirada",
        message: serverAllowsRetry ? "O tempo para pagar este pedido acabou. Você pode iniciar uma nova tentativa." : "O tempo para pagar acabou. Estamos liberando o estoque; atualize o status em instantes.",
        canStartNewAttempt: serverAllowsRetry,
      };
    case "cancelled":
      return {
        ...base,
        tone: "neutral",
        title: "Pedido cancelado",
        message: serverAllowsRetry ? "Este pedido foi cancelado. Você pode fazer uma nova compra." : "Este pedido foi cancelado.",
        canStartNewAttempt: serverAllowsRetry,
      };
  }
}

export type StockCheckoutErrorView = {
  message: string;
  /**
   * True when the request may have reached the backend (network loss, timeout,
   * unknown server error). The UI must then re-query the attempt instead of
   * letting the customer pay again blindly.
   */
  outcomeUnknown: boolean;
  /** True when the cart should be refreshed from the catalog. */
  needsCartReview: boolean;
};

type ErrorLike = { message?: unknown; data?: { code?: unknown; httpStatus?: unknown; appError?: { code?: unknown } | null } | null; name?: unknown };

const LOCAL_CODE_MESSAGES: Record<string, Pick<StockCheckoutErrorView, "message" | "needsCartReview">> = {
  PUBLIC_CHECKOUT_DISABLED: { message: "A finalização de compras ainda não está disponível. Volte em breve.", needsCartReview: false },
  STOCK_VARIANT_NOT_AVAILABLE: { message: "Um item da sacola não está mais disponível. Revise tamanho e cor.", needsCartReview: true },
  STOCK_VARIANT_ID_REQUIRED: { message: "Um item da sacola precisa ser selecionado novamente (tamanho e cor).", needsCartReview: true },
  STOCK_ITEMS_INVALID: { message: "Não foi possível validar os itens da sacola. Revise a quantidade.", needsCartReview: true },
  STOCK_ATTEMPT_NOT_DEFINITIVELY_TERMINAL: { message: "Já existe uma tentativa em andamento. Consulte o status antes de continuar.", needsCartReview: false },
};

/** Maps any thrown value from the STOCK create/resume path to a customer-safe PT-BR message. */
export function describeStockCheckoutError(error: unknown): StockCheckoutErrorView {
  const like: ErrorLike = typeof error === "object" && error !== null ? (error as ErrorLike) : {};
  const rawMessage = typeof like.message === "string" ? like.message.trim() : "";

  const local = LOCAL_CODE_MESSAGES[rawMessage];
  if (local) return { ...local, outcomeUnknown: false };

  // Stable contract: only `error.data.appError.code` is interpreted. Message text is never parsed.
  const appCode = typeof like.data?.appError?.code === "string" ? like.data.appError.code : "";
  if (appCode === "CHECKOUT_ATTEMPT_NOT_REUSABLE") return { message: "Já existe um pedido em aberto com estes itens, ou esta tentativa não pode ser repetida. Consulte o status do pedido.", outcomeUnknown: true, needsCartReview: false };
  // Exclusive drops (control layer in front of STOCK): all rejected BEFORE any reservation or charge, so safe to retry later.
  if (appCode === "EXCLUSIVE_ACCESS_REQUIRED") return { message: "Este produto é exclusivo e exige acesso aprovado e desbloqueado nesta conta. Volte à página do produto.", outcomeUnknown: false, needsCartReview: false };
  if (appCode === "EXCLUSIVE_QUOTA_EXCEEDED") return { message: "Você atingiu o limite de unidades da sua autorização. Reduza a quantidade ou remova itens do drop.", outcomeUnknown: false, needsCartReview: false };
  if (appCode === "EXCLUSIVE_DROP_CLOSED") return { message: "Este drop não está aberto para compras.", outcomeUnknown: false, needsCartReview: false };
  if (appCode === "EXCLUSIVE_ACCESS_UNVERIFIABLE") return { message: "Não foi possível verificar o seu acesso agora. Nada foi cobrado; tente novamente em instantes.", outcomeUnknown: false, needsCartReview: false };
  if (appCode === "STOCK_UNAVAILABLE") return { message: "Esse item acabou de ficar indisponível. Ajuste a quantidade ou escolha outra variação.", outcomeUnknown: false, needsCartReview: true };
  if (appCode === "CHECKOUT_ATTEMPT_EXPIRED") return { message: "A reserva expirou. Atualize o carrinho e inicie uma nova tentativa.", outcomeUnknown: false, needsCartReview: true };
  if (appCode === "PAYMENT_UNDER_ANALYSIS") return { message: "O pagamento está em análise. Não inicie outra tentativa.", outcomeUnknown: true, needsCartReview: false };

  const trpcCode = typeof like.data?.code === "string" ? like.data.code : "";
  switch (trpcCode) {
    case "UNAUTHORIZED":
      return { message: "Sua sessão expirou. Entre novamente para finalizar a compra.", outcomeUnknown: false, needsCartReview: false };
    case "CONFLICT":
      // CONFLICT without a recognized appError.code: treat as unknown outcome (safest) and re-query.
      return { message: "Esta tentativa não pode ser repetida. Consulte o status do pedido.", outcomeUnknown: true, needsCartReview: false };
    case "NOT_FOUND":
      return { message: "Não encontramos esta tentativa de compra.", outcomeUnknown: false, needsCartReview: false };
    case "BAD_REQUEST":
      return { message: "Não foi possível validar os dados do pedido. Revise as informações e tente novamente.", outcomeUnknown: false, needsCartReview: true };
    case "FORBIDDEN":
      // Public checkout gate closed on the server: keep the cart, never retry automatically.
      return { message: "A finalização de compras ainda não está liberada. Sua sacola foi mantida.", outcomeUnknown: false, needsCartReview: false };
    case "SERVICE_UNAVAILABLE":
      return { message: "O checkout está temporariamente indisponível. Sua tentativa foi mantida; tente novamente em instantes.", outcomeUnknown: false, needsCartReview: false };
    case "TOO_MANY_REQUESTS":
      return { message: "Muitas tentativas seguidas. Aguarde um instante e tente novamente.", outcomeUnknown: false, needsCartReview: false };
  }

  // Anything else (fetch failure, timeout, 5xx): the order may or may not exist.
  return {
    message: "Falha de conexão. Seu pedido pode ter sido criado: consulte o status antes de tentar de novo.",
    outcomeUnknown: true,
    needsCartReview: false,
  };
}

/** True when `resume` answered "attempt absent / not yours" (tRPC NOT_FOUND). */
export function isAttemptNotFound(error: unknown): boolean {
  return typeof error === "object" && error !== null && (error as ErrorLike).data?.code === "NOT_FOUND";
}
