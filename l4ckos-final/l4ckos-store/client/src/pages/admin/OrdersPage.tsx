import { useMemo, useState } from "react";
import type { CSSProperties } from "react";
import { trpc } from "../../lib/trpc";
import { useToast } from "../../contexts/ToastContext";
import { useUser } from "../../contexts/UserContext";
import { formatPrice } from "../../lib/utils";
import { useIsMobile } from "../../hooks/useIsMobile";
import { AdminOrdersUI } from "../../components/admin/orders/AdminOrdersUI";
import { AdminEmptyState, AdminSurface } from "../../components/admin/AdminUI";

const statuses = [
  "pending",
  "paid",
  "processing",
  "shipped",
  "delivered",
  "cancelled",
] as const;
const actions = ["processing", "shipped", "delivered", "cancelled"] as const;
const label = (status: string) =>
  ({
    pending: "Aguardando pagamento",
    paid: "Pagamento confirmado",
    processing: "Em separação",
    shipped: "Enviado",
    delivered: "Entregue",
    cancelled: "Cancelado",
  })[status] ?? status;
const addressLines = (address: any) =>
  [
    [address?.street, address?.number].filter(Boolean).join(", "),
    [
      [
        address?.neighborhood,
        [address?.city, address?.state].filter(Boolean).join(" - "),
      ]
        .filter(Boolean)
        .join(" • "),
    ],
    address?.zipCode ? `CEP ${address.zipCode}` : "",
  ]
    .flat()
    .filter(Boolean);

export function OrdersPage() {
  const { showToast } = useToast();
  const { user, isAuthenticated } = useUser();
  const utils = trpc.useUtils();
  const compact = useIsMobile(1180);
  const isAdmin = user?.role === "admin";
  const [status, setStatus] = useState("");
  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const ordersQuery = trpc.admin.ordersList.useQuery(
    status ? { status: status as any } : undefined,
    { enabled: isAuthenticated && isAdmin }
  );
  const exceptionsQuery = trpc.admin.inventoryExceptions.useQuery(undefined, {
    enabled: isAuthenticated && isAdmin,
  });
  const update = trpc.admin.orderUpdate.useMutation({
    onSuccess: () => {
      showToast({ message: "Pedido atualizado", duration: 2000 });
      void ordersQuery.refetch();
      void utils.admin.dashboard.invalidate();
    },
    onError: error => showToast({ message: error.message, duration: 2600 }),
  });
  const resolveException = trpc.admin.inventoryExceptionResolve.useMutation({
    onSuccess: () => {
      showToast({ message: "Exceção de estoque atualizada", duration: 2400 });
      void exceptionsQuery.refetch();
      void ordersQuery.refetch();
    },
    onError: error => showToast({ message: error.message, duration: 3200 }),
  });
  const orders = useMemo(() => {
    const term = search.trim().toLowerCase();
    return [...(ordersQuery.data ?? [])]
      .filter(
        row =>
          !term ||
          [
            row.id,
            row.customerName,
            row.customerEmail,
            row.trackingCode,
            row.userId,
          ].some(value =>
            String(value ?? "")
              .toLowerCase()
              .includes(term)
          )
      )
      .sort((a, b) => b.id - a.id);
  }, [ordersQuery.data, search]);
  const selected = useMemo(
    () => orders.find(row => row.id === selectedId) ?? orders[0] ?? null,
    [orders, selectedId]
  );
  return (
    <AdminOrdersUI>
      <AdminSurface
        title="Pedidos"
        description="Gerencie o fluxo de pedidos com uma visão compacta e um painel lateral para detalhes operacionais."
        aside={
          <div style={s.row}>
            <input
              style={{ ...s.input, minWidth: 260 }}
              placeholder="Buscar pedido, cliente ou rastreio"
              value={search}
              onChange={event => setSearch(event.target.value)}
            />
            <label>Status:</label>
            <select
              style={s.input}
              value={status}
              onChange={event => setStatus(event.target.value)}
            >
              <option value="">Todos</option>
              {statuses.map(value => (
                <option key={value} value={value}>
                  {label(value)}
                </option>
              ))}
            </select>
            <button style={s.button} onClick={() => ordersQuery.refetch()}>
              Filtrar
            </button>
          </div>
        }
      >
        <div style={s.row}>
          <i style={s.pill}>Resultados: {orders.length}</i>
          <i style={s.pill}>
            Pendentes: {orders.filter(row => row.status === "pending").length}
          </i>
          <i style={s.pill}>
            Pagos:{" "}
            {
              orders.filter(row =>
                ["confirmed", "received", "partially_refunded"].includes(
                  String(row.payment?.status)
                )
              ).length
            }
          </i>
          <i style={s.pill}>
            Em separação:{" "}
            {
              orders.filter(row => row.fulfillmentStatus === "processing")
                .length
            }
          </i>
        </div>
        {(exceptionsQuery.data?.length ?? 0) > 0 ? (
          <div style={s.exception}>
            <b>
              Exceções de estoque — não liberar para envio (
              {exceptionsQuery.data?.length})
            </b>
            {(exceptionsQuery.data ?? []).map(row => (
              <div key={row.id} style={s.exceptionRow}>
                <strong>
                  Pedido #{row.id} ·{" "}
                  {row.customerName ||
                    row.customerEmail ||
                    `Cliente #${row.userId}`}
                </strong>
                <span>
                  Financeiro: {row.payment?.status || "sem pagamento"} · Pago:{" "}
                  {formatPrice(Number(row.payment?.paidAmount ?? 0) / 100)} ·
                  Exceção: {row.fulfillmentIssue || "não informada"}
                </span>
                <span>
                  {(row.items ?? [])
                    .map(
                      item =>
                        `${item.productName || `Produto #${item.productId}`}${item.variantName ? ` / ${item.variantName}` : ""} × ${item.quantity}`
                    )
                    .join(", ")}
                </span>
                <div style={s.row}>
                  {(
                    [
                      [
                        "stock_replenished",
                        "Estoque reposto",
                        "Confirme a reposição e descreva a evidência:",
                      ],
                      [
                        "refund_required",
                        "Encaminhar reembolso",
                        "Descreva o encaminhamento do reembolso no gateway:",
                      ],
                      ["note", "Registrar nota", "Observação operacional:"],
                    ] as const
                  ).map(([action, text, prompt]) => (
                    <button
                      key={action}
                      style={s.button}
                      onClick={() => {
                        const note = window.prompt(prompt);
                        if (note)
                          resolveException.mutate({
                            orderId: row.id,
                            action,
                            note,
                          });
                      }}
                    >
                      {text}
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        ) : null}
        {ordersQuery.isLoading ? (
          <div style={s.loading}>Carregando pedidos...</div>
        ) : orders.length === 0 ? (
          <AdminEmptyState
            title="Nenhum pedido encontrado"
            description="Ajuste o filtro ou aguarde novos pedidos aparecerem aqui."
          />
        ) : (
          <div
            style={{
              ...s.layout,
              gridTemplateColumns: compact
                ? "1fr"
                : s.layout.gridTemplateColumns,
            }}
          >
            <div style={s.tableWrap}>
              <table style={s.table}>
                <thead>
                  <tr>
                    <th>Pedido</th>
                    <th>Cliente</th>
                    <th>Total</th>
                    <th>Status</th>
                    <th>Rastreio</th>
                    <th>Itens</th>
                    <th>Ações</th>
                  </tr>
                </thead>
                <tbody>
                  {orders.map(row => (
                    <tr
                      key={row.id}
                      onClick={() => setSelectedId(row.id)}
                      style={selected?.id === row.id ? s.active : undefined}
                    >
                      <td>
                        #{row.id}
                        <small>
                          {new Date(row.createdAt).toLocaleString("pt-BR", {
                            dateStyle: "short",
                            timeStyle: "short",
                          })}
                        </small>
                      </td>
                      <td>
                        {row.customerName ||
                          row.customerEmail ||
                          `Cliente #${row.userId}`}
                        <small>
                          {row.customerEmail && row.customerName
                            ? row.customerEmail
                            : ""}
                        </small>
                      </td>
                      <td>{formatPrice(Number(row.totalPrice) / 100)}</td>
                      <td>
                        <b>{String(row.fulfillmentStatus)}</b>
                        <small>
                          Financeiro: {row.payment?.status || "não criado"}
                        </small>
                      </td>
                      <td>{row.trackingCode || "Pendente"}</td>
                      <td>
                        {(row.items ?? []).reduce(
                          (sum, item) => sum + Number(item.quantity ?? 0),
                          0
                        )}{" "}
                        item(ns)
                      </td>
                      <td onClick={event => event.stopPropagation()}>
                        <select
                          style={s.input}
                          value=""
                          onChange={event =>
                            event.target.value &&
                            update.mutate({
                              orderId: row.id,
                              status: event.target.value as any,
                            })
                          }
                        >
                          <option value="">Ação operacional…</option>
                          {actions.map(value => (
                            <option key={value} value={value}>
                              {label(value)}
                            </option>
                          ))}
                        </select>
                        <button
                          style={s.button}
                          onClick={() => {
                            const tracking = window.prompt(
                              "Código de rastreio:",
                              row.trackingCode || ""
                            );
                            if (tracking !== null)
                              update.mutate({
                                orderId: row.id,
                                trackingCode: tracking || null,
                              });
                          }}
                        >
                          Rastreio
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {selected ? (
              <aside style={s.detail}>
                <b>Pedido #{selected.id}</b>
                <span>{label(String(selected.status))}</span>
                <span>
                  Cliente:{" "}
                  {selected.customerName ||
                    selected.customerEmail ||
                    `#${selected.userId}`}
                </span>
                <span>
                  Total: {formatPrice(Number(selected.totalPrice) / 100)}
                </span>
                <span>
                  Criado em{" "}
                  {new Date(selected.createdAt).toLocaleString("pt-BR")}
                </span>
                <span>
                  Rastreio: {selected.trackingCode || "Ainda não informado"}
                </span>
                <strong>Entrega</strong>
                {selected.shippingAddress ? (
                  <div style={s.item}>
                    <b>
                      {selected.shippingAddress.recipient ||
                        "Destinatário não informado"}
                    </b>
                    <small>
                      {selected.shippingAddress.source === "profile"
                        ? "Endereço padrão atual do cliente"
                        : "Endereço salvo no pedido"}
                    </small>
                    {addressLines(selected.shippingAddress).map(value => (
                      <small key={value}>{value}</small>
                    ))}
                  </div>
                ) : (
                  <small>Nenhum endereço disponível para este pedido.</small>
                )}
                <strong>Itens reservados</strong>
                {(selected.items ?? []).length === 0 ? (
                  <small>
                    Este pedido ainda não possui itens detalhados na reserva.
                  </small>
                ) : (
                  (selected.items ?? []).map((item, index) => (
                    <div
                      key={`${selected.id}-${item.productId}-${index}`}
                      style={s.item}
                    >
                      <b>{item.productName || `Produto #${item.productId}`}</b>
                      <small>Quantidade: {item.quantity}</small>
                    </div>
                  ))
                )}
              </aside>
            ) : null}
          </div>
        )}
      </AdminSurface>
    </AdminOrdersUI>
  );
}
const s: Record<string, CSSProperties> = {
  row: { display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" },
  input: {
    border: "1px solid #27272a",
    background: "#111",
    color: "#f0ede8",
    borderRadius: 12,
    padding: "10px 12px",
    minHeight: 38,
  },
  button: {
    border: "1px solid #2f2f2f",
    background: "#111",
    color: "#f0ede8",
    borderRadius: 8,
    padding: "6px 10px",
    cursor: "pointer",
    fontWeight: 700,
  },
  pill: {
    fontStyle: "normal",
    padding: "8px 12px",
    borderRadius: 999,
    border: "1px solid #262626",
    background: "#121212",
    color: "#f0ede8",
    fontSize: 12,
  },
  exception: {
    display: "grid",
    gap: 10,
    margin: "16px 0",
    padding: 16,
    border: "1px solid #ef4444",
    borderRadius: 12,
    background: "rgba(127,29,29,.18)",
  },
  exceptionRow: {
    display: "grid",
    gap: 6,
    padding: "12px 0",
    borderTop: "1px solid rgba(252,165,165,.25)",
    color: "#d1d5db",
    fontSize: 12,
  },
  loading: { padding: "28px 18px", color: "#9ca3af", textAlign: "center" },
  layout: {
    display: "grid",
    gridTemplateColumns: "minmax(0,1fr) 320px",
    gap: 16,
    alignItems: "start",
  },
  tableWrap: {
    overflowX: "auto",
    border: "1px solid #2f2f2f",
    borderRadius: 10,
  },
  table: {
    width: "100%",
    minWidth: 920,
    borderCollapse: "separate",
    borderSpacing: 0,
    fontSize: 14,
    color: "#e5e7eb",
    textAlign: "center",
  },
  active: { background: "rgba(255,255,255,.03)" },
  detail: {
    position: "sticky",
    top: 16,
    display: "grid",
    gap: 10,
    padding: "18px 16px",
    borderRadius: 18,
    border: "1px solid #252525",
    background: "#0d0d0d",
    color: "#f0ede8",
  },
  item: {
    display: "grid",
    gap: 4,
    padding: "10px 12px",
    borderRadius: 12,
    border: "1px solid #202020",
    background: "#121212",
  },
};
