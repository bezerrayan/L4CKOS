import "./Tracking.css";
import { PurchasedPreorderInfo, PurchasedMixedShippingNotice, PurchasedTransportInfo, type PurchasedPreorder } from "../components/PreorderInfo";
import { FormEvent, useMemo, useState, type CSSProperties } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useTrackOrder } from "../hooks/useOrders";
import { useUser } from "../contexts/UserContext";

type OrderStatus = "pending" | "processing" | "paid" | "shipped" | "delivered" | "cancelled";

type TrackedOrderItem = PurchasedPreorder & {
  id: number;
  productId: number;
  quantity: number;
  status?: string | null;
  expiresAt?: string | Date | null;
  productName?: string | null;
  productImage?: string | null;
  productPrice?: number | null;
};

const statusLabel: Record<OrderStatus, string> = {
  pending: "Aguardando pagamento",
  processing: "Pedido em separacao",
  paid: "Pagamento confirmado",
  shipped: "Pedido em transporte",
  delivered: "Entrega concluida",
  cancelled: "Pedido cancelado",
};

const statusDescription: Record<OrderStatus, string> = {
  pending: "Estamos aguardando a confirmacao do pagamento para liberar a separacao.",
  processing: "Pagamento recebido. Seu pedido esta em preparacao pela equipe.",
  paid: "Pagamento compensado com sucesso. O pedido segue para separacao.",
  shipped: "Seu pedido foi despachado e esta a caminho do endereco informado.",
  delivered: "Entrega concluida. Esperamos que tudo tenha chegado corretamente.",
  cancelled: "Este pedido foi cancelado. Se precisar, fale com o suporte.",
};

const statusTone: Record<OrderStatus, { color: string }> = {
  pending: { color: "#fbbf24" },
  processing: { color: "#5eead4" },
  paid: { color: "#86efac" },
  shipped: { color: "#93c5fd" },
  delivered: { color: "#bbf7d0" },
  cancelled: { color: "#fca5a5" },
};

const timelineSteps: Array<{ key: Exclude<OrderStatus, "cancelled">; label: string }> = [
  { key: "pending", label: "Pagamento" },
  { key: "processing", label: "Separacao" },
  { key: "shipped", label: "Transporte" },
  { key: "delivered", label: "Entrega" },
];

function formatMoney(cents: number) {
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
  }).format((Number(cents) || 0) / 100);
}

function formatDate(value: unknown) {
  if (!value) return "-";
  const date = new Date(value as string);
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleDateString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function resolveItemSubtotal(item: TrackedOrderItem) {
  return Number(item.productPrice || 0) * Number(item.quantity || 0);
}

function formatShippingAddress(address?: {
  recipient?: string | null;
  street?: string | null;
  number?: string | null;
  complement?: string | null;
  neighborhood?: string | null;
  city?: string | null;
  state?: string | null;
  zipCode?: string | null;
} | null) {
  if (!address) return [];

  return [
    address.recipient || "",
    [address.street, address.number].filter(Boolean).join(", "),
    [address.complement, address.neighborhood].filter(Boolean).join(" • "),
    [[address.city, address.state].filter(Boolean).join(" - "), address.zipCode ? `CEP ${address.zipCode}` : ""].filter(Boolean).join(" • "),
  ].filter(Boolean);
}

function canEditShippingAddress(status?: string | null) {
  return status === "pending" || status === "paid";
}

export default function AcompanharPedido() {
  const { isAuthenticated } = useUser();
  const [params] = useSearchParams();

  const requestedPreview = import.meta.env.DEV ? params.get("trackingPreview") : null;
  const previewStatus = requestedPreview === "cancelled" || requestedPreview === "processing"
    ? requestedPreview
    : null;

  const presetOrder = params.get("pedido") ?? "";
  const [searchMode, setSearchMode] = useState<"pedido" | "codigo">("pedido");
  const [searchValue, setSearchValue] = useState(presetOrder);
  const [payload, setPayload] = useState<{ orderId?: number; trackingCode?: string } | undefined>(
    !previewStatus && presetOrder && Number.isFinite(Number(presetOrder)) ? { orderId: Number(presetOrder) } : undefined,
  );

  const query = useTrackOrder(payload);

  const previewOrder = previewStatus ? ({
    id: previewStatus === "cancelled" ? 9001 : 9002,
    status: previewStatus,
    totalPrice: 17980,
    createdAt: "2026-10-12T12:00:00.000Z",
    updatedAt: "2026-10-13T15:30:00.000Z",
    trackingCode: previewStatus === "processing" ? "DEMO-0000" : null,
    shippingAddress: {
      recipient: "Cliente fictício",
      street: "Rua de demonstração",
      number: "00",
      complement: "",
      neighborhood: "Centro",
      city: "Brasília",
      state: "DF",
      zipCode: "70000-000",
    },
    shippingAtPurchase: { id: "demo", label: "Entrega de demonstração", minDays: 5, maxDays: 8 },
    items: [{
      id: 99001,
      productId: 990,
      quantity: 2,
      status: previewStatus,
      productName: "Camiseta de demonstração — dados fictícios",
      productImage: null,
      productPrice: 8990,
      salesModeAtPurchase: "STANDARD",
    }],
  } as unknown as NonNullable<typeof query.data>) : null;
  const orderData = previewOrder ?? query.data;
  const isVisualPreview = Boolean(previewOrder);

  const currentStatus = (orderData?.status as OrderStatus | undefined) ?? "pending";
  const hasPreorder = orderData?.items.some(item => item.salesModeAtPurchase === "PREORDER") ?? false;
  const awaitingProduction = ["paid", "processing"].includes(currentStatus) && (orderData?.items.some(item => item.salesModeAtPurchase === "PREORDER" && !["RECEIVED", "SHIPPING", "COMPLETED"].includes(item.productionStatus ?? "")) ?? false);
  const displayedStatus = awaitingProduction ? "Acompanhando produção" : statusLabel[currentStatus];
  const displayedTone = hasPreorder && currentStatus !== "cancelled" ? { color: "#E6D6C2" } : statusTone[currentStatus];
  const timelineIndex = timelineSteps.findIndex(step => {
    if (currentStatus === "paid" && step.key === "processing") return true;
    return step.key === currentStatus;
  });

  const searchPlaceholder = useMemo(
    () => (searchMode === "pedido" ? "Ex: 1024" : "Ex: BR123456789"),
    [searchMode],
  );

  const orderItems: TrackedOrderItem[] = (orderData?.items ?? []).map(item => ({
    ...item,
    id: item.id,
    productId: item.productId,
    quantity: item.quantity,
    status: item.status,
    expiresAt: item.expiresAt,
    productName: item.productName,
    productImage: item.productImage,
    productPrice: item.productPrice,
  }));
  const totalUnits = orderItems.reduce((sum, item) => sum + Number(item.quantity || 0), 0);

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    const trimmed = searchValue.trim();
    if (!trimmed) return;

    if (searchMode === "pedido") {
      const orderId = Number(trimmed);
      if (!Number.isInteger(orderId) || orderId <= 0) return;
      setPayload({ orderId });
      return;
    }

    setPayload({ trackingCode: trimmed });
  };

  if (!isAuthenticated && !(import.meta.env.DEV && isVisualPreview)) {
    return (
      <section className="l4-tracking l4-tracking-guest">
        <div className="l4-tracking-guest-content">
          <p className="l4-tracking-guest-eyebrow">Pós-venda</p>
          <h1 className="l4-tracking-guest-title">Acompanhe seu pedido</h1>
          <p className="l4-tracking-guest-copy">
            Entre na sua conta para consultar seus pedidos e acompanhar as atualizações.
          </p>
          <Link to="/login" className="l4-tracking-guest-primary">
            Entrar para acompanhar <span aria-hidden="true">→</span>
          </Link>
          <p className="l4-tracking-guest-help">
            Precisa de ajuda? <Link to="/contato">Fale com a L4CKOS</Link>.
          </p>
        </div>
      </section>
    );
  }

  return (
    <section className="l4-tracking l4-tracking-auth" style={styles.wrapper}>
      {import.meta.env.DEV && isVisualPreview ? <p className="l4-tracking-preview-note">Pré-visualização local · dados inteiramente fictícios</p> : null}
      <div className="l4-tracking-hero" style={styles.hero}>
        <div>
          <p style={styles.eyebrow}>Pos-venda</p>
          <h1 style={styles.title}>Acompanhar pedido</h1>
          <p style={styles.muted}>
            Consulte status, itens, rastreio e ultima atualizacao do pedido vinculado a sua conta.
          </p>
        </div>
        <div style={styles.heroHint}>
          Os pedidos em aberto atualizam automaticamente enquanto o pagamento ou a separacao estiverem em andamento.
        </div>
      </div>

      <form className="l4-tracking-search" style={styles.form} onSubmit={handleSubmit} aria-label="Consultar pedido">
        <div className="l4-tracking-mode-row" style={styles.modeRow} role="group" aria-label="Tipo de consulta">
          <button
            type="button"
            aria-pressed={searchMode === "pedido"}
            onClick={() => setSearchMode("pedido")}
            style={{ ...styles.modeButton, ...(searchMode === "pedido" ? styles.modeButtonActive : {}) }}
          >
            Numero do pedido
          </button>
          <button
            type="button"
            aria-pressed={searchMode === "codigo"}
            onClick={() => setSearchMode("codigo")}
            style={{ ...styles.modeButton, ...(searchMode === "codigo" ? styles.modeButtonActive : {}) }}
          >
            Codigo de rastreio
          </button>
        </div>

        <div className="l4-tracking-inputRow" style={styles.inputRow}>
          <input
            value={searchValue}
            onChange={event => setSearchValue(event.target.value)}
            placeholder={searchPlaceholder}
            aria-label={searchMode === "pedido" ? "Número do pedido" : "Código de rastreio"}
            style={styles.input}
          />
          <button type="submit" style={styles.primaryButton}>
            Consultar
          </button>
        </div>
      </form>

      {query.isLoading ? <p style={styles.muted}>Buscando pedido...</p> : null}
      {query.isError ? <p style={styles.error} role="alert">Não foi possível localizar este pedido na sua conta.</p> : null}

      {orderData ? (
        <article className="l4-tracking-result" style={styles.card}>
          <div className="l4-tracking-result-head" style={styles.cardHead}>
            <div>
              <p style={styles.cardLabel}>Pedido #{orderData.id}</p>
              <h2 className="l4-tracking-status-title" style={{ ...styles.cardTitle, color: displayedTone.color }}>{displayedStatus}</h2>
              <p style={styles.cardDescription}>{["paid", "processing"].includes(currentStatus) && orderData.items.some(item => item.salesModeAtPurchase === "PREORDER") ? "Pagamento confirmado. Acompanhe a produção dos itens de pré-venda abaixo." : statusDescription[currentStatus]}</p>
            </div>
          </div>

          <PurchasedMixedShippingNotice items={orderData.items} />
          <PurchasedTransportInfo option={orderData.shippingAtPurchase} status={currentStatus} />
          <div className="l4-tracking-summary" style={styles.summaryGrid}>
            <div className="l4-tracking-summary-item" style={styles.summaryCard}>
              <p style={styles.metaLabel}>Total do pedido</p>
              <p style={styles.metaStrong}>{formatMoney(Number(orderData.totalPrice))}</p>
            </div>
            <div className="l4-tracking-summary-item" style={styles.summaryCard}>
              <p style={styles.metaLabel}>Itens</p>
              <p style={styles.metaStrong}>
                {orderItems.length} produto{orderItems.length === 1 ? "" : "s"} • {totalUnits} unidade{totalUnits === 1 ? "" : "s"}
              </p>
            </div>
            <div className="l4-tracking-summary-item" style={styles.summaryCard}>
              <p style={styles.metaLabel}>Criado em</p>
              <p style={styles.metaStrong}>{formatDate(orderData.createdAt)}</p>
            </div>
            <div className="l4-tracking-summary-item" style={styles.summaryCard}>
              <p style={styles.metaLabel}>Ultima atualizacao</p>
              <p style={styles.metaStrong}>{formatDate(orderData.updatedAt)}</p>
            </div>
            <div className="l4-tracking-summary-item" style={styles.summaryCard}>
              <p style={styles.metaLabel}>Rastreio</p>
              <p style={styles.metaStrong}>{orderData.trackingCode || "Ainda não informado"}</p>
            </div>
          </div>

          {currentStatus !== "cancelled" ? (
            <div className="l4-tracking-timeline" style={styles.timeline}>
              {timelineSteps.map((step, index) => {
                const normalizedTimelineIndex = awaitingProduction ? 0 : currentStatus === "paid" ? 1 : timelineIndex;
                const active = normalizedTimelineIndex >= index;
                return (
                  <div key={step.key} className="l4-tracking-step" style={styles.step}>
                    <div style={{ ...styles.dot, ...(active ? { ...styles.dotActive, ...(hasPreorder ? { background: "#E6D6C2", boxShadow: "0 0 0 4px rgba(230,214,194,.12)" } : {}) } : {}) }} />
                    <p style={{ ...styles.stepLabel, ...(active ? { ...styles.stepLabelActive, ...(hasPreorder ? { color: "#E6D6C2" } : {}) } : {}) }}>{step.label}</p>
                    {index < timelineSteps.length - 1 ? (
                      <div className="l4-tracking-line" style={{ ...styles.line, ...((normalizedTimelineIndex ?? -1) > index ? { ...styles.lineActive, ...(hasPreorder ? { background: "#E6D6C2" } : {}) } : {}) }} />
                    ) : null}
                  </div>
                );
              })}
            </div>
          ) : null}

          <div className="l4-tracking-section" style={styles.section}>
            <div className="l4-tracking-section-head" style={styles.sectionHead}>
              <h3 style={styles.sectionTitle}>Entrega</h3>
              <span style={styles.sectionHint}>Endereço confirmado para esta compra.</span>
            </div>

            {orderData.shippingAddress ? (
              <div style={styles.addressBox}>
                {formatShippingAddress(orderData.shippingAddress).map(line => (
                  <p key={line} style={styles.addressLine}>{line}</p>
                ))}
              </div>
            ) : (
              <div style={styles.emptyBox}>Ainda não foi possível carregar o endereço deste pedido.</div>
            )}
          </div>

          <div className="l4-tracking-section" style={styles.section}>
            <div className="l4-tracking-section-head" style={styles.sectionHead}>
              <h3 style={styles.sectionTitle}>Itens do pedido</h3>
              <span style={styles.sectionHint}>Tudo o que foi selecionado nesta compra.</span>
            </div>

          {orderItems.length > 0 ? (
              <div style={styles.itemsList}>
                {orderItems.map(item => (
                  <div key={item.id} className="l4-tracking-itemCard" style={styles.itemCard}>
                    <div className="l4-tracking-itemIdentity" style={styles.itemIdentity}>
                      <div style={styles.itemImageWrap}>
                        {item.productImage ? (
                          <img src={item.productImage} alt={item.productName || `Produto ${item.productId}`} style={styles.itemImage} />
                        ) : (
                          <div style={styles.itemImageFallback}>SEM IMAGEM</div>
                        )}
                      </div>
                      <div style={styles.itemCopy}>
                        <p style={styles.itemName}>{item.productName || `Produto #${item.productId}`}</p>
                        <PurchasedPreorderInfo item={item} status={currentStatus} />
                        <p style={styles.itemMeta}>Codigo interno: #{item.productId}</p>
                        <p style={styles.itemMeta}>Quantidade: {item.quantity}</p>
                      </div>
                    </div>
                    <div className="l4-tracking-itemValues" style={styles.itemValues}>
                      <p style={styles.itemPrice}>{formatMoney(resolveItemSubtotal(item))}</p>
                      <p style={styles.itemMeta}>
                        {item.productPrice ? `${formatMoney(Number(item.productPrice))} por unidade` : "Valor unitario indisponivel"}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div style={styles.emptyBox}>
                Os itens deste pedido ainda não puderam ser carregados. Atualize novamente em instantes.
              </div>
            )}
          </div>

          <div className="l4-tracking-actions" style={styles.actions}>
            {!isVisualPreview && canEditShippingAddress(orderData.status) ? (
              <Link to={`/meus-pedidos/${orderData.id}`} style={styles.secondaryButton}>
                 Ajustar endereço
              </Link>
            ) : null}
            <Link to="/meus-pedidos" style={styles.secondaryButton}>
              Ver meus pedidos
            </Link>
            <button type="button" style={styles.primaryButton} onClick={() => void query.refetch()} disabled={isVisualPreview}>
              Atualizar agora
            </button>
          </div>
        </article>
      ) : null}
    </section>
  );
}

const styles: Record<string, CSSProperties> = {
  wrapper: {
    maxWidth: 1240,
    margin: "0 auto",
    display: "grid",
    gap: "clamp(24px, 4vw, 42px)",
    color: "#f0ede8",
  },
  hero: {
    display: "grid",
    gridTemplateColumns: "minmax(0, 1fr)",
    gap: 10,
    alignItems: "start",
  },
  eyebrow: {
    margin: "0 0 8px 0",
    color: "#e8002a",
    fontSize: 12,
    textTransform: "uppercase",
    letterSpacing: 1.6,
    fontWeight: 800,
  },
  heroHint: {
    border: "none",
    borderRadius: 0,
    background: "transparent",
    padding: 0,
    color: "#a9a6a2",
    fontSize: 13,
    lineHeight: 1.55,
  },
  title: {
    margin: 0,
    fontFamily: "Bebas Neue, sans-serif",
    fontSize: 44,
    fontWeight: 400,
    lineHeight: 1,
    letterSpacing: 0.3,
    color: "#f0ede8",
  },
  muted: {
    margin: 0,
    color: "#a1a1aa",
    fontSize: 15,
    lineHeight: 1.6,
  },
  error: {
    margin: 0,
    color: "#fca5a5",
    fontWeight: 700,
    fontSize: 14,
  },
  form: {
    display: "grid",
    gap: 14,
    background: "transparent",
    borderRadius: 0,
    border: "none",
    padding: "8px 0 0",
    maxWidth: 760,
  },
  modeRow: {
    display: "flex",
    gap: 22,
    flexWrap: "wrap",
  },
  modeButton: {
    border: "none",
    borderRadius: 0,
    background: "transparent",
    color: "#aaa6a2",
    fontWeight: 700,
    fontSize: 13,
    padding: "10px 0",
    cursor: "pointer",
  },
  modeButtonActive: {
    background: "transparent",
    color: "white",
  },
  inputRow: {
    display: "grid",
    gridTemplateColumns: "1fr auto",
    gap: 8,
  },
  input: {
    minWidth: 0,
    border: "1px solid #383838",
    borderRadius: 0,
    fontSize: 15,
    padding: "12px 14px",
    background: "#0b0b0b",
    color: "#f0ede8",
  },
  card: {
    background: "transparent",
    border: "none",
    borderTop: "1px solid #303030",
    borderRadius: 0,
    padding: "24px 0 0",
    display: "grid",
    gap: 24,
    boxShadow: "none",
  },
  cardHead: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "flex-start",
    gap: 16,
    flexWrap: "wrap",
  },
  cardLabel: {
    margin: 0,
    color: "#a1a1aa",
    fontSize: 12,
    textTransform: "uppercase",
    letterSpacing: 1.4,
    fontWeight: 700,
  },
  cardTitle: {
    margin: "8px 0 0",
    fontFamily: "Bebas Neue, sans-serif",
    fontSize: 36,
    color: "#f0ede8",
    fontWeight: 400,
    lineHeight: 1,
    letterSpacing: 0.3,
  },
  cardDescription: {
    margin: "8px 0 0 0",
    color: "#cbd5e1",
    fontSize: 14,
    lineHeight: 1.7,
    maxWidth: 720,
  },
  summaryGrid: {
    display: "grid",
    gap: "18px 0",
    gridTemplateColumns: "repeat(5, minmax(0, 1fr))",
    paddingBlock: 18,
    borderTop: "1px solid #2a2a2a",
    borderBottom: "1px solid #2a2a2a",
  },
  summaryCard: {
    borderRadius: 0,
    background: "transparent",
    padding: "0 14px",
  },
  metaLabel: {
    margin: 0,
    color: "#a1a1aa",
    fontSize: 12,
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  metaStrong: {
    overflowWrap: "anywhere",
    margin: "6px 0 0",
    color: "#f0ede8",
    fontWeight: 800,
    fontSize: 15,
    lineHeight: 1.5,
  },
  timeline: {
    display: "grid",
    gridTemplateColumns: "repeat(4, minmax(90px, 1fr))",
    gap: 10,
    paddingTop: 8,
  },
  step: {
    position: "relative",
    display: "grid",
    gap: 8,
    justifyItems: "center",
  },
  dot: {
    width: 14,
    height: 14,
    borderRadius: "50%",
    background: "#3f3f46",
    zIndex: 1,
  },
  dotActive: {
    background: "#e8002a",
    boxShadow: "0 0 0 4px rgba(232, 0, 42, 0.14)",
  },
  line: {
    position: "absolute",
    top: 6,
    right: "-52%",
    width: "100%",
    height: 2,
    background: "#3f3f46",
  },
  lineActive: {
    background: "#e8002a",
  },
  stepLabel: {
    margin: 0,
    textAlign: "center",
    fontSize: 12,
    color: "#a1a1aa",
    fontWeight: 700,
  },
  stepLabelActive: {
    color: "#f0ede8",
  },
  section: {
    display: "grid",
    gap: 16,
    paddingTop: 8,
  },
  sectionHead: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 12,
    flexWrap: "wrap",
    paddingBottom: 10,
    borderBottom: "1px solid #292929",
  },
  sectionTitle: {
    margin: 0,
    color: "#f0ede8",
    fontFamily: "Bebas Neue, sans-serif",
    fontSize: 24,
    fontWeight: 400,
    letterSpacing: 0.25,
  },
  sectionHint: {
    color: "#9ca3af",
    fontSize: 13,
  },
  addressBox: {
    display: "grid",
    gap: 6,
    border: "none",
    borderRadius: 0,
    background: "transparent",
    padding: "2px 0",
  },
  addressLine: {
    margin: 0,
    color: "#f0ede8",
    fontSize: 14,
    lineHeight: 1.6,
  },
  itemsList: {
    display: "grid",
    gap: 0,
  },
  itemCard: {
    display: "flex",
    justifyContent: "space-between",
    gap: 14,
    flexWrap: "wrap",
    border: "none",
    borderBottom: "1px solid #292929",
    borderRadius: 0,
    background: "transparent",
    padding: "16px 0",
  },
  itemIdentity: {
    display: "flex",
    gap: 12,
    alignItems: "center",
    minWidth: 0,
    flex: 1,
  },
  itemImageWrap: {
    width: 84,
    height: 96,
    borderRadius: 0,
    overflow: "hidden",
    border: "none",
    background: "transparent",
    flexShrink: 0,
  },
  itemImage: {
    width: "100%",
    height: "100%",
    objectFit: "contain",
    display: "block",
  },
  itemImageFallback: {
    width: "100%",
    height: "100%",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    color: "#6b7280",
    fontSize: 10,
    fontWeight: 700,
    textAlign: "center",
    padding: 8,
  },
  itemCopy: {
    minWidth: 0,
    overflowWrap: "anywhere",
    display: "grid",
    gap: 4,
  },
  itemName: {
    margin: 0,
    color: "#f0ede8",
    fontWeight: 800,
    fontSize: 15,
  },
  itemMeta: {
    margin: 0,
    color: "#9ca3af",
    fontSize: 13,
    lineHeight: 1.5,
  },
  itemValues: {
    display: "grid",
    gap: 4,
    minWidth: 150,
    justifyItems: "end",
    alignSelf: "center",
  },
  itemPrice: {
    margin: 0,
    color: "#f0ede8",
    fontWeight: 900,
    fontSize: 17,
  },
  emptyBox: {
    border: "1px dashed #303030",
    borderRadius: 12,
    background: "#0f0f0f",
    color: "#9ca3af",
    padding: 14,
    fontSize: 13,
    lineHeight: 1.6,
  },
  actions: {
    display: "flex",
    justifyContent: "space-between",
    gap: 10,
    flexWrap: "wrap",
  },
  primaryButton: {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    background: "#e8002a",
    color: "white",
    border: "none",
    borderRadius: 0,
    fontWeight: 800,
    fontSize: 14,
    minHeight: 46,
    padding: "11px 18px",
    textDecoration: "none",
    cursor: "pointer",
  },
  secondaryButton: {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    border: "1px solid #2f2f2f",
    color: "#f0ede8",
    borderRadius: 0,
    fontWeight: 700,
    fontSize: 14,
    minHeight: 46,
    padding: "11px 18px",
    textDecoration: "none",
    background: "transparent",
    cursor: "pointer",
  },
};
