import { useState, type FormEvent } from "react";
import { trpc } from "../../../lib/trpc";
import {
  BATCH_TRANSITIONS,
  type BatchStatus,
  shippingEstimate,
} from "../../../../../shared/preorder";
import "./AdminBatches.css";
const empty = {
  name: "",
  salesOpenAt: "",
  salesCloseAt: "",
  estimatedShippingStart: "",
  estimatedShippingEnd: "",
  minimumQuantity: "0",
  maximumQuantity: "",
};
const labels: Record<BatchStatus, string> = {
  DRAFT: "Rascunho",
  OPEN: "Pré-venda aberta",
  CLOSED: "Vendas encerradas",
  IN_PRODUCTION: "Em produção",
  RECEIVED: "Recebido",
  SHIPPING: "Envios iniciados",
  COMPLETED: "Concluído",
  CANCELLED: "Cancelado",
};
const actions: Record<BatchStatus, string> = {
  DRAFT: "Rascunho",
  OPEN: "Abrir pré-venda",
  CLOSED: "Encerrar pré-venda",
  IN_PRODUCTION: "Iniciar produção",
  RECEIVED: "Marcar recebido",
  SHIPPING: "Iniciar envios",
  COMPLETED: "Completar",
  CANCELLED: "Cancelar lote",
};
export function AdminBatches() {
  const [selected, setSelected] = useState<number | null>(null);
  const [editId, setEditId] = useState<number | undefined>();
  const [form, setForm] = useState(empty);
  const [error, setError] = useState("");
  const [associations, setAssociations] = useState<number[] | null>(null);
  const list = trpc.productionBatches.list.useQuery();
  const detail = trpc.productionBatches.detail.useQuery(selected ?? 0, {
    enabled: selected !== null,
  });
  const products = trpc.products.list.useQuery({ limit: 10000 });
  const utils = trpc.useUtils();
  const refresh = async () => {
    await Promise.all([
      utils.productionBatches.invalidate(),
      utils.products.invalidate(),
      utils.admin.invalidate(),
    ]);
    setError("");
  };
  const onError = (e: { message: string }) => setError(e.message);
  const save = trpc.productionBatches.save.useMutation({
    onSuccess: async value => {
      setSelected(value.id);
      setEditId(undefined);
      setForm(empty);
      await refresh();
    },
    onError,
  });
  const associate = trpc.productionBatches.associate.useMutation({
    onSuccess: refresh,
    onError,
  });
  const transition = trpc.productionBatches.transition.useMutation({
    onSuccess: refresh,
    onError,
  });
  const busy = save.isPending || associate.isPending || transition.isPending;
  const batch = detail.data?.batch;
  const chosen =
    associations ?? detail.data?.products.map(p => Number(p.id)) ?? [];
  const dateKeys = [
    "salesOpenAt",
    "salesCloseAt",
    "estimatedShippingStart",
    "estimatedShippingEnd",
  ] as const;
  const dateLabels = [
    "Abertura das vendas",
    "Encerramento das vendas",
    "Envio estimado — início",
    "Envio estimado — fim",
  ];
  function submit(event: FormEvent) {
    event.preventDefault();
    const iso = (v: string) => (v ? new Date(v + "Z").toISOString() : null);
    save.mutate({
      id: editId,
      name: form.name,
      salesOpenAt: iso(form.salesOpenAt),
      salesCloseAt: iso(form.salesCloseAt),
      estimatedShippingStart: iso(form.estimatedShippingStart),
      estimatedShippingEnd: iso(form.estimatedShippingEnd),
      minimumQuantity: Number(form.minimumQuantity),
      maximumQuantity: form.maximumQuantity
        ? Number(form.maximumQuantity)
        : null,
    });
  }
  function edit() {
    if (!batch) return;
    setEditId(Number(batch.id));
    setForm({
      name: batch.name,
      minimumQuantity: String(batch.minimumQuantity),
      maximumQuantity:
        batch.maximumQuantity === null ? "" : String(batch.maximumQuantity),
      ...Object.fromEntries(
        dateKeys.map(key => [
          key,
          batch[key] ? new Date(batch[key]).toISOString().slice(0, 16) : "",
        ])
      ),
    } as typeof empty);
  }
  function advance(status: BatchStatus) {
    if (!selected) return;
    const acknowledged =
      status === "CANCELLED"
        ? window.confirm(
            `Este lote possui ${detail.data?.paidOrders ?? 0} pedido(s) pago(s). A produção será interrompida. Reembolso NÃO é automático. Confirma o cancelamento e a resolução operacional dos pedidos?`
          )
        : false;
    if (status === "CANCELLED" && !acknowledged) return;
    transition.mutate({
      id: selected,
      status,
      acknowledgePaidOrders: acknowledged,
    });
  }
  return (
    <section className="l4-batches">
      <header>
        <span className="l4-batches-kicker">L4CKOS / PRODUÇÃO POR DEMANDA</span>
        <h2>Lotes de produção</h2>
        <p>
          Do lançamento ao envio. Somente pagamentos confirmados entram na ordem
          de produção.
        </p>
      </header>
      {error && (
        <p role="alert" className="l4-batches-error">
          {error}
        </p>
      )}
      <div className={`l4-batches-layout ${selected ? "l4-batches-layout--selected" : ""}`}>
        <aside>
          <h3>Lançamentos</h3>
          {list.isLoading && <p>Carregando lotes…</p>}
          {list.isError && (
            <p role="alert">Não foi possível carregar os lotes.</p>
          )}
          {!list.isLoading && list.data?.length === 0 && (
            <p>Nenhum lote criado.</p>
          )}
          {list.data?.map(b => (
            <button
              key={b.id}
              aria-pressed={selected === Number(b.id)}
              onClick={() => {
                setSelected(Number(b.id));
                setAssociations(null);
              }}
            >
              <strong>{b.name}</strong>
              <span>{labels[b.status as BatchStatus]}</span>
            </button>
          ))}
          <details key={`${selected}-${editId}`} className="l4-batches-new" open={Boolean(editId) || !selected}>
            <summary>{editId ? "Editar lote" : "Novo lote"}</summary>
          <form onSubmit={submit}>
            <h3>{editId ? "Editar lote" : "Novo lote"}</h3>
            <label>
              Nome
              <input
                required
                maxLength={255}
                value={form.name}
                onChange={e => setForm({ ...form, name: e.target.value })}
              />
            </label>
            {dateKeys.map((key, i) => (
              <label key={key}>
                {dateLabels[i]} (UTC)
                <input
                  type="datetime-local"
                  value={form[key]}
                  onChange={e => setForm({ ...form, [key]: e.target.value })}
                />
              </label>
            ))}
            <div className="l4-batches-pair">
              <label>
                Mínimo informativo
                <input
                  type="number"
                  min="0"
                  step="1"
                  required
                  value={form.minimumQuantity}
                  onChange={e =>
                    setForm({ ...form, minimumQuantity: e.target.value })
                  }
                />
              </label>
              <label>
                Máximo opcional
                <input
                  type="number"
                  min="1"
                  step="1"
                  value={form.maximumQuantity}
                  placeholder="Sem limite"
                  onChange={e =>
                    setForm({ ...form, maximumQuantity: e.target.value })
                  }
                />
              </label>
            </div>
            <button disabled={busy} type="submit">
              {editId ? "Salvar alterações" : "Criar lote"}
            </button>
            {editId && (
              <button
                type="button"
                onClick={() => {
                  setEditId(undefined);
                  setForm(empty);
                }}
              >
                Voltar para novo lote
              </button>
            )}
          </form>
          </details>
        </aside>
        <article>
          {detail.isLoading && selected && <p>Carregando produção…</p>}
          {detail.isError && (
            <p role="alert">Não foi possível carregar o lote.</p>
          )}
          {!selected && <p>Selecione um lote para acompanhar a produção.</p>}
          {batch && detail.data && (
            <>
              <div className="l4-batches-heading">
                <div>
                  <span className="l4-batches-kicker">
                    {labels[batch.status as BatchStatus]}
                  </span>
                  <h2>{batch.name}</h2>
                  <p>
                    {shippingEstimate(
                      batch.estimatedShippingStart,
                      batch.estimatedShippingEnd
                    )}
                  </p>
                </div>
                <button onClick={edit}>Editar</button>
              </div>
              <div className="l4-batches-actions">
                {BATCH_TRANSITIONS[batch.status as BatchStatus].map(status => (
                  <button
                    key={status}
                    className={
                      status === "CANCELLED" ? "l4-batches-danger" : ""
                    }
                    disabled={busy}
                    onClick={() => advance(status)}
                  >
                    {actions[status]}
                  </button>
                ))}
              </div>
              {batch.status === "CANCELLED" && (
                <p role="alert" className="l4-batches-error">
                  Lote cancelado. Resolva os pedidos pagos individualmente; não
                  há reembolso automático.
                </p>
              )}
              <div className="l4-batches-stats">
                <div>
                  <strong>{detail.data.paidOrders}</strong>
                  <span>Pedidos pagos</span>
                </div>
                <div>
                  <strong>{detail.data.confirmedQuantity}</strong>
                  <span>Peças confirmadas</span>
                </div>
                <div>
                  <strong>
                    {(detail.data.confirmedItemValueCents / 100).toLocaleString(
                      "pt-BR",
                      { style: "currency", currency: "BRL" }
                    )}
                  </strong>
                  <span>Valor dos itens confirmados*</span>
                </div>
              </div>
              <p>
                Mínimo: {batch.minimumQuantity} · Confirmadas:{" "}
                {detail.data.confirmedQuantity} · Faltam:{" "}
                {detail.data.minimumRemaining}
              </p>
              <progress
                aria-label="Progresso para o mínimo"
                value={Math.min(
                  detail.data.confirmedQuantity,
                  Number(batch.minimumQuantity)
                )}
                max={Math.max(1, Number(batch.minimumQuantity))}
              />
              <p className="l4-batches-muted">
                Aguardando pagamento: {detail.data.pendingOrders} pedidos /{" "}
                {detail.data.pendingQuantity} peças. Capacidade:{" "}
                {detail.data.confirmedQuantity + detail.data.pendingQuantity} /{" "}
                {batch.maximumQuantity ?? "sem limite"}. Pedidos abandonados
                exigem conciliação e cancelamento administrativo.
              </p>
              <h3>CONFIRMADO / Ordem de produção</h3>
              <div className="l4-batches-table">
                <table>
                  <thead>
                    <tr>
                      <th>Produto</th>
                      <th>Variante</th>
                      <th>Tamanho</th>
                      <th>Cor</th>
                      <th>Peças</th>
                    </tr>
                  </thead>
                  <tbody>
                    {detail.data.groups.map((g, i) => (
                      <tr
                        key={`${g.productId}-${g.variantId}-${g.size}-${g.color}-${i}`}
                      >
                        <td>{g.productName}</td>
                        <td>{g.variantName || "—"}</td>
                        <td>{g.size || "—"}</td>
                        <td>{g.color || "—"}</td>
                        <td>{g.quantity}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr>
                      <th colSpan={4}>TOTAL LOTE</th>
                      <th>{detail.data.confirmedQuantity}</th>
                    </tr>
                  </tfoot>
                </table>
              </div>
              <p>
                {[...new Set(detail.data.groups.map(g => g.productId))]
                  .map(
                    id =>
                      `${detail.data!.groups.find(g => g.productId === id)!.productName}: ${detail.data!.groups.filter(g => g.productId === id).reduce((n, g) => n + g.quantity, 0)} peças`
                  )
                  .join(" · ")}
              </p>
              <p className="l4-batches-muted">
                *Valor bruto dos itens, em centavos, antes de desconto e frete.
                O total cobrado do pedido segue o checkout.
              </p>
              <h3>Produtos do lote</h3>
              <p>
                {detail.data.products.map(p => p.name).join(" · ") ||
                  "Nenhum produto associado."}
              </p>
              {["DRAFT", "OPEN", "CLOSED"].includes(batch.status) && (
                <details>
                  <summary>Editar associações e modo de venda</summary>
                  <button
                    onClick={() =>
                      setAssociations(
                        detail.data.products.map(p => Number(p.id))
                      )
                    }
                  >
                    Carregar associações atuais
                  </button>
                  <p>
                    Produtos selecionados usam PREORDER. Produtos removidos
                    voltam a STOCK. Compras anteriores preservam seus snapshots.
                  </p>
                  <div className="l4-batches-products">
                    {products.data?.map(p => (
                      <label key={p.id}>
                        <input
                          type="checkbox"
                          checked={chosen.includes(p.id)}
                          onChange={e =>
                            setAssociations(
                              e.target.checked
                                ? [...chosen, p.id]
                                : chosen.filter(id => id !== p.id)
                            )
                          }
                        />
                        {p.name} · {p.salesMode}
                      </label>
                    ))}
                  </div>
                  <button
                    disabled={busy}
                    onClick={() =>
                      associate.mutate({ id: selected!, productIds: chosen })
                    }
                  >
                    Salvar associações
                  </button>
                </details>
              )}
            </>
          )}
        </article>
      </div>
    </section>
  );
}
