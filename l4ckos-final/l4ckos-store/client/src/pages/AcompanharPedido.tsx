import { FormEvent, useMemo, useState, type CSSProperties } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useTrackOrder } from "../hooks/useOrders";
import { useUser } from "../contexts/UserContext";

type OrderStatus = "pending" | "processing" | "paid" | "shipped" | "delivered" | "cancelled";

type TrackedOrderItem = {
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

const statusTone: Record<OrderStatus, { bg: string; color: string; border: string }> = {
  pending: { bg: "rgba(180, 83, 9, 0.14)", color: "#fbbf24", border: "rgba(180, 83, 9, 0.28)" },
  processing: { bg: "rgba(15, 118, 110, 0.14)", color: "#5eead4", border: "rgba(15, 118, 110, 0.28)" },
  paid: { bg: "rgba(21, 128, 61, 0.14)", color: "#86efac", border: "rgba(21, 128, 61, 0.28)" },
  shipped: { bg: "rgba(29, 78, 216, 0.14)", color: "#93c5fd", border: "rgba(29, 78, 216, 0.28)" },
  delivered: { bg: "rgba(22, 101, 52, 0.14)", color: "#bbf7d0", border: "rgba(22, 101, 52, 0.28)" },
  cancelled: { bg: "rgba(185, 28, 28, 0.14)", color: "#fca5a5", border: "rgba(185, 28, 28, 0.28)" },
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

function canEditShippingAddress(status?: string | null, issue?: string | null) {
  return !issue && (status === "awaiting_payment" || status === "ready");
}

function displayOrderStatus(paymentStatus?: string | null, fulfillmentStatus?: string | null): OrderStatus {
  if (fulfillmentStatus === "cancelled") return "cancelled";
  if (fulfillmentStatus === "delivered") return "delivered";
  if (fulfillmentStatus === "shipped") return "shipped";
  if (fulfillmentStatus === "processing") return "processing";
  if (fulfillmentStatus === "ready" && ["confirmed", "received", "partially_refunded"].includes(String(paymentStatus))) return "paid";
  return "pending";
}

export default function AcompanharPedido() {
  const { isAuthenticated } = useUser();
  const [params] = useSearchParams();

  const presetOrder = params.get("pedido") ?? "";
  const [searchMode, setSearchMode] = useState<"pedido" | "codigo">("pedido");
  const [searchValue, setSearchValue] = useState(presetOrder);
  const [payload, setPayload] = useState<{ orderId?: number; trackingCode?: string } | undefined>(
    presetOrder && Number.isFinite(Number(presetOrder)) ? { orderId: Number(presetOrder) } : undefined,
  );

  const query = useTrackOrder(payload);

  const currentStatus = displayOrderStatus(query.data?.payment?.status, query.data?.fulfillmentStatus);
  const timelineIndex = timelineSteps.findIndex(step => {
    if (currentStatus === "paid" && step.key === "processing") return true;
    return step.key === currentStatus;
  });

  const searchPlaceholder = useMemo(
    () => (searchMode === "pedido" ? "Ex: 1024" : "Ex: BR123456789"),
    [searchMode],
  );

  const orderItems: TrackedOrderItem[] = (query.data?.items ?? []).map(item => ({
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

  if (!isAuthenticated) {
    return (
      <section style={styles.wrapper}>
        <h1 style={styles.title}>Acompanhar pedido</h1>
        <p style={styles.muted}>Para acompanhar seus pedidos, entre com a sua conta.</p>
        <Link to="/login" style={styles.primaryButton}>
          Entrar
        </Link>
      </section>
    );
  }

  return (
    <section style={styles.wrapper}>
      <div style={styles.hero}>
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

      <form style={styles.form} onSubmit={handleSubmit}>
        <div style={styles.modeRow}>
          <button
            type="button"
            onClick={() => setSearchMode("pedido")}
            style={{ ...styles.modeButton, ...(searchMode === "pedido" ? styles.modeButtonActive : {}) }}
          >
            Numero do pedido
          </button>
          <button
            type="button"
            onClick={() => setSearchMode("codigo")}
            style={{ ...styles.modeButton, ...(searchMode === "codigo" ? styles.modeButtonActive : {}) }}
          >
            Codigo de rastreio
          </button>
        </div>

        <div style={styles.inputRow}>
          <input
            value={searchValue}
            onChange={event => setSearchValue(event.target.value)}
            placeholder={searchPlaceholder}
            style={styles.input}
          />
          <button type="submit" style={styles.primaryButton}>
            Consultar
          </button>
        </div>
      </form>

      {query.isLoading ? <p style={styles.muted}>Buscando pedido...</p> : null}
      {query.isError ? <p style={styles.error}>Não foi possível localizar este pedido na sua conta.</p> : null}

      {query.data ? (
        <article style={styles.card}>
          <div style={styles.cardHead}>
            <div>
              <p style={styles.cardLabel}>Pedido #{query.data.id}</p>
              <h2 style={styles.cardTitle}>{statusLabel[currentStatus]}</h2>
              <p style={styles.cardDescription}>{statusDescription[currentStatus]}</p>
            </div>
            <span
              style={{
                ...styles.badge,
                background: statusTone[currentStatus].bg,
                color: statusTone[currentStatus].color,
                borderColor: statusTone[currentStatus].border,
              }}
            >
              {statusLabel[currentStatus]}
            </span>
          </div>

          <div style={styles.summaryGrid}>
            <div style={styles.summaryCard}>
              <p style={styles.metaLabel}>Total do pedido</p>
              <p style={styles.metaStrong}>{formatMoney(Number(query.data.totalPrice))}</p>
            </div>
            <div style={styles.summaryCard}>
              <p style={styles.metaLabel}>Itens</p>
              <p style={styles.metaStrong}>
                {orderItems.length} produto{orderItems.length === 1 ? "" : "s"} • {totalUnits} unidade{totalUnits === 1 ? "" : "s"}
              </p>
            </div>
            <div style={styles.summaryCard}>
              <p style={styles.metaLabel}>Criado em</p>
              <p style={styles.metaStrong}>{formatDate(query.data.createdAt)}</p>
            </div>
            <div style={styles.summaryCard}>
              <p style={styles.metaLabel}>Ultima atualizacao</p>
              <p style={styles.metaStrong}>{formatDate(query.data.updatedAt)}</p>
            </div>
            <div style={styles.summaryCard}>
              <p style={styles.metaLabel}>Rastreio</p>
              <p style={styles.metaStrong}>{query.data.trackingCode || "Ainda não informado"}</p>
            </div>
          </div>

          {currentStatus !== "cancelled" ? (
            <div style={styles.timeline}>
              {timelineSteps.map((step, index) => {
                const normalizedTimelineIndex = currentStatus === "paid" ? 1 : timelineIndex;
                const active = normalizedTimelineIndex >= index;
                return (
                  <div key={step.key} style={styles.step}>
                    <div style={{ ...styles.dot, ...(active ? styles.dotActive : {}) }} />
                    <p style={{ ...styles.stepLabel, ...(active ? styles.stepLabelActive : {}) }}>{step.label}</p>
                    {index < timelineSteps.length - 1 ? (
                      <div style={{ ...styles.line, ...((normalizedTimelineIndex ?? -1) > index ? styles.lineActive : {}) }} />
                    ) : null}
                  </div>
                );
              })}
            </div>
          ) : (
            <p style={styles.cancelled}>Este pedido foi cancelado. Se precisar, fale com o suporte pelos canais oficiais.</p>
          )}

          <div style={styles.section}>
            <div style={styles.sectionHead}>
              <h3 style={styles.sectionTitle}>Entrega</h3>
              <span style={styles.sectionHint}>Endereço confirmado para esta compra.</span>
            </div>

            {query.data.shippingAddress ? (
              <div style={styles.addressBox}>
                {formatShippingAddress(query.data.shippingAddress).map(line => (
                  <p key={line} style={styles.addressLine}>{line}</p>
                ))}
              </div>
            ) : (
              <div style={styles.emptyBox}>Ainda não foi possível carregar o endereço deste pedido.</div>
            )}
          </div>

          <div style={styles.section}>
            <div style={styles.sectionHead}>
              <h3 style={styles.sectionTitle}>Itens do pedido</h3>
              <span style={styles.sectionHint}>Tudo o que foi selecionado nesta compra.</span>
            </div>

            {orderItems.length > 0 ? (
              <div style={styles.itemsList}>
                {orderItems.map(item => (
                  <div key={item.id} style={styles.itemCard}>
                    <div style={styles.itemIdentity}>
                      <div style={styles.itemImageWrap}>
                        {item.productImage ? (
                          <img src={item.productImage} alt={item.productName || `Produto ${item.productId}`} style={styles.itemImage} />
                        ) : (
                          <div style={styles.itemImageFallback}>SEM IMAGEM</div>
                        )}
                      </div>
                      <div style={styles.itemCopy}>
                        <p style={styles.itemName}>{item.productName || `Produto #${item.productId}`}</p>
                        <p style={styles.itemMeta}>Codigo interno: #{item.productId}</p>
                        <p style={styles.itemMeta}>Quantidade: {item.quantity}</p>
                      </div>
                    </div>
                    <div style={styles.itemValues}>
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

          <div style={styles.actions}>
          {canEditShippingAddress(query.data.fulfillmentStatus, query.data.fulfillmentIssue) ? (
              <Link to={`/meus-pedidos/${query.data.id}`} style={styles.secondaryButton}>
                 Ajustar endereço
              </Link>
            ) : null}
            <Link to="/meus-pedidos" style={styles.secondaryButton}>
              Ver meus pedidos
            </Link>
            <button type="button" style={styles.primaryButton} onClick={() => void query.refetch()}>
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
    maxWidth: 1080,
    margin: "0 auto",
    display: "grid",
    gap: 16,
    color: "#f0ede8",
  },
  hero: {
    display: "grid",
    gridTemplateColumns: "minmax(0, 1fr) minmax(240px, 320px)",
    gap: 16,
    alignItems: "end",
  },
  eyebrow: {
    margin: "0 0 8px 0",
    color: "#c7a76c",
    fontSize: 12,
    textTransform: "uppercase",
    letterSpacing: 1.6,
    fontWeight: 800,
  },
  heroHint: {
    border: "1px solid #2b2b2b",
    borderRadius: 12,
    background: "linear-gradient(135deg, #111111 0%, #161616 100%)",
    padding: 14,
    color: "#cbd5e1",
    fontSize: 13,
    lineHeight: 1.7,
  },
  title: {
    margin: 0,
    fontSize: 32,
    fontWeight: 800,
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
    gap: 10,
    background: "#111111",
    borderRadius: 14,
    border: "1px solid #2b2b2b",
    padding: 16,
  },
  modeRow: {
    display: "flex",
    gap: 8,
    flexWrap: "wrap",
  },
  modeButton: {
    border: "1px solid #2f2f2f",
    borderRadius: 999,
    background: "#0f0f0f",
    color: "#a1a1aa",
    fontWeight: 700,
    padding: "8px 12px",
    cursor: "pointer",
  },
  modeButtonActive: {
    background: "#1f2937",
    color: "white",
    borderColor: "#111827",
  },
  inputRow: {
    display: "grid",
    gridTemplateColumns: "1fr auto",
    gap: 8,
  },
  input: {
    border: "1px solid #2f2f2f",
    borderRadius: 10,
    fontSize: 15,
    padding: "12px 14px",
    outline: "none",
    background: "#0b0b0b",
    color: "#f0ede8",
  },
  card: {
    background: "linear-gradient(180deg, #101010 0%, #0b0b0b 100%)",
    border: "1px solid #2b2b2b",
    borderRadius: 16,
    padding: 18,
    display: "grid",
    gap: 18,
    boxShadow: "0 18px 40px rgba(0, 0, 0, 0.32)",
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
    margin: "6px 0 0 0",
    fontSize: 28,
    color: "#f0ede8",
    fontWeight: 900,
    lineHeight: 1.05,
  },
  cardDescription: {
    margin: "8px 0 0 0",
    color: "#cbd5e1",
    fontSize: 14,
    lineHeight: 1.7,
    maxWidth: 720,
  },
  badge: {
    borderRadius: 999,
    fontWeight: 800,
    fontSize: 12,
    padding: "9px 12px",
    border: "1px solid transparent",
  },
  summaryGrid: {
    display: "grid",
    gap: 12,
    gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
  },
  summaryCard: {
    border: "1px solid #252525",
    borderRadius: 12,
    background: "#111111",
    padding: 14,
  },
  metaLabel: {
    margin: 0,
    color: "#a1a1aa",
    fontSize: 12,
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  metaStrong: {
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
    background: "#2563eb",
    boxShadow: "0 0 0 4px rgba(37, 99, 235, 0.16)",
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
    background: "#2563eb",
  },
  stepLabel: {
    margin: 0,
    textAlign: "center",
    fontSize: 12,
    color: "#a1a1aa",
    fontWeight: 700,
  },
  stepLabelActive: {
    color: "#93c5fd",
  },
  cancelled: {
    margin: 0,
    borderRadius: 10,
    padding: "12px 14px",
    background: "rgba(127, 29, 29, 0.18)",
    border: "1px solid rgba(185, 28, 28, 0.28)",
    color: "#fca5a5",
    fontWeight: 700,
    fontSize: 13,
  },
  section: {
    display: "grid",
    gap: 12,
  },
  sectionHead: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 12,
    flexWrap: "wrap",
  },
  sectionTitle: {
    margin: 0,
    color: "#f0ede8",
    fontSize: 20,
    fontWeight: 800,
  },
  sectionHint: {
    color: "#9ca3af",
    fontSize: 13,
  },
  addressBox: {
    display: "grid",
    gap: 6,
    border: "1px solid #252525",
    borderRadius: 14,
    background: "#101010",
    padding: 14,
  },
  addressLine: {
    margin: 0,
    color: "#f0ede8",
    fontSize: 14,
    lineHeight: 1.6,
  },
  itemsList: {
    display: "grid",
    gap: 10,
  },
  itemCard: {
    display: "flex",
    justifyContent: "space-between",
    gap: 14,
    flexWrap: "wrap",
    border: "1px solid #252525",
    borderRadius: 14,
    background: "#101010",
    padding: 14,
  },
  itemIdentity: {
    display: "flex",
    gap: 12,
    alignItems: "center",
    minWidth: 0,
    flex: 1,
  },
  itemImageWrap: {
    width: 72,
    height: 72,
    borderRadius: 12,
    overflow: "hidden",
    border: "1px solid #262626",
    background: "#0a0a0a",
    flexShrink: 0,
  },
  itemImage: {
    width: "100%",
    height: "100%",
    objectFit: "cover",
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
    background: "linear-gradient(135deg, #1a1a1a 0%, #3a3a3a 100%)",
    color: "white",
    border: "none",
    borderRadius: 10,
    fontWeight: 800,
    fontSize: 14,
    padding: "11px 15px",
    textDecoration: "none",
    cursor: "pointer",
  },
  secondaryButton: {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    border: "1px solid #2f2f2f",
    color: "#f0ede8",
    borderRadius: 10,
    fontWeight: 700,
    fontSize: 14,
    padding: "11px 15px",
    textDecoration: "none",
    background: "#0f0f0f",
    cursor: "pointer",
  },
};
