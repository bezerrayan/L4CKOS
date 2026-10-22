import { useState, type FormEvent } from "react";
import { trpc } from "../../../lib/trpc";
import {
  BATCH_TRANSITIONS,
  type BatchStatus,
  shippingEstimate,
  manufacturingEstimate,
  civilDate,
} from "../../../../../shared/preorder";
import { AdminBatchDateField } from "./AdminBatchDateField";
import "./AdminBatches.css";
const empty = {
  name: "",
  salesOpenAt: "",
  salesCloseAt: "",
  estimatedShippingStart: "",
  estimatedShippingEnd: "",
  estimatedManufacturingStart: "",
  estimatedManufacturingEnd: "",
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
function formatUtcInstant(value: Date | string | null | undefined) {
  if (!value) return "";
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return `${new Intl.DateTimeFormat("pt-BR", { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" }).format(date)} UTC`;
}
export function AdminBatches() {
  const [selected, setSelected] = useState<number | null>(null);
  const [editId, setEditId] = useState<number | undefined>();
  const [formOpen, setFormOpen] = useState(false);
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
      setFormOpen(false);
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
    "Postagem estimada — início",
    "Postagem estimada — fim",
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
      estimatedManufacturingStart: form.estimatedManufacturingStart || null,
      estimatedManufacturingEnd: form.estimatedManufacturingEnd || null,
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
      estimatedManufacturingStart: civilDate(batch.estimatedManufacturingStart) ?? "",
      estimatedManufacturingEnd: civilDate(batch.estimatedManufacturingEnd) ?? "",
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
    setFormOpen(true);
  }
  function startNewBatch() {
    setEditId(undefined);
    setForm(empty);
    setFormOpen(true);
  }
  function closeForm() {
    setEditId(undefined);
    setForm(empty);
    setFormOpen(false);
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
      {!formOpen && <div className="l4-batches-toolbar">
        <p>Consulte a situação dos lotes e abra um registro para acompanhar a produção.</p>
        <button type="button" className="l4-batches-primary" onClick={startNewBatch}>Novo lote</button>
      </div>}
      {formOpen ? (
        <section className="l4-batches-editor" aria-labelledby="l4-batches-form-title">
          <div className="l4-batches-editor-heading">
            <div>
              <span className="l4-batches-kicker">{editId ? `LOTE #${editId}` : "NOVO REGISTRO"}</span>
              <h3 id="l4-batches-form-title">{editId ? "Editar lote" : "Novo lote"}</h3>
            </div>
            <button type="button" onClick={closeForm} disabled={busy}>Voltar</button>
          </div>
          <form className="l4-batches-form" onSubmit={submit}>
            <section className="l4-batches-form-section">
              <h4>Informações gerais</h4>
              <label className="l4-batches-field-wide">Nome do lote<input required maxLength={255} value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} /></label>
              <div className="l4-batches-pair">
                <label>Quantidade mínima informativa<input type="number" min="0" step="1" required value={form.minimumQuantity} onChange={e => setForm({ ...form, minimumQuantity: e.target.value })} /></label>
                <label>Quantidade máxima opcional<input type="number" min="1" step="1" value={form.maximumQuantity} placeholder="Sem limite" onChange={e => setForm({ ...form, maximumQuantity: e.target.value })} /></label>
              </div>
            </section>
            <section className="l4-batches-form-section">
              <h4>Período de vendas e postagem</h4>
              <div className="l4-batches-form-grid">
                {dateKeys.map((key, i) => <AdminBatchDateField key={key} name={key} label={dateLabels[i]} value={form[key]} onChange={value => setForm(current => ({ ...current, [key]: value }))} zone="UTC" withTime />)}
              </div>
              <p>As datas de vendas e postagem são informadas em UTC. A janela de postagem não inclui o transporte.</p>
            </section>
            <section className="l4-batches-form-section">
              <h4>Cronograma de fabricação</h4>
              <div className="l4-batches-form-grid">
                {(["estimatedManufacturingStart", "estimatedManufacturingEnd"] as const).map((key, i) => <AdminBatchDateField key={key} name={key} label={i === 0 ? "Início estimado da fabricação" : "Término estimado da fabricação"} value={form[key]} onChange={value => setForm(current => ({ ...current, [key]: value }))} zone="Brasília" />)}
              </div>
              <p>Fabricação usa datas civis de Brasília, conforme o compromisso do fornecedor. Antes de abrir vendas, o lote precisa ter início e término de fabricação. A postagem não pode anteceder o fim estimado da fabricação.</p>
            </section>
            <p className="l4-batches-form-note">Alterar o lote atualiza o catálogo, mas não substitui as condições registradas em pedidos anteriores. Comunique as alterações aos clientes afetados.</p>
            <div className="l4-batches-actions">
              <button disabled={busy} type="submit">{save.isPending ? "Salvando…" : editId ? "Salvar alterações" : "Criar lote"}</button>
              <button type="button" onClick={closeForm} disabled={busy}>Cancelar</button>
            </div>
          </form>
        </section>
      ) : <div className={`l4-batches-layout ${selected ? "l4-batches-layout--selected" : ""}`}>
        <aside>
          <h3>Lançamentos</h3>
          {list.isLoading && <p aria-live="polite">Carregando lotes…</p>}
          {list.isError && (
            <div role="alert" className="l4-batches-query-error"><p>Não foi possível carregar os lotes.</p><button type="button" disabled={list.isFetching} onClick={() => void list.refetch()}>Tentar novamente</button></div>
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
        </aside>
        <article>
          {detail.isLoading && selected && <p>Carregando produção…</p>}
          {detail.isError && (
            <div role="alert" className="l4-batches-query-error"><p>Não foi possível carregar o lote.</p><button type="button" disabled={detail.isFetching} onClick={() => void detail.refetch()}>Tentar novamente</button></div>
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
                  <p>{manufacturingEstimate(batch.estimatedManufacturingStart, batch.estimatedManufacturingEnd)}</p>
                  <p>
                    {shippingEstimate(
                      batch.estimatedShippingStart,
                      batch.estimatedShippingEnd
                    )}
                  </p>
                </div>
                <button onClick={edit}>Editar</button>
              </div>
              {[
                ["Produção iniciada", batch.productionStartedAt],
                ["Produção recebida", batch.receivedAt],
                ["Envios iniciados", batch.shippingStartedAt],
                ["Lote concluído", batch.completedAt],
              ].some(([, value]) => Boolean(value)) && (
                <section className="l4-batches-timeline" aria-label="Etapas registradas do lote">
                  <h3>Etapas registradas</h3>
                  <dl>
                    {([
                      ["Produção iniciada", batch.productionStartedAt],
                      ["Produção recebida", batch.receivedAt],
                      ["Envios iniciados", batch.shippingStartedAt],
                      ["Lote concluído", batch.completedAt],
                    ] as const).filter(([, value]) => Boolean(value)).map(([label, value]) => (
                      <div key={label}><dt>{label}</dt><dd>{formatUtcInstant(value)}</dd></div>
                    ))}
                  </dl>
                </section>
              )}
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
                    disabled={busy}
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
                          disabled={busy || products.isLoading}
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
      </div>}
    </section>
  );
}
