export type AdminSalesReportData = {
  from: string;
  to: string;
  timeZone: "UTC";
  ordersCount: number;
  ordersTotalCents: number;
  confirmedPaymentsCount: number;
  confirmedPaymentsCents: number;
  statuses: Array<{ status: string; count: number; totalCents: number }>;
  daily: Array<{ day: string; ordersCount: number; totalCents: number }>;
  products: Array<{ productId: number; productName: string; unitsInOrders: number; unitsInCancelledOrders: number }>;
  orders: Array<{ id: number; createdAt: string; status: string; paymentStatus: string; totalPriceCents: number }>;
};
