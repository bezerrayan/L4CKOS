import { trpc } from "../lib/trpc";

/**
 * Hook para listar pedidos do usuário
 */
export function useOrders() {
  return trpc.orders.list.useQuery(undefined, {
    refetchOnWindowFocus: true,
    refetchInterval: query => {
      const orders = (query.state.data ?? []).filter(
        (order): order is NonNullable<typeof order> => Boolean(order),
      );
      const hasOpenOrder = orders.some(order =>
        ["pending", "overdue", "failed"].includes(String(order.payment?.status))
        || ["awaiting_payment", "ready", "processing"].includes(String(order.fulfillmentStatus)),
      );
      return hasOpenOrder ? 10000 : false;
    },
  });
}

/**
 * Hook para criar pedido com cobrança Asaas (PIX, boleto, cartão via invoice)
 */
export function useCreateAsaasCharge() {
  return trpc.orders.createAsaasCharge.useMutation();
}

/**
 * Hook para rastrear pedido por número ou código de rastreio
 */
export function useTrackOrder(input?: { orderId?: number; trackingCode?: string }) {
  return trpc.orders.track.useQuery(input ?? { orderId: 1 }, {
    enabled: Boolean(input?.orderId || input?.trackingCode),
    retry: false,
    refetchOnWindowFocus: true,
    refetchInterval: query => {
      const data = query.state.data as { payment?: { status?: string } | null; fulfillmentStatus?: string } | undefined;
      const paymentStatus = String(data?.payment?.status ?? "");
      const fulfillmentStatus = String(data?.fulfillmentStatus ?? "");
      return ["pending", "overdue", "failed"].includes(paymentStatus) || ["awaiting_payment", "ready", "processing"].includes(fulfillmentStatus) ? 8000 : false;
    },
  });
}

/**
 * Hook para obter detalhes do pedido (inclui itens)
 */
export function useOrderDetail(orderId?: number) {
  return trpc.orders.detail.useQuery(orderId ?? 0, {
    enabled: Boolean(orderId),
    retry: false,
    refetchOnWindowFocus: true,
    refetchInterval: query => {
      const data = query.state.data as { payment?: { status?: string } | null; fulfillmentStatus?: string } | undefined;
      const paymentStatus = String(data?.payment?.status ?? "");
      const fulfillmentStatus = String(data?.fulfillmentStatus ?? "");
      const paymentNeedsUpdate = ["pending", "overdue", "failed"].includes(paymentStatus);
      const fulfillmentNeedsUpdate = ["awaiting_payment", "ready", "processing"].includes(fulfillmentStatus);
      return paymentNeedsUpdate || fulfillmentNeedsUpdate ? 8000 : false;
    },
  });
}
