const orderStatusLabels: Record<string, string> = {
  pending: "Aguardando pagamento",
  processing: "Em preparação",
  paid: "Pagamento confirmado",
  shipped: "Em transporte",
  delivered: "Entregue",
  cancelled: "Cancelado",
};

export function getOrderStatusLabel(status: string) {
  return orderStatusLabels[status] ?? status;
}
