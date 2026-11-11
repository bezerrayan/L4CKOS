import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { trpc } from "../../../lib/trpc";
import { formatDropInstant, isoToZonedLocal, zonedLocalToIso } from "../../../lib/dropTime";
import { AdminBatchDateField } from "../batches/AdminBatchDateField";
import "./AdminExclusiveDrops.css";

type Status = "pending" | "approved" | "rejected" | "revoked";
const STATUS_LABEL: Record<Status, string> = { pending: "Pendente", approved: "Aprovada", rejected: "Recusada", revoked: "Revogada" };
const STATE_LABEL: Record<string, string> = { hidden: "Rascunho", scheduled: "Programado", active: "Ativo", closed: "Encerrado" };
const errorText = (error: unknown) => (error as { data?: { appError?: { message?: string } }; message?: string })?.data?.appError?.message ?? (error as Error)?.message ?? "Falha na operação.";

type DropForm = {
  id?: number; slug: string; name: string; description: string; timezone: string;
  requestStartsAt: string; requestEndsAt: string; purchaseStartsAt: string; purchaseEndsAt: string;
  isPublic: boolean; requiresAuthorization: boolean; defaultUnitLimit: number; status: "draft" | "published" | "closed"; productIds: string;
};
const emptyForm: DropForm = {
  slug: "", name: "", description: "", timezone: "America/Sao_Paulo", requestStartsAt: "", requestEndsAt: "", purchaseStartsAt: "", purchaseEndsAt: "",
  isPublic: true, requiresAuthorization: true, defaultUnitLimit: 1, status: "draft", productIds: "",
};

/** Moves keyboard/screen-reader focus to a panel that just appeared far from the control that opened it. */
function useFocusWhen(active: boolean) {
  const ref = useRef<HTMLElement | null>(null);
  useEffect(() => {
    if (!active) return;
    ref.current?.focus();
    ref.current?.scrollIntoView?.({ block: "nearest" });
  }, [active]);
  return ref;
}

export default function AdminExclusiveDrops() {
  const utils = trpc.useUtils();
  // Synchronous guard: a double click fires twice before React re-renders `isPending`.
  const inFlight = useRef(false);
  const guarded = async (work: () => Promise<void>) => {
    if (inFlight.current) return;
    inFlight.current = true;
    try { await work(); } finally { inFlight.current = false; }
  };
  const dropsQuery = trpc.exclusiveDrops.admin.listDrops.useQuery();
  const [filterDrop, setFilterDrop] = useState<number | undefined>();
  const [filterStatus, setFilterStatus] = useState<Status | undefined>();
  const requestsQuery = trpc.exclusiveDrops.admin.listRequests.useQuery({ dropId: filterDrop, status: filterStatus });
  const saveDrop = trpc.exclusiveDrops.admin.saveDrop.useMutation();
  const approve = trpc.exclusiveDrops.admin.approve.useMutation();
  const reject = trpc.exclusiveDrops.admin.reject.useMutation();
  const revoke = trpc.exclusiveDrops.admin.revoke.useMutation();
  const reissue = trpc.exclusiveDrops.admin.reissueCode.useMutation();

  const [form, setForm] = useState<DropForm | null>(null);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [approving, setApproving] = useState<{ requestId: number; dropId: number; unitLimit: number; expiresAt: string } | null>(null);
  // The plaintext code is shown ONCE, here, and never persisted or logged by the page.
  const [issued, setIssued] = useState<{ requestId: number; code: string } | null>(null);
  const [historyFor, setHistoryFor] = useState<number | null>(null);
  // Irreversible actions (revoke invalidates access; re-issue kills the previous code) need a second, explicit click.
  const [confirming, setConfirming] = useState<{ kind: "revoke" | "reissue"; requestId: number } | null>(null);
  const formRef = useFocusWhen(form !== null) as React.RefObject<HTMLFormElement>;
  const approveRef = useFocusWhen(approving !== null) as React.RefObject<HTMLFormElement>;
  const issuedRef = useFocusWhen(issued !== null) as React.RefObject<HTMLDivElement>;
  const historyRef = useFocusWhen(historyFor !== null) as React.RefObject<HTMLDivElement>;
  const historyQuery = trpc.exclusiveDrops.admin.history.useQuery({ requestId: historyFor ?? undefined }, { enabled: historyFor !== null });

  const drops = dropsQuery.data ?? [];
  const dropById = useMemo(() => new Map(drops.map(drop => [drop.id, drop])), [drops]);

  const refresh = async () => {
    await Promise.all([utils.exclusiveDrops.admin.listDrops.invalidate(), utils.exclusiveDrops.admin.listRequests.invalidate()]);
  };
  const run = (work: () => Promise<unknown>, ok: string) => guarded(async () => {
    setError(""); setMessage(""); setConfirming(null);
    try { await work(); setMessage(ok); await refresh(); } catch (err) { setError(errorText(err)); }
  });

  const editDrop = (id: number) => {
    const drop = dropById.get(id)!;
    const tz = drop.timezone;
    setForm({
      id: drop.id, slug: drop.slug, name: drop.name, description: drop.description ?? "", timezone: tz,
      requestStartsAt: isoToZonedLocal(drop.requestWindow.startsAt, tz), requestEndsAt: isoToZonedLocal(drop.requestWindow.endsAt, tz),
      purchaseStartsAt: isoToZonedLocal(drop.purchaseWindow.startsAt, tz), purchaseEndsAt: isoToZonedLocal(drop.purchaseWindow.endsAt, tz),
      isPublic: true, requiresAuthorization: drop.requiresAuthorization, defaultUnitLimit: drop.defaultUnitLimit, status: drop.storedStatus, productIds: drop.productIds.join(", "),
    });
  };

  const submitDrop = async (event: FormEvent) => {
    event.preventDefault();
    if (!form) return;
    const iso = (value: string) => zonedLocalToIso(value, form.timezone);
    if (!iso(form.purchaseStartsAt) || !iso(form.purchaseEndsAt)) { setError("Informe o início e o fim da compra."); return; }
    const productIds = form.productIds.split(/[,\s]+/).filter(Boolean).map(Number);
    if (!productIds.length || productIds.some(id => !Number.isInteger(id) || id <= 0)) { setError("Informe ao menos um ID de produto válido."); return; }
    await run(() => saveDrop.mutateAsync({
      id: form.id, slug: form.slug, name: form.name, description: form.description || undefined, timezone: form.timezone,
      requestStartsAt: iso(form.requestStartsAt) || null, requestEndsAt: iso(form.requestEndsAt) || null,
      purchaseStartsAt: iso(form.purchaseStartsAt), purchaseEndsAt: iso(form.purchaseEndsAt),
      isPublic: form.isPublic, requiresAuthorization: form.requiresAuthorization, defaultUnitLimit: form.defaultUnitLimit, status: form.status, productIds,
    }), "Drop salvo.");
    setForm(null);
  };

  const startApprove = (requestId: number, dropId: number) => {
    const drop = dropById.get(dropId);
    setApproving({ requestId, dropId, unitLimit: drop?.defaultUnitLimit ?? 1, expiresAt: isoToZonedLocal(drop?.purchaseWindow.endsAt, drop?.timezone ?? "America/Sao_Paulo") });
  };
  const submitApprove = async (event: FormEvent) => {
    event.preventDefault();
    if (!approving) return;
    const tz = dropById.get(approving.dropId)?.timezone ?? "America/Sao_Paulo";
    const expiresAt = zonedLocalToIso(approving.expiresAt, tz);
    if (!expiresAt) { setError("Informe a validade do acesso."); return; }
    await guarded(async () => {
      setError(""); setMessage("");
      try {
        const result = await approve.mutateAsync({ requestId: approving.requestId, unitLimit: approving.unitLimit, expiresAt });
        setIssued({ requestId: approving.requestId, code: result.code });
        setApproving(null);
        await refresh();
      } catch (err) { setError(errorText(err)); }
    });
  };

  const doReissue = (requestId: number) => guarded(async () => {
    setError(""); setMessage(""); setConfirming(null);
    try {
      const result = await reissue.mutateAsync({ requestId });
      setIssued({ requestId, code: result.code });
      await refresh();
    } catch (err) { setError(errorText(err)); }
  });

  return (
    <section className="l4-axd" aria-label="Drops exclusivos">
      <header className="l4-axd-head">
        <h2>Drops exclusivos</h2>
        <button type="button" className="l4-axd-btn" onClick={() => setForm({ ...emptyForm })}>Novo drop</button>
      </header>
      {message ? <p role="status" className="l4-axd-ok">{message}</p> : null}
      {error ? <p role="alert" className="l4-axd-err">{error}</p> : null}

      {issued ? (
        <div className="l4-axd-code" role="alert" tabIndex={-1} ref={issuedRef}>
          <strong>Código individual (exibido uma única vez):</strong>
          <code data-testid="issued-code">{issued.code}</code>
          <p>Envie ao cliente por um canal seguro. Ele não é armazenado em texto puro e não poderá ser consultado depois (use “Reemitir código”).</p>
          <button type="button" className="l4-axd-btn secondary" onClick={() => setIssued(null)}>Já copiei, ocultar</button>
        </div>
      ) : null}

      <div className="l4-axd-table-wrap" role="region" aria-label="Tabela de drops (role horizontalmente)" tabIndex={0}>
        <table className="l4-axd-table">
          <caption>Drops</caption>
          <thead><tr><th>Drop</th><th>Estado</th><th>Compra</th><th>Produtos</th><th>Limite padrão</th><th><span className="sr-only">Ações</span></th></tr></thead>
          <tbody>
            {dropsQuery.isLoading ? <tr><td colSpan={6} role="status">Carregando drops…</td></tr>
              : dropsQuery.error ? <tr><td colSpan={6} role="alert">Não foi possível carregar os drops.</td></tr>
              : drops.length === 0 ? <tr><td colSpan={6}>Nenhum drop cadastrado.</td></tr> : drops.map(drop => (
              <tr key={drop.id}>
                <td><strong>{drop.name}</strong><br /><small>{drop.slug}</small></td>
                <td>{STATE_LABEL[drop.state]}</td>
                <td>{formatDropInstant(drop.purchaseWindow.startsAt, drop.timezone)} → {formatDropInstant(drop.purchaseWindow.endsAt, drop.timezone)}<br /><small>{drop.timezone}</small></td>
                <td>{drop.productIds.join(", ")}</td>
                <td>{drop.defaultUnitLimit}</td>
                <td><button type="button" className="l4-axd-btn secondary" onClick={() => editDrop(drop.id)} aria-label={`Editar ${drop.name}`}>Editar</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {form ? (
        <form className="l4-axd-form" onSubmit={submitDrop} aria-label={form.id ? "Editar drop" : "Novo drop"} tabIndex={-1} ref={formRef}>
          <h3>{form.id ? "Editar drop" : "Novo drop"}</h3>
          <label>Nome<input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} required minLength={2} /></label>
          <label>Slug<input value={form.slug} onChange={e => setForm({ ...form, slug: e.target.value })} required pattern="[a-z0-9]+(-[a-z0-9]+)*" /></label>
          <label>Descrição<textarea value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} maxLength={2000} /></label>
          <label>Fuso horário (todas as datas abaixo são neste fuso)<input value={form.timezone} onChange={e => setForm({ ...form, timezone: e.target.value })} required /></label>
          <AdminBatchDateField name="requestStartsAt" label="Solicitações — início" value={form.requestStartsAt} onChange={value => setForm({ ...form, requestStartsAt: value })} zone={form.timezone} withTime />
          <AdminBatchDateField name="requestEndsAt" label="Solicitações — fim" value={form.requestEndsAt} onChange={value => setForm({ ...form, requestEndsAt: value })} zone={form.timezone} withTime />
          <AdminBatchDateField name="purchaseStartsAt" label="Compra — início" value={form.purchaseStartsAt} onChange={value => setForm({ ...form, purchaseStartsAt: value })} zone={form.timezone} withTime required />
          <AdminBatchDateField name="purchaseEndsAt" label="Compra — fim" value={form.purchaseEndsAt} onChange={value => setForm({ ...form, purchaseEndsAt: value })} zone={form.timezone} withTime required />
          <label>IDs dos produtos (separados por vírgula)<input value={form.productIds} onChange={e => setForm({ ...form, productIds: e.target.value })} required inputMode="numeric" /></label>
          <label>Limite padrão de unidades<input type="number" min={1} max={99} value={form.defaultUnitLimit} onChange={e => setForm({ ...form, defaultUnitLimit: Number(e.target.value) })} /></label>
          <label>Situação
            <select value={form.status} onChange={e => setForm({ ...form, status: e.target.value as DropForm["status"] })}>
              <option value="draft">Rascunho</option><option value="published">Publicado</option><option value="closed">Encerrado</option>
            </select>
          </label>
          <label className="check"><input type="checkbox" checked={form.requiresAuthorization} onChange={e => setForm({ ...form, requiresAuthorization: e.target.checked })} /> Exige autorização individual</label>
          <div className="l4-axd-actions">
            <button type="submit" className="l4-axd-btn" disabled={saveDrop.isPending}>Salvar drop</button>
            <button type="button" className="l4-axd-btn secondary" onClick={() => setForm(null)}>Cancelar</button>
          </div>
        </form>
      ) : null}

      <h3>Solicitações</h3>
      <div className="l4-axd-filters">
        <label>Drop
          <select value={filterDrop ?? ""} onChange={e => setFilterDrop(e.target.value ? Number(e.target.value) : undefined)}>
            <option value="">Todos</option>{drops.map(drop => <option key={drop.id} value={drop.id}>{drop.name}</option>)}
          </select>
        </label>
        <label>Status
          <select value={filterStatus ?? ""} onChange={e => setFilterStatus((e.target.value || undefined) as Status | undefined)}>
            <option value="">Todos</option>{(Object.keys(STATUS_LABEL) as Status[]).map(status => <option key={status} value={status}>{STATUS_LABEL[status]}</option>)}
          </select>
        </label>
      </div>

      {approving ? (
        <form className="l4-axd-form" onSubmit={submitApprove} aria-label="Aprovar solicitação" tabIndex={-1} ref={approveRef}>
          <h3>Aprovar solicitação #{approving.requestId}</h3>
          <label>Unidades autorizadas (total, qualquer combinação de tamanhos)
            <input type="number" min={1} max={99} value={approving.unitLimit} onChange={e => setApproving({ ...approving, unitLimit: Number(e.target.value) })} required />
          </label>
          <AdminBatchDateField name="expiresAt" label="Validade do acesso" value={approving.expiresAt} onChange={value => setApproving({ ...approving, expiresAt: value })} zone={dropById.get(approving.dropId)?.timezone ?? "America/Sao_Paulo"} withTime required />
          <div className="l4-axd-actions">
            <button type="submit" className="l4-axd-btn" disabled={approve.isPending}>Aprovar e gerar código</button>
            <button type="button" className="l4-axd-btn secondary" onClick={() => setApproving(null)}>Cancelar</button>
          </div>
        </form>
      ) : null}

      <div className="l4-axd-table-wrap" role="region" aria-label="Tabela de solicitações (role horizontalmente)" tabIndex={0} aria-busy={requestsQuery.isLoading}>
        <table className="l4-axd-table">
          <caption>Solicitações de acesso</caption>
          <thead><tr><th>#</th><th>Cliente</th><th>Drop</th><th>Status</th><th>Autorização</th><th><span className="sr-only">Ações</span></th></tr></thead>
          <tbody>
            {requestsQuery.isLoading ? <tr><td colSpan={6} role="status">Carregando solicitações…</td></tr>
              : requestsQuery.error ? <tr><td colSpan={6} role="alert">Não foi possível carregar as solicitações.</td></tr>
              : (requestsQuery.data ?? []).length === 0 ? <tr><td colSpan={6}>Nenhuma solicitação.</td></tr> : (requestsQuery.data ?? []).map(item => (
              <tr key={item.requestId}>
                <td>{item.requestId}</td>
                <td>{item.userName ?? "—"}<br /><small>{item.userEmail ?? ""}</small></td>
                <td>{item.dropName}</td>
                <td>{STATUS_LABEL[item.status as Status]}</td>
                <td>{item.grant ? <>até {item.grant.unitLimit} un. · reservadas {item.grant.unitsReserved} · compradas {item.grant.unitsConsumed}<br /><small>{item.grant.unlocked ? "desbloqueado" : "não desbloqueado"} · expira {formatDropInstant(item.grant.expiresAt, dropById.get(item.dropId)?.timezone ?? "America/Sao_Paulo")}</small></> : "—"}</td>
                <td className="l4-axd-row-actions">
                  {(item.status === "pending" || item.status === "rejected" || item.status === "revoked") ? <button type="button" className="l4-axd-btn" onClick={() => startApprove(item.requestId, item.dropId)}>Aprovar</button> : null}
                  {item.status === "pending" ? <button type="button" className="l4-axd-btn secondary" onClick={() => void run(() => reject.mutateAsync({ requestId: item.requestId }), "Solicitação recusada.")}>Recusar</button> : null}
                  {item.status === "approved" ? (
                    confirming?.requestId === item.requestId ? (
                      <>
                        <span role="alert">{confirming.kind === "revoke" ? "Revogar bloqueia novas compras deste cliente." : "O código atual deixará de funcionar."}</span>
                        <button type="button" className="l4-axd-btn" onClick={() => void (confirming.kind === "revoke" ? run(() => revoke.mutateAsync({ requestId: item.requestId }), "Acesso revogado.") : doReissue(item.requestId))}>
                          {confirming.kind === "revoke" ? "Confirmar revogação" : "Confirmar reemissão"}
                        </button>
                        <button type="button" className="l4-axd-btn secondary" onClick={() => setConfirming(null)}>Cancelar</button>
                      </>
                    ) : (
                      <>
                        <button type="button" className="l4-axd-btn secondary" onClick={() => setConfirming({ kind: "revoke", requestId: item.requestId })}>Revogar</button>
                        <button type="button" className="l4-axd-btn secondary" onClick={() => setConfirming({ kind: "reissue", requestId: item.requestId })}>Reemitir código</button>
                      </>
                    )
                  ) : null}
                  <button type="button" className="l4-axd-btn secondary" onClick={() => setHistoryFor(item.requestId)}>Histórico</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {historyFor !== null ? (
        <div className="l4-axd-history" role="region" aria-label={`Histórico da solicitação ${historyFor}`} tabIndex={-1} ref={historyRef}>
          <h3>Histórico da solicitação #{historyFor}</h3>
          <ul>
            {(historyQuery.data ?? []).map(entry => <li key={entry.id}><time>{entry.createdAt}</time> — {entry.event}{entry.details ? ` (${entry.details})` : ""}{entry.actorUserId ? ` · admin #${entry.actorUserId}` : ""}</li>)}
          </ul>
          <button type="button" className="l4-axd-btn secondary" onClick={() => setHistoryFor(null)}>Fechar</button>
        </div>
      ) : null}
    </section>
  );
}
