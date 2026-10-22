import { useState } from "react";
import { Link, NavLink } from "react-router-dom";
import { MapPin, Package, ShieldCheck } from "lucide-react";
import { PurchasedTransportInfo } from "../components/PreorderInfo";
import { CANCELLATION_NOTICE } from "../../../shared/paymentExceptions";
import { getOrderStatusLabel } from "../utils/orderStatus";
import "./Perfil.css";
import "./MeusPedidos.css";

type PreviewOrder = {
  id: number;
  status: "pending" | "paid" | "cancelled";
  date: string;
  total: string;
  tracking: string;
};

const sampleOrders: PreviewOrder[] = [
  { id: 104, status: "pending", date: "18/10/2026", total: "R$ 189,00", tracking: "Ainda não informado" },
  { id: 103, status: "paid", date: "12/10/2026", total: "R$ 149,00", tracking: "BR000000000DEMO" },
  { id: 102, status: "cancelled", date: "03/10/2026", total: "R$ 99,00", tracking: "Não se aplica" },
];

const previewStatus: Record<PreviewOrder["status"], string> = {
  pending: "Aguardando pagamento",
  paid: "Pagamento confirmado",
  cancelled: "Cancelado",
};

type Section = "overview" | "addresses" | "personal" | "preferences";

export default function AccountPreview({ scenario }: { scenario: string }) {
  const empty = scenario === "empty";
  const [section, setSection] = useState<Section>("overview");
  const [preferences, setPreferences] = useState({ promotions: true, orders: true, products: false });

  return <main className="l4-profile-page">
    <p className="l4-account-preview-notice" role="note">PRÉVIA LOCAL · DADOS FICTÍCIOS · SEM SESSÃO, CONSULTAS OU ALTERAÇÕES</p>
    <header className="l4-profile-header">
      <div className="l4-profile-avatar" aria-hidden="true">D</div>
      <div className="l4-profile-identity"><p>Minha conta · Demonstração</p><h1>Cliente de Demonstração</h1><span>cliente@example.invalid</span><small>Membro desde 01/06/2026</small></div>
      <button className="l4-profile-primary-action" type="button" disabled>Editar perfil</button>
    </header>
    <nav className="l4-profile-nav" aria-label="Navegação da prévia da conta">
      <button type="button" aria-pressed={section === "overview"} className={section === "overview" ? "is-active" : ""} onClick={() => setSection("overview")}>Visão geral</button>
      <NavLink to={`/meus-pedidos?accountPreview=${empty ? "empty" : "populated"}`}>Meus pedidos</NavLink>
      <button type="button" aria-pressed={section === "addresses"} className={section === "addresses" ? "is-active" : ""} onClick={() => setSection("addresses")}>Endereços</button>
      <button type="button" aria-pressed={section === "personal"} className={section === "personal" ? "is-active" : ""} onClick={() => setSection("personal")}>Dados pessoais</button>
      <button type="button" aria-pressed={section === "preferences"} className={section === "preferences" ? "is-active" : ""} onClick={() => setSection("preferences")}>Preferências e segurança</button>
    </nav>

    {section === "overview" ? <section className="l4-profile-content" aria-label="Visão geral demonstrativa">
      <div className="l4-profile-section-heading"><div><p>Visão geral</p><h2>O essencial da sua conta</h2></div><Link to={`/meus-pedidos?accountPreview=${empty ? "empty" : "populated"}`} className="l4-profile-text-action">Histórico completo</Link></div>
      <div className="l4-profile-overview-grid">
        <article className="l4-profile-summary"><MapPin size={18} aria-hidden="true" /><div><h3>Endereço principal</h3><p>{empty ? "Nenhum endereço salvo." : "Rua de Demonstração, 123 · Brasília/DF"}</p></div><button type="button" onClick={() => setSection("addresses")}>{empty ? "Adicionar endereço" : "Editar endereço"}</button></article>
        <article className="l4-profile-summary"><ShieldCheck size={18} aria-hidden="true" /><div><h3>Precisa de ajuda?</h3><p>Fale com o suporte pelos canais oficiais.</p></div><Link to="/contato">Falar com suporte</Link></article>
      </div>
      <section className="l4-profile-subsection"><div className="l4-profile-section-heading"><div><h2>Pedidos recentes</h2><p>Estados demonstrativos, sem vínculo com pedidos reais.</p></div></div>
        {empty ? <div className="l4-profile-empty-line"><p>Esta conta demonstrativa não tem pedidos.</p><Link className="l4-profile-secondary-action" to="/produtos">Explorar produtos</Link></div> : <div className="l4-profile-list">{sampleOrders.slice(0, 2).map(order => <PreviewOrderRow key={order.id} order={order} />)}</div>}
      </section>
    </section> : null}

    {section === "addresses" ? <section className="l4-profile-content"><div className="l4-profile-section-heading"><div><p>Endereços</p><h2>Onde você recebe seus pedidos</h2></div><button type="button" className="l4-profile-primary-action" disabled>Adicionar endereço</button></div>
      {empty ? <div className="l4-profile-empty-line"><p>Esta conta demonstrativa não tem endereços salvos.</p></div> : <div className="l4-profile-list"><article className="l4-profile-list-item"><div><strong>Casa <em>Principal · fictício</em></strong><p>Destinatário Demonstrativo · Rua de Demonstração, 123</p><p>Bairro Exemplo · Brasília/DF · CEP 70000-000</p></div><div className="l4-profile-inline-actions"><button type="button" disabled>Editar</button><button type="button" disabled>Remover</button></div></article></div>}
    </section> : null}

    {section === "personal" ? <section className="l4-profile-content"><div className="l4-profile-section-heading"><div><p>Dados pessoais</p><h2>Seus dados de contato</h2></div><button className="l4-profile-primary-action" type="button" disabled>Editar perfil</button></div>
      <dl className="l4-profile-read-data"><div><dt>Nome</dt><dd>Cliente de Demonstração</dd></div><div><dt>E-mail</dt><dd>cliente@example.invalid</dd></div><div><dt>Telefone</dt><dd>{empty ? "Não informado" : "(00) 90000-0000 · fictício"}</dd></div></dl>
    </section> : null}

    {section === "preferences" ? <section className="l4-profile-content"><div className="l4-profile-section-heading"><div><p>Preferências e segurança</p><h2>Comunicações e acesso</h2></div></div>
      <div className="l4-profile-preferences" aria-label="Preferências locais demonstrativas">{([ ["promotions", "E-mails de promoções"], ["orders", "Notificações de pedidos"], ["products", "Notificações de produtos"] ] as const).map(([key, label]) => <label key={key}><span>{label}</span><input type="checkbox" checked={preferences[key]} onChange={event => setPreferences(current => ({ ...current, [key]: event.target.checked }))} /></label>)}</div>
      <div className="l4-profile-security"><div><h3>Suporte e segurança</h3><p>Controles reais ficam indisponíveis nesta prévia.</p></div><button className="l4-profile-secondary-action" type="button" disabled>Fazer logout</button></div>
      <div className="l4-profile-close-account"><button type="button" disabled>Encerrar conta</button></div>
    </section> : null}
  </main>;
}

export function AccountOrdersPreview({ scenario }: { scenario: string }) {
  const orders = scenario === "empty" ? [] : sampleOrders;
  return <main className="l4-orders-page">
    <p className="l4-account-preview-notice" role="note">PRÉVIA LOCAL · DADOS FICTÍCIOS · SEM SESSÃO, CONSULTAS OU ALTERAÇÕES</p>
    <header className="l4-orders-header"><div><p className="l4-orders-eyebrow">Minha conta · Demonstração</p><h1>Meus pedidos</h1><p>Estados de exemplo para revisão visual, não são pedidos reais.</p></div><div className="l4-order-actions"><Link to={`/perfil?accountPreview=${scenario}`} className="l4-orders-button">Voltar à conta</Link><Link to="/acompanhar-pedido" className="l4-orders-button">Acompanhar pedido</Link></div></header>
    {orders.length ? <div className="l4-orders-list">{orders.map(order => <PreviewOrderRow key={order.id} order={order} />)}</div> : <div className="l4-profile-empty-line"><p>Esta conta demonstrativa não tem pedidos.</p><Link className="l4-orders-button" to="/produtos">Explorar produtos</Link></div>}
  </main>;
}

type DetailPreviewScenario = "pending" | "paid" | "cancelled";

const detailScenarios: Record<DetailPreviewScenario, {
  id: number;
  status: DetailPreviewScenario;
  paymentStatus: "unconfirmed" | "confirmed";
  createdAt: string;
  updatedAt: string;
  totalPrice: number;
  trackingCode: string | null;
  shippingAddress: { recipient: string; street: string; number: string; complement: string; neighborhood: string; city: string; state: string; zipCode: string };
  shippingAtPurchase: { id: string; label: string; minDays: number; maxDays: number };
  items: Array<{ id: number; productId: number; productName: string; productImage: string | null; color: string | null; size: string | null; quantity: number; productPrice: number }>;
}> = {
  pending: {
    id: 4201, status: "pending", paymentStatus: "unconfirmed", createdAt: "2026-10-18T14:20:00-03:00", updatedAt: "2026-10-18T14:20:00-03:00", totalPrice: 25300, trackingCode: null,
    shippingAddress: { recipient: "Pessoa de Demonstração", street: "Rua das Montanhas", number: "140", complement: "", neighborhood: "Bairro Exemplo", city: "Brasília", state: "DF", zipCode: "70000-000" },
    shippingAtPurchase: { id: "visual-preview", label: "Transporte demonstrativo", minDays: 5, maxDays: 8 },
    items: [
      { id: 1, productId: 101, productName: "Camiseta de Demonstração — Clã 14 Bis", productImage: "/images/hero/camiseta-cla-14-bis-recorte.png", color: "Azul", size: "M", quantity: 1, productPrice: 18900 },
      { id: 2, productId: 102, productName: "Camiseta Básica de Demonstração", productImage: "/images/camisa.png", color: "Preta", size: "G", quantity: 1, productPrice: 5900 },
    ],
  },
  paid: {
    id: 4202, status: "paid", paymentStatus: "confirmed", createdAt: "2026-10-12T09:35:00-03:00", updatedAt: "2026-10-15T16:10:00-03:00", totalPrice: 24800, trackingCode: "RASTREIO-DEMO-4202",
    shippingAddress: { recipient: "Pessoa de Demonstração", street: "Rua das Montanhas", number: "140", complement: "", neighborhood: "Bairro Exemplo", city: "Brasília", state: "DF", zipCode: "70000-000" },
    shippingAtPurchase: { id: "visual-preview", label: "Transporte demonstrativo", minDays: 5, maxDays: 8 },
    items: [
      { id: 3, productId: 103, productName: "Camiseta de Demonstração — Clã 14 Bis", productImage: "/images/hero/camiseta-cla-14-bis-recorte.png", color: "Azul", size: "M", quantity: 1, productPrice: 18900 },
      { id: 4, productId: 104, productName: "Camiseta de Demonstração — Edição Urbana", productImage: "/images/camisa.png", color: "Preta", size: "G", quantity: 1, productPrice: 5900 },
    ],
  },
  cancelled: {
    id: 4203, status: "cancelled", paymentStatus: "unconfirmed", createdAt: "2026-10-03T11:10:00-03:00", updatedAt: "2026-10-03T11:42:00-03:00", totalPrice: 18900, trackingCode: null,
    shippingAddress: { recipient: "Pessoa de Demonstração", street: "Rua das Montanhas", number: "140", complement: "", neighborhood: "Bairro Exemplo", city: "Brasília", state: "DF", zipCode: "70000-000" },
    shippingAtPurchase: { id: "visual-preview", label: "Transporte demonstrativo", minDays: 5, maxDays: 8 },
    items: [{ id: 5, productId: 105, productName: "Camiseta de Demonstração — Clã 14 Bis", productImage: "/images/hero/camiseta-cla-14-bis-recorte.png", color: "Azul", size: "M", quantity: 1, productPrice: 18900 }],
  },
};

function formatPreviewDate(value: string) {
  return new Date(value).toLocaleString("pt-BR", {
    day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit",
    timeZone: "America/Sao_Paulo",
  });
}

export function OrderDetailPreview({ scenario }: { scenario: DetailPreviewScenario }) {
  const order = detailScenarios[scenario];
  const addressLines = [order.shippingAddress.recipient, `${order.shippingAddress.street}, ${order.shippingAddress.number}`, `${order.shippingAddress.neighborhood} · ${order.shippingAddress.city}/${order.shippingAddress.state} · CEP ${order.shippingAddress.zipCode}`];
  return <main className="l4-order-detail l4-order-detail-page">
    <p className="l4-account-preview-notice" role="note">PRÉVIA LOCAL · PEDIDO 100% FICTÍCIO · SEM SESSÃO, API OU ALTERAÇÕES</p>
    <header className="l4-detail-page-head"><div><p className="l4-detail-eyebrow">Minha conta · Pedidos</p><h1>Detalhes da compra</h1></div><Link to="/meus-pedidos?accountPreview=populated" className="l4-detail-action is-secondary">Voltar aos pedidos</Link></header>
    <article className="l4-order-detail-body">
      <section className="l4-detail-order-head"><div><p className="l4-detail-eyebrow">Compra demonstrativa</p><h2>Pedido #{order.id}</h2><p className="l4-detail-muted">Realizado em {formatPreviewDate(order.createdAt)}</p></div><span className={`l4-detail-status is-${order.status}`}>{getOrderStatusLabel(order.status)}</span></section>
      {order.status === "cancelled" ? <p className="l4-detail-cancel-note" role="note">{CANCELLATION_NOTICE}</p> : null}
      <section className="l4-detail-summary" aria-label="Resumo demonstrativo do pedido"><div className="l4-detail-total"><p>Total do pedido</p><strong>{new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(order.totalPrice / 100)}</strong></div><div><p>Situação do pagamento</p><strong>{order.paymentStatus === "confirmed" ? "Confirmado" : "Aguardando confirmação"}</strong></div><div><p>Rastreio</p><strong>{order.trackingCode || "Ainda não informado"}</strong></div><div><p>Última atualização</p><strong>{formatPreviewDate(order.updatedAt)}</strong></div></section>
      <section className="l4-detail-section"><div className="l4-detail-section-heading"><div><p className="l4-detail-eyebrow">Sua compra</p><h3>Produtos</h3></div><span>{order.items.length} {order.items.length === 1 ? "item" : "itens"}</span></div><div className="l4-detail-items">{order.items.map(item => <article key={item.id} className="l4-detail-item"><div className="l4-detail-product-image">{item.productImage ? <img src={item.productImage} alt={item.productName} /> : <div className="l4-detail-image-fallback" role="img" aria-label="Imagem indisponível"><Package size={21} aria-hidden="true" /></div>}</div><div className="l4-detail-item-info"><h4>{item.productName}</h4><p className="l4-detail-item-variant">{item.color} · {item.size}</p><p className="l4-detail-item-quantity">Quantidade: {item.quantity}</p></div><dl className="l4-detail-item-prices"><div><dt>Unitário</dt><dd>{new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(item.productPrice / 100)}</dd></div><div><dt>Subtotal</dt><dd>{new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(item.productPrice * item.quantity / 100)}</dd></div></dl></article>)}</div></section>
      <section className="l4-detail-section"><div className="l4-detail-section-heading"><div><p className="l4-detail-eyebrow">Destino e transporte</p><h3>Entrega</h3></div></div><div className="l4-detail-address">{addressLines.map(line => <p key={line}>{line}</p>)}</div><PurchasedTransportInfo option={order.shippingAtPurchase} status={order.status} /></section>
      <footer className="l4-detail-actions"><Link to="/meus-pedidos?accountPreview=populated" className="l4-detail-action is-secondary">Voltar aos pedidos</Link><Link to="/acompanhar-pedido" className="l4-detail-action is-primary">Acompanhar pedido</Link></footer>
    </article>
  </main>;
}

function PreviewOrderRow({ order }: { order: PreviewOrder }) {
  const label = previewStatus[order.status];
  return <article className="l4-order-row">
    <div className="l4-order-heading"><div><h2>Pedido #{order.id} <span aria-hidden="true">·</span> <time>{order.date}</time></h2></div><span className={`l4-order-status is-${order.status}`} aria-label={`Status do pedido: ${label}`}>{label}</span></div>
    <dl className="l4-order-summary"><div><dt>Total</dt><dd>{order.total}</dd></div><div><dt>Rastreio</dt><dd>{order.tracking}</dd></div></dl>
    <div className="l4-order-actions"><button className="l4-orders-button" type="button" disabled>Ver detalhes</button><button className="l4-orders-button is-primary" type="button" disabled>Acompanhar pedido</button></div>
  </article>;
}
