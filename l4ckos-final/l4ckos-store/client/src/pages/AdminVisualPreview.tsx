import "../components/admin/AdminStage1.css";
import { useIsMobile } from "../hooks/useIsMobile";
import { useEffect, useRef, useState } from "react";
import { AdminDashboard } from "../components/admin/dashboard/AdminDashboard";
import { AdminSidebarProfile } from "../components/admin/AdminSidebarProfile";

const groups: Array<{ heading: string; items: Array<{ key: string; label: string }> }> = [
  { heading: "Visão geral", items: [{ key: "overview", label: "Dashboard / KPIs" }] },
  { heading: "Operação", items: [{ key: "orders", label: "Pedidos" }, { key: "products", label: "Produtos" }, { key: "customers", label: "Clientes" }, { key: "batches", label: "Lotes / Pré-venda" }] },
  { heading: "Comercial", items: [{ key: "promos", label: "Promoções" }, { key: "coupons", label: "Cupons" }, { key: "reviews", label: "Avaliações" }] },
  { heading: "Sistema", items: [{ key: "reports", label: "Relatórios" }, { key: "audit", label: "Auditoria" }, { key: "backup", label: "Backup" }, { key: "settings", label: "Configurações" }] },
];

const orders = [
  { id: 1048, status: "paid", totalPrice: 18990, userId: 41, customerName: "Cliente fictício 01", createdAt: "2026-10-20T10:40:00-03:00" },
  { id: 1047, status: "pending", totalPrice: 25990, userId: 42, customerName: "Cliente fictício 02", createdAt: "2026-10-20T09:15:00-03:00" },
  { id: 1046, status: "processing", totalPrice: 12990, userId: 43, customerName: "Cliente fictício 03", createdAt: "2026-10-19T18:20:00-03:00" },
  { id: 1045, status: "shipped", totalPrice: 34990, userId: 44, customerName: "Cliente fictício 04", trackingCode: "DEMO-0001", createdAt: "2026-10-19T15:05:00-03:00" },
];
const products = [
  { id: 71, name: "Camiseta fictícia preta", category: "camisetas", stock: 3, imageUrl: "/preview-ficticio.png" },
  { id: 72, name: "Boné fictício L4CKOS", category: "acessorios", stock: 0, imageUrl: "/preview-ficticio.png" },
  { id: 73, name: "Moletom fictício", category: "moletons", stock: 5, imageUrl: "/preview-ficticio.png" },
];

export default function AdminVisualPreview() {
  const previewState = new URLSearchParams(window.location.search).get("state");
  const isEmpty = previewState === "empty";
  const isError = previewState === "error";
  const isLoading = previewState === "loading";
  const previewOrders = isEmpty ? [] : orders;
  const previewProducts = isEmpty ? [] : products;
  const [section, setSection] = useState<string>("overview");
  const [menuOpen, setMenuOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const panelRef = useRef<HTMLElement | null>(null);
  const mobile = useIsMobile(900);
  useEffect(() => {
    if (!menuOpen || !mobile) return;
    const oldOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    panelRef.current?.querySelector<HTMLButtonElement>("button[aria-pressed=true]")?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") { setMenuOpen(false); buttonRef.current?.focus(); }
      if (event.key === "Tab" && panelRef.current) {
        const focusables = Array.from(panelRef.current.querySelectorAll<HTMLElement>("button:not(:disabled)"));
        if (event.shiftKey && document.activeElement === focusables[0]) { event.preventDefault(); focusables.at(-1)?.focus(); }
        else if (!event.shiftKey && document.activeElement === focusables.at(-1)) { event.preventDefault(); focusables[0]?.focus(); }
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => { document.body.style.overflow = oldOverflow; document.removeEventListener("keydown", onKeyDown); };
  }, [menuOpen, mobile]);
  const statusSummary = ["pending", "paid", "processing", "shipped", "delivered", "cancelled"].map(status => ({
    status,
    label: ({ pending: "Pendente", paid: "Pago", processing: "Em separação", shipped: "Enviado", delivered: "Entregue", cancelled: "Cancelado" } as Record<string, string>)[status],
    count: previewOrders.filter(order => order.status === status).length,
  }));
  return (
    <div className="l4-admin-preview">
      <style>{`.l4-admin-preview{position:relative;display:flex;min-height:75vh;background:#090909;color:#f3f3f3;font-family:inherit}.l4-admin-preview aside{flex:0 0 232px;padding:24px 14px;background:#101010;border-right:1px solid #242424}.l4-admin-preview .brand{padding:4px 12px 24px;font-weight:800;letter-spacing:.1em}.l4-admin-preview .brand small{margin-left:9px;color:#888;font-size:9px}.l4-admin-preview h2{margin:20px 10px 7px;color:#777;font-size:10px;letter-spacing:.13em;text-transform:uppercase}.l4-admin-preview aside button{display:block;position:relative;width:100%;min-height:39px;padding:8px 11px;border:0;border-radius:5px;background:transparent;color:#bbb;text-align:left;font:inherit;font-size:13px;cursor:pointer}.l4-admin-preview aside button[aria-pressed=true]{background:#1a1a1a;color:white}.l4-admin-preview aside button[aria-pressed=true]:before{content:'';position:absolute;inset:7px auto 7px 0;width:2px;background:#e53935}.l4-admin-preview main{min-width:0;flex:1;padding:clamp(18px,2.4vw,32px)}.l4-admin-preview .preview-kicker{margin:0 0 5px;color:#e53935;font-size:10px;letter-spacing:.15em;text-transform:uppercase}.l4-admin-preview h1{margin:0;font-size:clamp(22px,3vw,30px)}.l4-admin-preview .preview-note{margin:7px 0 22px;color:#999;font-size:12px}.l4-admin-preview main>div{min-width:0}.l4-admin-preview button:focus-visible{outline:2px solid #ef4444;outline-offset:2px}.preview-menu-trigger,.preview-menu-close,.preview-backdrop{display:none}@media(max-width:900px){.l4-admin-preview{display:block}.preview-menu-trigger{display:inline-flex;align-items:center;gap:8px;margin:10px 14px 0;padding:10px;border:1px solid #333;border-radius:5px;background:#151515;color:#eee;font:inherit}.preview-backdrop{display:block;position:fixed;inset:0;z-index:50;border:0;background:#000a}.l4-admin-preview aside{position:fixed;inset:0 auto 0 0;z-index:51;width:min(300px,calc(100vw - 48px));min-height:100dvh;overflow:auto;transform:translateX(-105%);transition:transform .2s;background:#101010}.l4-admin-preview aside.is-open{transform:translateX(0)}.l4-admin-preview .brand{padding-top:10px}.l4-admin-preview h2{display:block}.preview-menu-close{display:block;margin:0 0 12px auto;padding:8px 10px;border:1px solid #333;border-radius:5px;background:transparent;color:#eee}.l4-admin-preview main{padding:14px}.l4-admin-preview main>div{min-width:0}}@media(prefers-reduced-motion:reduce){.l4-admin-preview aside{transition:none}}`}</style>
      <button ref={buttonRef} className="preview-menu-trigger" type="button" aria-expanded={menuOpen} aria-controls="admin-preview-menu" onClick={() => setMenuOpen(true)}>☰ <span>Menu administrativo</span></button>
      {menuOpen && mobile ? <button className="preview-backdrop" type="button" aria-label="Fechar menu" onClick={() => { setMenuOpen(false); buttonRef.current?.focus(); }} /> : null}
      <aside id="admin-preview-menu" ref={panelRef} className={`l4-admin-sidebar${menuOpen ? " is-open" : ""}`} inert={mobile && !menuOpen} aria-label="Prévia da navegação administrativa">
        <div className="l4-admin-brand"><strong>L4CKOS</strong><span>GESTÃO</span><small>PRÉVIA LOCAL</small></div>
        <button className="preview-menu-close" type="button" onClick={() => { setMenuOpen(false); buttonRef.current?.focus(); }}>Fechar menu</button>
        <nav className="preview-nav-scroll" aria-label="Seções da gestão">{groups.map(group => <div className="l4-admin-nav-group" key={group.heading}><h2>{group.heading}</h2>{group.items.map(item => <button key={item.key} type="button" aria-pressed={section === item.key} onClick={() => { setSection(item.key); setMenuOpen(false); if (mobile) buttonRef.current?.focus(); }}>{item.label}</button>)}</div>)}</nav>
        <AdminSidebarProfile name="Luna Administradora" email="admin.demo@example.test" preview />
      </aside>
      <main>
        <p className="preview-kicker">Ambiente local · dados demonstrativos</p>
        <h1>{section === "overview" ? "Painel Administrativo" : groups.flatMap(group => group.items).find(item => item.key === section)?.label}</h1>
        <p className="preview-note">Prévia visual isolada. Todos os registros são fictícios e os controles não executam operações.</p>
        {section === "overview" ? <AdminDashboard
          dashboardData={isEmpty ? { salesToday: 0, pendingOrders: 0, ordersToday: 0, usersCount: 0, productsCount: 0, lowStockCount: 0 } : { salesToday: 243800, pendingOrders: 4, ordersToday: 12, usersCount: 128, productsCount: 47, lowStockCount: 3 }}
          dashboardLoading={isLoading} dashboardError={isError}
          orders={previewOrders} products={previewProducts} promoBanners={isEmpty ? [] : [{ isActive: true }, { isActive: false }]} coupons={isEmpty ? [] : [{ isActive: true }]}
          recentAudit={[{ id: 1, action: "Produto atualizado (demonstração)", entity: "Produto", entityId: "71", createdAt: "2026-10-20T10:12:00-03:00" }, { id: 2, action: "Cupom criado (demonstração)", entity: "Cupom", entityId: "DEMO", createdAt: "2026-10-20T09:30:00-03:00" }]}
          quickActions={[{ label: "Novo produto", caption: "Ação desativada na prévia", onClick: () => setSection("products") }, { label: "Pedidos", caption: "Ação desativada na prévia", onClick: () => setSection("orders") }, { label: "Clientes", caption: "Ação desativada na prévia", onClick: () => setSection("customers") }, { label: "Cupons", caption: "Ação desativada na prévia", onClick: () => setSection("coupons") }]}
          ordersLoading={isLoading} ordersError={isError} productsLoading={isLoading} productsError={isError}
          promoBannersLoading={isLoading} promoBannersError={isError} couponsLoading={isLoading} couponsError={isError} auditLoading={isLoading} auditError={isError}
          orderStatusSummary={statusSummary}
          operationalAlerts={isEmpty ? [] : [{ title: "4 pedidos aguardando pagamento", description: "Dado fictício de demonstração.", tone: "warning" }, { title: "3 produtos com estoque baixo", description: "Dado fictício de demonstração.", tone: "warning" }]}
          getOrderStatusLabel={status => statusSummary.find(item => item.status === status)?.label ?? status}
          getOrderStatusTone={status => ({ color: status === "paid" ? "#86efac" : "#fcd34d" })}
          onViewOrder={() => undefined} onViewProduct={() => undefined}
          onNavigateSection={target => setSection(target)}
        /> : <section style={{ marginTop: 20, padding: 20, borderTop: "1px solid #292929", color: "#a1a1aa" }}>Área selecionada para conferir a navegação. Conteúdo operacional não é carregado nesta prévia.</section>}
      </main>
    </div>
  );
}
