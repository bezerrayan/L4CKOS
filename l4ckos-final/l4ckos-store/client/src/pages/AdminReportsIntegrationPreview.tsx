import "../components/admin/AdminStage1.css";
import { AdminSidebarProfile } from "../components/admin/AdminSidebarProfile";
import { AdminReportsPanel } from "../components/admin/reports/AdminReportsPanel";
import type { AdminSalesReportData } from "../../../shared/reports";
import "../components/admin/reports/AdminReportsIntegrationPreview.css";

const syntheticReport: AdminSalesReportData = {
  from: "2026-10-15T00:00:00.000Z",
  to: "2026-10-21T23:59:59.999Z",
  timeZone: "UTC",
  ordersCount: 8,
  ordersTotalCents: 134840,
  confirmedPaymentsCount: 4,
  confirmedPaymentsCents: 74370,
  statuses: [
    { status: "pending", count: 2, totalCents: 24980 },
    { status: "processing", count: 1, totalCents: 15990 },
    { status: "paid", count: 2, totalCents: 34390 },
    { status: "shipped", count: 1, totalCents: 17990 },
    { status: "delivered", count: 1, totalCents: 21990 },
    { status: "cancelled", count: 1, totalCents: 19500 },
  ],
  daily: [
    { day: "2026-10-15", ordersCount: 1, totalCents: 13990 },
    { day: "2026-10-16", ordersCount: 1, totalCents: 15990 },
    { day: "2026-10-17", ordersCount: 0, totalCents: 0 },
    { day: "2026-10-18", ordersCount: 2, totalCents: 42970 },
    { day: "2026-10-19", ordersCount: 1, totalCents: 17990 },
    { day: "2026-10-20", ordersCount: 1, totalCents: 21990 },
    { day: "2026-10-21", ordersCount: 2, totalCents: 21910 },
  ],
  products: [
    { productId: 11, productName: "Camiseta Clã 14 Bis", unitsInOrders: 4, unitsInCancelledOrders: 1 },
    { productId: 12, productName: "Camiseta Ritmo Noturno", unitsInOrders: 3, unitsInCancelledOrders: 0 },
    { productId: 13, productName: "Camiseta Horizonte", unitsInOrders: 2, unitsInCancelledOrders: 0 },
  ],
  orders: [
    { id: 5812, createdAt: "2026-10-21T17:40:00.000Z", status: "pending", paymentStatus: "unconfirmed", totalPriceCents: 10990 },
    { id: 5811, createdAt: "2026-10-21T13:10:00.000Z", status: "paid", paymentStatus: "confirmed", totalPriceCents: 10920 },
    { id: 5810, createdAt: "2026-10-20T16:20:00.000Z", status: "delivered", paymentStatus: "confirmed", totalPriceCents: 21990 },
    { id: 5809, createdAt: "2026-10-19T11:30:00.000Z", status: "shipped", paymentStatus: "confirmed", totalPriceCents: 17990 },
    { id: 5808, createdAt: "2026-10-18T15:00:00.000Z", status: "cancelled", paymentStatus: "unconfirmed", totalPriceCents: 19500 },
    { id: 5807, createdAt: "2026-10-18T09:15:00.000Z", status: "paid", paymentStatus: "confirmed", totalPriceCents: 23470 },
    { id: 5806, createdAt: "2026-10-16T20:05:00.000Z", status: "processing", paymentStatus: "unconfirmed", totalPriceCents: 15990 },
    { id: 5805, createdAt: "2026-10-15T12:45:00.000Z", status: "pending", paymentStatus: "unconfirmed", totalPriceCents: 13990 },
  ],
};

const groups = [
  { title: "Visão geral", items: ["Dashboard"] },
  { title: "Operação", items: ["Pedidos", "Produtos", "Clientes", "Lotes / Pré-venda"] },
  { title: "Comercial", items: ["Destaques da Home", "Cupons", "Avaliações"] },
  { title: "Sistema", items: ["Relatórios", "Auditoria", "Backup", "Configurações"] },
];

export default function AdminReportsIntegrationPreview() {
  return <div className="l4-admin admin-reports-integration-preview">
    <aside className="l4-admin-sidebar admin-reports-preview-sidebar" aria-label="Navegação administrativa demonstrativa">
      <div className="l4-admin-brand"><strong>L4CKOS</strong><span>GESTÃO</span><small>PRÉVIA LOCAL</small></div>
      <nav className="l4-admin-nav-scroll">{groups.map(group => <section className="l4-admin-nav-group" key={group.title}><h2>{group.title}</h2>{group.items.map(item => <button type="button" key={item} aria-current={item === "Relatórios" ? "page" : undefined} disabled={item !== "Relatórios"}>{item}</button>)}</section>)}</nav>
      <AdminSidebarProfile name="Conta demonstrativa" email="Sem sessão real" preview />
    </aside>
    <main>
      <div className="admin-reports-preview-notice"><strong>PRÉVIA DE INTEGRAÇÃO</strong><span>Valores sintéticos · nenhuma chamada administrativa</span></div>
      <AdminReportsPanel enabled={false} mockData={syntheticReport} onMessage={() => undefined} />
    </main>
  </div>;
}
