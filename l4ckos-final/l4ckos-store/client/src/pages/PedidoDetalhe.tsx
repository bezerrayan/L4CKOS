import { Link, useParams } from "react-router-dom";
import type { CSSProperties } from "react";
import { useEffect, useState } from "react";
import { useOrderDetail } from "../hooks/useOrders";
import { trpc } from "../lib/trpc";
import { ReviewPurchaseArea } from "../components/reviews/ReviewPurchaseArea";
type OrderStatus = "pending" | "processing" | "paid" | "shipped" | "delivered" | "cancelled";

const statusText: Record<OrderStatus, string> = {
  pending: "Aguardando pagamento",
  processing: "Pago e em separacao",
  paid: "Pagamento confirmado",
  shipped: "Enviado",
  delivered: "Entregue",
  cancelled: "Cancelado",
};

function formatDate(value: unknown) {
  if (!value) return "-";
  const date = new Date(value as string);
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleString("pt-BR");
}

function formatMoney(cents: number) {
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
  }).format((Number(cents) || 0) / 100);
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

export default function PedidoDetalhe() {
  const params = useParams<{ id: string }>();
  const orderId = Number(params.id);
  const query = useOrderDetail(Number.isFinite(orderId) ? orderId : undefined);
  const utils = trpc.useUtils();
  const [isEditingAddress, setIsEditingAddress] = useState(false);
  const [addressForm, setAddressForm] = useState({
    recipient: "",
    street: "",
    number: "",
    complement: "",
    neighborhood: "",
  });

  useEffect(() => {
    const address = query.data?.shippingAddress;
    if (!address) return;

    setAddressForm({
      recipient: address.recipient || "",
      street: address.street || "",
      number: address.number || "",
      complement: address.complement || "",
      neighborhood: address.neighborhood || "",
    });
  }, [query.data?.id, query.data?.shippingAddress]);

  const updateShippingAddressMutation = trpc.orders.updateShippingAddress.useMutation({
    onSuccess: async () => {
      setIsEditingAddress(false);
      await Promise.all([
        utils.orders.detail.invalidate(orderId),
        utils.orders.list.invalidate(),
      ]);
    },
  });

  return (
    <section style={styles.wrapper}>
      <div style={styles.head}>
        <h1 style={styles.title}>Detalhes do pedido</h1>
        <Link to="/meus-pedidos" style={styles.linkButton}>
          Voltar para pedidos
        </Link>
      </div>

      {query.isLoading ? <p style={styles.muted}>Carregando pedido...</p> : null}
      {query.isError ? <p style={styles.error}>Não foi possível carregar este pedido agora.</p> : null}

      {query.data ? (
        <article style={styles.card}>
          <div style={styles.row}>
            <div>
              <h2 style={styles.orderId}>Pedido #{query.data.id}</h2>
              <p style={styles.muted}>Criado em {formatDate(query.data.createdAt)}</p>
            </div>
            <span style={styles.badge}>{statusText[query.data.status as OrderStatus]}</span>
          </div>

          <div style={styles.metaGrid}>
            <div>
              <p style={styles.metaLabel}>Total pago</p>
              <p style={styles.metaValue}>{formatMoney(Number(query.data.totalPrice))}</p>
            </div>
            <div>
              <p style={styles.metaLabel}>Rastreio</p>
              <p style={styles.metaValue}>{query.data.trackingCode || "Não informado"}</p>
            </div>
            <div>
              <p style={styles.metaLabel}>Ultima atualizacao</p>
              <p style={styles.metaValue}>{formatDate(query.data.updatedAt)}</p>
            </div>
          </div>

          <div style={styles.addressCard}>
            <div style={styles.sectionHeader}>
              <h3 style={styles.sectionTitle}>Entrega</h3>
              <div style={styles.addressActions}>
                <span style={styles.sectionHint}>Confira se este é o endereço correto do pedido.</span>
                {canEditShippingAddress(query.data.status) ? (
                  <button
                    type="button"
                    style={styles.editButton}
                    onClick={() => setIsEditingAddress(current => !current)}
                  >
                    {isEditingAddress ? "Cancelar" : "Ajustar endereço"}
                  </button>
                ) : null}
              </div>
            </div>
            {query.data.shippingAddress ? (
              <div style={styles.addressLines}>
                {formatShippingAddress(query.data.shippingAddress).map(line => (
                  <p key={line} style={styles.addressText}>{line}</p>
                ))}
              </div>
            ) : (
              <p style={styles.muted}>Endereco de entrega indisponivel no momento.</p>
            )}
            {canEditShippingAddress(query.data.status) ? (
              <p style={styles.addressRule}>
                Voce pode ajustar destinatario, rua, numero, complemento e bairro ate o pedido entrar em separacao.
                CEP, cidade e UF ficam travados para não alterar o frete da cobrança.
              </p>
            ) : null}
            {isEditingAddress && canEditShippingAddress(query.data.status) ? (
              <form
                style={styles.addressForm}
                onSubmit={event => {
                  event.preventDefault();
                  updateShippingAddressMutation.mutate({
                    orderId: query.data.id,
                    address: {
                      recipient: addressForm.recipient.trim(),
                      street: addressForm.street.trim(),
                      number: addressForm.number.trim(),
                      complement: addressForm.complement.trim() || undefined,
                      neighborhood: addressForm.neighborhood.trim(),
                    },
                  });
                }}
              >
                <input
                  style={styles.input}
                  placeholder="Destinatário"
                  value={addressForm.recipient}
                  onChange={event => setAddressForm(current => ({ ...current, recipient: event.target.value }))}
                />
                <input
                  style={styles.input}
                  placeholder="Rua"
                  value={addressForm.street}
                  onChange={event => setAddressForm(current => ({ ...current, street: event.target.value }))}
                />
                <input
                  style={styles.input}
                  placeholder="Número"
                  value={addressForm.number}
                  onChange={event => setAddressForm(current => ({ ...current, number: event.target.value }))}
                />
                <input
                  style={styles.input}
                  placeholder="Complemento (opcional)"
                  value={addressForm.complement}
                  onChange={event => setAddressForm(current => ({ ...current, complement: event.target.value }))}
                />
                <input
                  style={styles.input}
                  placeholder="Bairro"
                  value={addressForm.neighborhood}
                  onChange={event => setAddressForm(current => ({ ...current, neighborhood: event.target.value }))}
                />
                <div style={styles.readonlyRow}>
                  <span style={styles.readonlyChip}>{query.data.shippingAddress?.zipCode ? `CEP ${query.data.shippingAddress.zipCode}` : "CEP não informado"}</span>
                  <span style={styles.readonlyChip}>
                    {[query.data.shippingAddress?.city, query.data.shippingAddress?.state].filter(Boolean).join(" - ") || "Cidade/UF não informados"}
                  </span>
                </div>
                {updateShippingAddressMutation.error ? (
                  <p style={styles.error}>{updateShippingAddressMutation.error.message}</p>
                ) : null}
                <div style={styles.formActions}>
                  <button type="submit" style={styles.saveButton} disabled={updateShippingAddressMutation.isPending}>
                    {updateShippingAddressMutation.isPending ? "Salvando..." : "Salvar endereço"}
                  </button>
                </div>
              </form>
            ) : null}
          </div>

          <h3 style={styles.sectionTitle}>Itens deste pedido</h3>
          {query.data.items?.length ? (
            <div style={styles.itemsList}>
              {query.data.items.map(item => (
                <div key={item.id} style={styles.itemRow}>
                  <div>
                  <p style={styles.itemName}>{item.productName || `Produto #${item.productId}`}</p>
                  <p style={styles.itemMeta}>Quantidade: {item.quantity}</p>
                </div>
                  <p style={styles.itemPrice}>{formatMoney(Number(item.productPrice || 0) * Number(item.quantity || 0))}</p>
                </div>
              ))}
            </div>
          ) : (
            <p style={styles.muted}>Os itens deste pedido não estão disponíveis no momento.</p>
          )}
          {query.data.status === "delivered" ? <ReviewPurchaseArea orderId={query.data.id} /> : null}
        </article>
      ) : null}
    </section>
  );
}

const styles: Record<string, CSSProperties> = {
  wrapper: { maxWidth: 980, margin: "0 auto", display: "grid", gap: 14, color: "#f0ede8" },
  head: { display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" },
  title: { margin: 0, fontSize: 32, color: "#f0ede8", fontWeight: 800 },
  muted: { margin: 0, color: "#a1a1aa" },
  error: { margin: 0, color: "#b91c1c", fontWeight: 700 },
  card: { border: "1px solid #2f2f2f", borderRadius: 12, background: "#101010", padding: 16, display: "grid", gap: 14 },
  row: { display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 10, flexWrap: "wrap" },
  orderId: { margin: 0, fontSize: 22, color: "#f0ede8" },
  badge: { borderRadius: 999, background: "#1e293b", color: "#93c5fd", fontWeight: 700, fontSize: 12, padding: "7px 11px" },
  metaGrid: { display: "grid", gap: 12, gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))" },
  metaLabel: { margin: 0, color: "#a1a1aa", fontSize: 12, textTransform: "uppercase", letterSpacing: 0.4 },
  metaValue: { margin: "4px 0 0", color: "#f0ede8", fontWeight: 700 },
  sectionHeader: { display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 10, flexWrap: "wrap" },
  sectionHint: { color: "#a1a1aa", fontSize: 12 },
  sectionTitle: { margin: 0, color: "#f0ede8", fontSize: 18 },
  addressCard: { border: "1px solid #2f2f2f", borderRadius: 10, padding: 12, display: "grid", gap: 10, background: "#0f0f0f" },
  addressActions: { display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, flexWrap: "wrap", width: "100%" },
  addressLines: { display: "grid", gap: 4 },
  addressText: { margin: 0, color: "#f0ede8", lineHeight: 1.6 },
  addressRule: { margin: 0, color: "#a1a1aa", fontSize: 12, lineHeight: 1.6 },
  addressForm: { display: "grid", gap: 10, gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))" },
  input: {
    width: "100%",
    borderRadius: 10,
    border: "1px solid #2f2f2f",
    background: "#111111",
    color: "#f0ede8",
    padding: "12px 14px",
    fontSize: 14,
    outline: "none",
  },
  readonlyRow: { display: "flex", gap: 8, flexWrap: "wrap", gridColumn: "1 / -1" },
  readonlyChip: {
    display: "inline-flex",
    alignItems: "center",
    minHeight: 34,
    padding: "0 12px",
    borderRadius: 999,
    border: "1px solid #2f2f2f",
    background: "#121212",
    color: "#cbd5e1",
    fontSize: 12,
    fontWeight: 700,
  },
  formActions: { display: "flex", justifyContent: "flex-end", gridColumn: "1 / -1" },
  editButton: {
    borderRadius: 8,
    border: "1px solid #2f2f2f",
    background: "#121212",
    color: "#f0ede8",
    padding: "8px 12px",
    fontWeight: 700,
    cursor: "pointer",
  },
  saveButton: {
    borderRadius: 8,
    border: "1px solid #166534",
    background: "#166534",
    color: "#f8fafc",
    padding: "10px 14px",
    fontWeight: 800,
    cursor: "pointer",
  },
  itemsList: { display: "grid", gap: 8 },
  itemRow: { border: "1px solid #2f2f2f", borderRadius: 10, padding: 10, display: "flex", justifyContent: "space-between", gap: 10, background: "#0f0f0f" },
  itemName: { margin: 0, color: "#f0ede8", fontWeight: 700 },
  itemMeta: { margin: "4px 0 0", color: "#a1a1aa", fontSize: 13 },
  itemPrice: { margin: 0, color: "#f0ede8", fontWeight: 700, alignSelf: "center" },
  linkButton: {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    textDecoration: "none",
    border: "1px solid #2f2f2f",
    color: "#f0ede8",
    borderRadius: 8,
    padding: "10px 14px",
    fontWeight: 700,
    background: "#0f0f0f",
  },
};
