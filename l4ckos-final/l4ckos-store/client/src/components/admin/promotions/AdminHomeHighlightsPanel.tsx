import { useMemo, useState } from "react";
import { ArrowDown, ArrowUp, Check, ImagePlus, Pencil, Plus, RefreshCw, Trash2 } from "lucide-react";
import { apiUrl } from "../../../const";
import "./AdminHomeHighlightsPanel.css";

export type HomeHighlight = {
  id: number;
  badge: string;
  title: string;
  description: string;
  ctaLabel: string;
  imageUrl: string | null;
  mobileImageUrl: string | null;
  imageAlt: string | null;
  linkUrl: string | null;
  discountText: string;
  discountLabel: string;
  bgStyle: string;
  sortOrder: number;
  isActive: boolean;
};

export type HomeHighlightSettings = {
  displayMode: "single" | "rotate";
  rotationIntervalSeconds: 5 | 8 | 10;
};

type HighlightPayload = Omit<HomeHighlight, "id" | "imageUrl" | "mobileImageUrl" | "imageAlt" | "linkUrl"> & {
  imageUrl: string;
  mobileImageUrl: string;
  imageAlt: string;
  linkUrl: string;
};
type HighlightUpdate = Omit<Partial<HighlightPayload>, "imageUrl" | "mobileImageUrl" | "imageAlt" | "linkUrl"> & {
  id: number;
  imageUrl?: string | null;
  mobileImageUrl?: string | null;
  imageAlt?: string | null;
  linkUrl?: string | null;
};
type Draft = Omit<HighlightPayload, "sortOrder" | "isActive"> & { sortOrder: string; isActive: boolean };

const blankDraft = (): Draft => ({
  badge: "",
  title: "",
  description: "",
  ctaLabel: "",
  imageUrl: "",
  mobileImageUrl: "",
  imageAlt: "",
  linkUrl: "",
  discountText: "",
  discountLabel: "OFF",
  bgStyle: "#000000",
  sortOrder: "0",
  isActive: true,
});

function imageSrc(value?: string | null) {
  const src = value?.trim() ?? "";
  if (!src || src.startsWith("data:") || src.startsWith("//")) return "";
  if (/^https?:\/\//i.test(src)) return src;
  return apiUrl(src.startsWith("/") ? src : `/${src}`);
}

function safeDestination(value: string) {
  const target = value.trim();
  if (!target) return { valid: true, value: "" };
  if (target.startsWith("/") && !target.startsWith("//") && !target.includes("\\")) {
    return { valid: true, value: target };
  }
  try {
    const parsed = new URL(target);
    if (parsed.protocol === "https:") return { valid: true, value: parsed.toString() };
  } catch {
    // A destination must be a same-site path or an HTTPS URL.
  }
  return { valid: false, value: "" };
}

function toDraft(record: HomeHighlight): Draft {
  return {
    badge: record.badge ?? "",
    title: record.title ?? "",
    description: record.description ?? "",
    ctaLabel: record.ctaLabel ?? "",
    imageUrl: record.imageUrl ?? "",
    mobileImageUrl: record.mobileImageUrl ?? "",
    imageAlt: record.imageAlt ?? "",
    linkUrl: record.linkUrl ?? "",
    discountText: record.discountText ?? "",
    discountLabel: record.discountLabel ?? "OFF",
    bgStyle: record.bgStyle ?? "#000000",
    sortOrder: String(record.sortOrder ?? 0),
    isActive: record.isActive,
  };
}

export function AdminHomeHighlightsPanel({
  records,
  settings,
  settingsLoading,
  settingsError,
  settingsSaving,
  isLoading,
  isError,
  isSaving,
  isDeleting,
  onRefresh,
  onUpdateSettings,
  onCreate,
  onUpdate,
  onDelete,
  onUpload,
}: {
  records: HomeHighlight[];
  settings: HomeHighlightSettings | null;
  settingsLoading: boolean;
  settingsError: boolean;
  settingsSaving: boolean;
  isLoading: boolean;
  isError: boolean;
  isSaving: boolean;
  isDeleting: boolean;
  onRefresh: () => void;
  onUpdateSettings: (input: HomeHighlightSettings) => Promise<unknown>;
  onCreate: (input: HighlightPayload) => Promise<unknown>;
  onUpdate: (input: HighlightUpdate) => Promise<unknown>;
  onDelete: (id: number) => Promise<unknown>;
  onUpload: (file: File, mobile: boolean) => Promise<string | null>;
}) {
  const sorted = useMemo(() => [...records].sort((a, b) => a.sortOrder - b.sortOrder || b.id - a.id), [records]);
  const active = useMemo(() => sorted.filter(item => item.isActive), [sorted]);
  const principal = active[0] ?? null;
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [workingId, setWorkingId] = useState<number | null>(null);
  const [formError, setFormError] = useState("");
  const [message, setMessage] = useState("");
  const [settingsMessage, setSettingsMessage] = useState("");

  const selected = sorted.find(item => item.id === selectedId) ?? principal ?? sorted[0] ?? null;
  const preview = draft ?? (selected ? toDraft(selected) : null);
  const destination = safeDestination(preview?.linkUrl ?? "");

  const openCreate = () => {
    setSelectedId(null);
    setEditingId(null);
    setDraft({ ...blankDraft(), sortOrder: String(Math.max(-1, ...sorted.map(item => item.sortOrder)) + 1) });
    setFormError("");
    setMessage("");
  };

  const openEdit = (record: HomeHighlight) => {
    setSelectedId(record.id);
    setEditingId(record.id);
    setDraft(toDraft(record));
    setFormError("");
    setMessage("");
  };

  const closeEditor = () => {
    setEditingId(null);
    setDraft(null);
    setFormError("");
  };

  const save = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!draft) return;
    const title = draft.title.trim();
    const description = draft.description.trim();
    const ctaLabel = draft.ctaLabel.trim();
    const destinationResult = safeDestination(draft.linkUrl);
    const order = Number(draft.sortOrder);
    if (!title || !description || !ctaLabel) {
      setFormError("Preencha título, descrição e texto do botão.");
      return;
    }
    if (!destinationResult.valid) {
      setFormError("Use um caminho da loja ou um endereço HTTPS válido.");
      return;
    }
    if (!Number.isInteger(order)) {
      setFormError("A ordem precisa ser um número inteiro.");
      return;
    }
    const payload: HighlightPayload = {
      badge: draft.badge.trim() || "DESTAQUE L4CKOS",
      title,
      description,
      ctaLabel,
      imageUrl: draft.imageUrl.trim(),
      mobileImageUrl: draft.mobileImageUrl.trim(),
      imageAlt: draft.imageAlt.trim(),
      linkUrl: destinationResult.value,
      discountText: draft.discountText.trim(),
      discountLabel: draft.discountLabel.trim() || "OFF",
      bgStyle: draft.bgStyle.trim() || "#000000",
      sortOrder: order,
      isActive: draft.isActive,
    };
    setWorkingId(editingId ?? -1);
    setFormError("");
    try {
      if (editingId !== null) await onUpdate({
        id: editingId,
        ...payload,
        imageUrl: payload.imageUrl || null,
        mobileImageUrl: payload.mobileImageUrl || null,
        imageAlt: payload.imageAlt || null,
        linkUrl: payload.linkUrl || null,
      });
      else await onCreate(payload);
      setMessage(editingId !== null ? "Destaque atualizado." : "Destaque criado.");
      closeEditor();
    } catch (error) {
      setFormError(error instanceof Error ? error.message : "Não foi possível salvar o destaque.");
    } finally {
      setWorkingId(null);
    }
  };

  const setActive = async (record: HomeHighlight) => {
    setWorkingId(record.id);
    try {
      await onUpdate({ id: record.id, isActive: !record.isActive });
      setMessage(`${record.title}: ${record.isActive ? "desativado" : "ativado"}.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Não foi possível atualizar o destaque.");
    } finally {
      setWorkingId(null);
    }
  };

  const setPrincipal = async (record: HomeHighlight) => {
    if (!record.isActive || record.id === principal?.id) return;
    const smallestOrder = Math.min(0, ...sorted.map(item => item.sortOrder));
    setWorkingId(record.id);
    try {
      await onUpdate({ id: record.id, sortOrder: smallestOrder - 1 });
      setSelectedId(record.id);
      setMessage(`${record.title} agora é o primeiro destaque ativo.`);
      onRefresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Não foi possível alterar a ordem.");
    } finally {
      setWorkingId(null);
    }
  };

  const changeOrder = async (record: HomeHighlight, direction: -1 | 1) => {
    const index = sorted.findIndex(item => item.id === record.id);
    const neighbor = sorted[index + direction];
    if (!neighbor) return;
    setWorkingId(record.id);
    try {
      const nextOrder = direction < 0 ? neighbor.sortOrder - 1 : neighbor.sortOrder + 1;
      await onUpdate({ id: record.id, sortOrder: nextOrder });
      setMessage("Ordem dos destaques atualizada.");
      onRefresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "A ordem não foi atualizada por completo. Atualize a lista para conferir.");
      onRefresh();
    } finally {
      setWorkingId(null);
    }
  };

  const remove = async (record: HomeHighlight) => {
    if (!window.confirm(`Excluir “${record.title}”? Esta ação não pode ser desfeita.`)) return;
    setWorkingId(record.id);
    try {
      await onDelete(record.id);
      setSelectedId(null);
      setMessage("Destaque excluído.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Não foi possível excluir o destaque.");
    } finally {
      setWorkingId(null);
    }
  };

  const upload = async (file: File | undefined, mobile: boolean) => {
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      setFormError("Selecione um arquivo de imagem.");
      return;
    }
    setWorkingId(editingId ?? -1);
    setFormError("");
    try {
      const url = await onUpload(file, mobile);
      if (!url) throw new Error("O envio não retornou uma imagem. O valor anterior foi preservado.");
      setDraft(current => current ? { ...current, [mobile ? "mobileImageUrl" : "imageUrl"]: url } : current);
    } catch (error) {
      setFormError(error instanceof Error ? error.message : "Não foi possível enviar a imagem.");
    } finally {
      setWorkingId(null);
    }
  };

  const setField = <K extends keyof Draft>(field: K, value: Draft[K]) => {
    setDraft(current => current ? { ...current, [field]: value } : current);
  };

  const saveSettings = async (next: HomeHighlightSettings) => {
    setSettingsMessage("");
    try {
      await onUpdateSettings(next);
      setSettingsMessage("Apresentação da Home atualizada.");
    } catch (error) {
      setSettingsMessage(error instanceof Error ? error.message : "Não foi possível atualizar a apresentação da Home.");
    }
  };

  return (
    <div className="admin-home-highlights">
      <header className="home-highlights-heading">
        <div><p className="home-highlights-eyebrow">COMERCIAL · PÁGINA INICIAL</p><h2>Destaques da Home</h2><p>Edite as campanhas que aparecem na apresentação da loja.</p></div>
        <div className="home-highlights-heading-actions"><button type="button" className="home-highlight-button" onClick={onRefresh}><RefreshCw size={16} /> Atualizar</button><button type="button" className="home-highlight-button home-highlight-primary" onClick={openCreate}><Plus size={17} /> Novo destaque</button></div>
      </header>

      <section className="home-highlight-facts" aria-label="Resumo dos destaques">
        <div><strong>{records.length}</strong><span>Cadastrados</span></div><div><strong>{active.length}</strong><span>Ativos</span></div><div><strong>{records.length - active.length}</strong><span>Inativos</span></div><p>A ordem é aplicada aos destaques ativos; os inativos não são apresentados na Home.</p>
      </section>

      {message ? <p className="home-highlight-feedback" role="status">{message}</p> : null}
      <section className="home-highlight-presentation" aria-labelledby="home-highlight-presentation-title">
        <div className="home-highlight-presentation-heading">
          <div><h3 id="home-highlight-presentation-title">Apresentação na Home</h3><p>O primeiro destaque ativo pela ordem atual é o principal.</p></div>
          {settings?.displayMode === "rotate" ? <span>Principal exibido primeiro</span> : null}
        </div>
        {settingsLoading ? <p className="home-highlight-settings-state" role="status">Carregando configuração…</p> : null}
        {settingsError || !settings ? <p className="home-highlight-settings-state is-error" role="alert">Não foi possível consultar a configuração persistente da Home. Verifique se a migration da configuração foi aplicada e tente atualizar.</p> : null}
        {settings ? <>
          <fieldset className="home-highlight-radio-group" disabled={settingsSaving || settingsLoading || settingsError}>
            <legend>Modo de exibição</legend>
            <label className={settings.displayMode === "single" ? "is-selected" : ""}>
              <input type="radio" name="home-highlight-mode" value="single" checked={settings.displayMode === "single"} onChange={() => void saveSettings({ ...settings, displayMode: "single" })} />
              <span><strong>Destaque único</strong><small>Mostra somente o principal.</small></span>
            </label>
            <label className={settings.displayMode === "rotate" ? "is-selected" : ""}>
              <input type="radio" name="home-highlight-mode" value="rotate" checked={settings.displayMode === "rotate"} onChange={() => void saveSettings({ ...settings, displayMode: "rotate" })} />
              <span><strong>Rotação automática</strong><small>Alterna entre os destaques ativos.</small></span>
            </label>
          </fieldset>
          {settings.displayMode === "rotate" ? <fieldset className="home-highlight-radio-group home-highlight-interval" disabled={settingsSaving || settingsLoading || settingsError}>
            <legend>Intervalo entre destaques</legend>
            {[5, 8, 10].map(seconds => <label key={seconds} className={settings.rotationIntervalSeconds === seconds ? "is-selected" : ""}>
              <input type="radio" name="home-highlight-interval" value={seconds} checked={settings.rotationIntervalSeconds === seconds} onChange={() => void saveSettings({ ...settings, rotationIntervalSeconds: seconds as 5 | 8 | 10 })} />
              <span><strong>{seconds} segundos</strong></span>
            </label>)}
          </fieldset> : null}
        </> : null}
        {settingsSaving ? <p className="home-highlight-settings-state" role="status">Salvando configuração…</p> : null}
        {settingsMessage ? <p className="home-highlight-settings-feedback" role="status">{settingsMessage}</p> : null}
      </section>
      {isLoading ? <div className="home-highlight-state" role="status">Carregando destaques…</div> : null}
      {isError ? <div className="home-highlight-state is-error" role="alert">Não foi possível carregar os destaques. <button type="button" onClick={onRefresh}>Tentar novamente</button></div> : null}
      {!isLoading && !isError && records.length === 0 ? <div className="home-highlight-state">Nenhum destaque cadastrado.</div> : null}

      {!isLoading && !isError && records.length > 0 ? <div className="home-highlight-layout">
        <section className="home-highlight-list" aria-label="Destaques cadastrados">
          {sorted.map((record, index) => <article className={`home-highlight-row${selected?.id === record.id ? " is-selected" : ""}`} key={record.id}>
            <button type="button" className="home-highlight-select" onClick={() => { setSelectedId(record.id); closeEditor(); }} aria-label={`Visualizar ${record.title}`}>
              {imageSrc(record.imageUrl) ? <img src={imageSrc(record.imageUrl)} alt="" /> : <span className="home-highlight-image-empty">Sem foto</span>}
              <span className="home-highlight-row-copy"><strong>{record.title}</strong><small>{record.badge || "Sem selo"} · ordem {record.sortOrder}</small></span>
              <span className={`home-highlight-status${record.isActive ? " is-active" : ""}`}>{record.isActive ? "Ativo" : "Inativo"}</span>
            </button>
            <div className="home-highlight-row-actions">
              {record.id === principal?.id ? <span className="home-highlight-primary-label"><Check size={14} /> Principal</span> : <button type="button" onClick={() => void setPrincipal(record)} disabled={!record.isActive || workingId !== null}>Definir principal</button>}
              <button type="button" onClick={() => openEdit(record)} disabled={workingId !== null}><Pencil size={15} /> Editar</button>
              <button type="button" aria-label={`Mover ${record.title} para cima`} onClick={() => void changeOrder(record, -1)} disabled={index === 0 || workingId !== null}><ArrowUp size={15} /></button>
              <button type="button" aria-label={`Mover ${record.title} para baixo`} onClick={() => void changeOrder(record, 1)} disabled={index === sorted.length - 1 || workingId !== null}><ArrowDown size={15} /></button>
              <button type="button" onClick={() => void setActive(record)} disabled={workingId !== null}>{record.isActive ? "Desativar" : "Ativar"}</button>
              <button type="button" className="is-danger" onClick={() => void remove(record)} disabled={workingId !== null || isDeleting}><Trash2 size={15} /> Excluir</button>
            </div>
          </article>)}
        </section>

        <aside className="home-highlight-preview" aria-label="Prévia do destaque selecionado">
          <div className="home-highlight-preview-heading"><div><span>PRÉVIA DA HOME</span><h3>{draft ? (editingId ? `Editando #${editingId}` : "Novo destaque") : selected?.id === principal?.id ? `Principal · #${selected.id}` : selected ? `Destaque #${selected.id}` : "Nenhum destaque"}</h3></div></div>
          {preview ? <div className="home-highlight-preview-content">
            {imageSrc(preview.imageUrl) ? <picture>{preview.mobileImageUrl ? <source media="(max-width: 640px)" srcSet={imageSrc(preview.mobileImageUrl)} /> : null}<img src={imageSrc(preview.imageUrl)} alt={preview.imageAlt || preview.title || ""} /></picture> : <div className="home-highlight-preview-empty">Nenhuma imagem cadastrada</div>}
            <span className="home-highlight-preview-badge">{preview.badge || "DESTAQUE L4CKOS"}</span><h4>{preview.title || "Título"}</h4><p>{preview.description || "Descrição"}</p>
            {destination.valid && destination.value ? <a href={destination.value} onClick={event => event.preventDefault()}>{preview.ctaLabel || "Ver produto"} <span aria-hidden="true">→</span></a> : <span className="home-highlight-preview-cta">{preview.ctaLabel || "Ver produto"}</span>}
          </div> : <p className="home-highlight-state">Ative ou cadastre um destaque para visualizar.</p>}
          <p className="home-highlight-preview-note">Prévia administrativa. As mudanças são aplicadas à loja somente após salvar.</p>
        </aside>
      </div> : null}

      {draft ? <form className="home-highlight-editor" onSubmit={event => void save(event)}>
        <div className="home-highlight-editor-heading"><div><span>{editingId ? `EDITANDO REGISTRO #${editingId}` : "NOVO REGISTRO"}</span><h3>{editingId ? "Editar destaque" : "Novo destaque"}</h3></div><button type="button" onClick={closeEditor}>Cancelar</button></div>
        <section><h4>Conteúdo da campanha</h4><div className="home-highlight-fields"><label>Identificação visual<span><input maxLength={80} value={draft.badge} onChange={event => setField("badge", event.target.value)} /></span></label><label>Título<span><input required maxLength={255} value={draft.title} onChange={event => setField("title", event.target.value)} /></span></label><label className="is-wide">Descrição<span><textarea required maxLength={1000} rows={3} value={draft.description} onChange={event => setField("description", event.target.value)} /></span></label><label>Texto do botão<span><input required maxLength={120} value={draft.ctaLabel} onChange={event => setField("ctaLabel", event.target.value)} /></span></label><label>Destino do botão<span><input maxLength={500} value={draft.linkUrl} onChange={event => setField("linkUrl", event.target.value)} placeholder="/produtos ou https://…" /></span></label></div></section>
        <section><h4>Fotografias</h4><div className="home-highlight-fields"><ImageField label="Imagem desktop" value={draft.imageUrl} onChange={value => setField("imageUrl", value)} onFile={file => void upload(file, false)} disabled={workingId !== null} /><ImageField label="Imagem mobile" value={draft.mobileImageUrl} onChange={value => setField("mobileImageUrl", value)} onFile={file => void upload(file, true)} disabled={workingId !== null} /><label className="is-wide">Texto alternativo<span><input maxLength={255} value={draft.imageAlt ?? ""} onChange={event => setField("imageAlt", event.target.value)} /></span></label></div><p className="home-highlight-help">Sem imagem mobile própria, a loja usa a imagem desktop.</p></section>
        <details className="home-highlight-secondary"><summary>Campos complementares já cadastrados</summary><div className="home-highlight-fields"><label>Oferta<span><input maxLength={60} value={draft.discountText} onChange={event => setField("discountText", event.target.value)} /></span></label><label>Complemento da oferta<span><input maxLength={40} value={draft.discountLabel} onChange={event => setField("discountLabel", event.target.value)} /></span></label><label>Estilo de fundo cadastrado<span><input maxLength={255} value={draft.bgStyle} onChange={event => setField("bgStyle", event.target.value)} /></span></label><label>Ordem<span><input type="number" step={1} value={draft.sortOrder} onChange={event => setField("sortOrder", event.target.value)} /></span></label><label className="home-highlight-switch">Ativo<span><input type="checkbox" checked={draft.isActive} onChange={event => setField("isActive", event.target.checked)} /> {draft.isActive ? "Sim" : "Não"}</span></label></div></details>
        {formError ? <p className="home-highlight-form-error" role="alert">{formError}</p> : null}
        <div className="home-highlight-form-actions"><button type="button" onClick={closeEditor}>Cancelar</button><button type="submit" disabled={isSaving || workingId !== null}><Check size={16} /> {isSaving ? "Salvando…" : "Salvar destaque"}</button></div>
      </form> : null}
    </div>
  );
}

function ImageField({ label, value, onChange, onFile, disabled }: { label: string; value: string | null; onChange: (value: string) => void; onFile: (file?: File) => void; disabled: boolean }) {
  const resolved = imageSrc(value);
  return <label className="home-highlight-image-field">{label}<span className="home-highlight-image-field-preview">{resolved ? <img src={resolved} alt="" /> : "Sem imagem"}</span><input maxLength={500} value={value ?? ""} onChange={event => onChange(event.target.value)} placeholder="Caminho ou URL HTTPS" /><span className="home-highlight-upload"><ImagePlus size={15} /> Enviar imagem<input type="file" accept="image/*" disabled={disabled} onChange={event => { onFile(event.currentTarget.files?.[0]); event.currentTarget.value = ""; }} /></span><button type="button" onClick={() => onChange("")} disabled={!value}>Remover imagem</button></label>;
}
